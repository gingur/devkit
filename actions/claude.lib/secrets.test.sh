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

# --- Absence handling (devkit#184) ---
#
# scope_secrets removes the dotenv file it's given, so each case below gets
# its own fixture copy and its own $GITHUB_OUTPUT so it can't interfere with
# the assertions above.
#
# Note on "contains none of the fixture values": defense-in-depth masking of
# every *present* value (all_values_masked, above) is unchanged and still
# unconditional, so the full captured output legitimately contains
# ::add-mask::<value> lines for present-but-unrequested keys. The secret-free
# guarantee below is scoped to the ::error:: line itself, per requirement 3
# ("emit an ::error:: line that ... contains none of the fetched values") —
# that's the line a reader actually reads, and the one the hard constraint
# ("no secret material in the log") binds.

DOTENV2="$TMP/turn2.env"
printf "GH_BOT_PAT='%s'\nCLAUDE_CODE_OAUTH_TOKEN='%s'\nDATABASE_URL='%s'\n" \
  'ghp_abc123' 'sk-ant-oat-xyz789' 'postgres://user:pass@host/db' \
  > "$DOTENV2"
OUTPUT2="$TMP/output2"
: > "$OUTPUT2"

ABSENT_LOG="$(GITHUB_OUTPUT="$OUTPUT2" scope_secrets "$DOTENV2" MISSING_KEY:missingOut)"
ABSENT_STATUS=$?
ABSENT_ERROR_LINE="$(printf '%s\n' "$ABSENT_LOG" | grep '^::error::' || true)"

absent_call_fails() {
  [[ "$ABSENT_STATUS" -ne 0 ]]
}

absent_key_named_in_error() {
  grep -qF 'MISSING_KEY' <<<"$ABSENT_ERROR_LINE"
}

absent_error_has_no_secret_values() {
  [[ -n "$ABSENT_ERROR_LINE" ]] &&
    ! grep -qE 'ghp_abc123|sk-ant-oat-xyz789|postgres://user:pass@host/db' <<<"$ABSENT_ERROR_LINE"
}

check "an absent requested key makes scope_secrets return non-zero" absent_call_fails
check "the ::error:: line names the absent key (MISSING_KEY)" absent_key_named_in_error
check "the ::error:: line contains none of the fixture values" absent_error_has_no_secret_values

DOTENV3="$TMP/turn3.env"
: > "$DOTENV3"
OUTPUT3="$TMP/output3"
: > "$OUTPUT3"

EMPTY_LOG="$(GITHUB_OUTPUT="$OUTPUT3" scope_secrets "$DOTENV3" KEY_ONE:one KEY_TWO:two)"
EMPTY_STATUS=$?
EMPTY_ERROR_LINE="$(printf '%s\n' "$EMPTY_LOG" | grep '^::error::' || true)"

empty_call_fails() {
  [[ "$EMPTY_STATUS" -ne 0 ]]
}

empty_names_both_requested_keys() {
  grep -qF 'KEY_ONE' <<<"$EMPTY_ERROR_LINE" && grep -qF 'KEY_TWO' <<<"$EMPTY_ERROR_LINE"
}

empty_reports_found_0_of_2() {
  grep -qF 'found 0 of 2' <<<"$EMPTY_ERROR_LINE"
}

check "an empty dotenv makes scope_secrets return non-zero" empty_call_fails
check "the ::error:: line names both requested keys on an empty fetch" empty_names_both_requested_keys
check "the ::error:: line reports found 0 of 2 requested keys" empty_reports_found_0_of_2

# --- Missing-file case under the caller's real shell mode (-e) ---
#
# infisical.secrets.scope/action.yml's step runs as composite `shell: bash`,
# which defaults to `bash --noprofile --norc -eo pipefail`. This whole test
# file runs under `set -uo pipefail` (no -e, see line 13) for check()'s
# return-value pattern, so a case run in-process here would pass even if
# scope_secrets aborted at the `done < "$dotenv"` redirection under real -e
# semantics — masking the exact gap a prior review caught. Spawn a nested
# bash with the caller's actual flags so this case fails the way production
# would if the guard regressed.

MISSING_DOTENV="$TMP/does-not-exist.env"
OUTPUT4="$TMP/output4"
: > "$OUTPUT4"

MISSING_FILE_LOG="$(bash -eo pipefail -c '
  . ./secrets.sh
  GITHUB_OUTPUT="$1" scope_secrets "$2" MISSING_KEY:missingOut
' _ "$OUTPUT4" "$MISSING_DOTENV" 2>&1)"
MISSING_FILE_STATUS=$?
MISSING_FILE_ERROR_LINE="$(printf '%s\n' "$MISSING_FILE_LOG" | grep '^::error::' || true)"

missing_file_under_real_shell_mode_fails() {
  [[ "$MISSING_FILE_STATUS" -ne 0 ]]
}

missing_file_under_real_shell_mode_names_key() {
  grep -qF 'MISSING_KEY' <<<"$MISSING_FILE_ERROR_LINE"
}

missing_file_under_real_shell_mode_reports_found_0_of_1() {
  grep -qF 'found 0 of 1' <<<"$MISSING_FILE_ERROR_LINE"
}

check "a genuinely missing dotenv file fails under the caller's real -e shell mode" missing_file_under_real_shell_mode_fails
check "...and the ::error:: line names the requested key (MISSING_KEY)" missing_file_under_real_shell_mode_names_key
check "...and reports found 0 of 1 requested keys, not a raw bash error" missing_file_under_real_shell_mode_reports_found_0_of_1

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
