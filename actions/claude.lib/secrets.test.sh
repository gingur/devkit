#!/usr/bin/env bash
# Fixture tests for the secret-scoping primitive (devkit#167).
#
# scope_secrets sits between infisical.secrets.fetch's `export: file` mode and
# GITHUB_OUTPUT: it must forward only the keys a caller requests, while still
# masking every value in the dotenv file (defense-in-depth for keys nobody
# asked for), must not let a value containing "=" split incorrectly, and must
# not leave the dotenv file behind.
#
# No network, no token — pure fixture data.
#
# Run: bash actions/claude.lib/secrets.test.sh
set -uo pipefail
cd "$(dirname "$0")"

# shellcheck source=./secrets.sh
. ./secrets.sh

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DOTENV="$TMP/turn.env"
GITHUB_OUTPUT="$TMP/output"
: > "$GITHUB_OUTPUT"
export GITHUB_OUTPUT

# Infisical/secrets-action's `export: file` wraps every value in single quotes;
# scope_secrets must strip them. UNQUOTED_LEGACY covers an unquoted value (env
# export / older format) passing through untouched.
printf "GH_BOT_PAT='%s'\nCLAUDE_CODE_OAUTH_TOKEN='%s'\nDATABASE_URL='%s'\nEXTRA_WITH_EQUALS='%s'\nUNQUOTED_LEGACY=%s\n" \
  'ghp_abc123' 'sk-ant-oat-xyz789' 'postgres://user:pass@host/db' 'foo=bar=baz' 'plain_no_quotes' \
  > "$DOTENV"

MASKS="$(scope_secrets "$DOTENV" GH_BOT_PAT:ghBotPat CLAUDE_CODE_OAUTH_TOKEN:claudeToken EXTRA_WITH_EQUALS:extraOut UNQUOTED_LEGACY:legacyOut)"

pass=0 fail=0
check() { # <description> <test-fn>
  local desc="$1" fn="$2"
  if "$fn"; then
    printf 'ok   %s\n' "$desc"; pass=$((pass + 1))
  else
    printf 'FAIL %s\n' "$desc"; fail=$((fail + 1))
  fi
}

requested_keys_present() {
  grep -qxF 'ghBotPat=ghp_abc123' "$GITHUB_OUTPUT" &&
    grep -qxF 'claudeToken=sk-ant-oat-xyz789' "$GITHUB_OUTPUT"
}

nonrequested_key_absent() {
  ! grep -qE '^databaseUrl=|DATABASE_URL' "$GITHUB_OUTPUT"
}

all_values_masked() {
  printf '%s\n' "$MASKS" | grep -qxF '::add-mask::ghp_abc123' &&
    printf '%s\n' "$MASKS" | grep -qxF '::add-mask::sk-ant-oat-xyz789' &&
    printf '%s\n' "$MASKS" | grep -qxF '::add-mask::postgres://user:pass@host/db' &&
    printf '%s\n' "$MASKS" | grep -qxF '::add-mask::foo=bar=baz'
}

dotenv_removed() {
  [[ ! -e "$DOTENV" ]]
}

equals_value_roundtrips() {
  grep -qxF 'extraOut=foo=bar=baz' "$GITHUB_OUTPUT"
}

single_quotes_stripped() {
  # values were single-quoted in the fixture; outputs must be the raw secret,
  # never the 2-char-longer 'ghp_abc123' form that breaks token auth.
  grep -qxF 'ghBotPat=ghp_abc123' "$GITHUB_OUTPUT" &&
    ! grep -qE "^ghBotPat='" "$GITHUB_OUTPUT"
}

unquoted_value_passthrough() {
  grep -qxF 'legacyOut=plain_no_quotes' "$GITHUB_OUTPUT"
}

check "requested keys appear in \$GITHUB_OUTPUT with correct values" requested_keys_present
check "a non-requested key (DATABASE_URL) does not appear in \$GITHUB_OUTPUT" nonrequested_key_absent
check "every value in the fixture produced an ::add-mask:: line" all_values_masked
check "the dotenv fixture file no longer exists after the call" dotenv_removed
check "a value containing '=' round-trips intact" equals_value_roundtrips
check "single-quoted dotenv values are stripped to the raw secret" single_quotes_stripped
check "an unquoted (legacy) value passes through untouched" unquoted_value_passthrough

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
