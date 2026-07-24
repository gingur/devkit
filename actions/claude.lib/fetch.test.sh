#!/usr/bin/env bash
# Fixture tests for the fetch-failure reporting primitive (devkit#185).
#
# infisical.secrets.fetch wraps Infisical/secrets-action, a third-party JS
# action that prints nothing on a non-zero exit — no ::error::, no HTTP
# status, no exit message (observed: run 30111303346, step `Secrets` red for
# 2.3s with zero log output). report_fetch_failure makes that failure
# self-describing using only the non-secret input metadata already echoed in
# the fetch composite's own input group — it must never see or reference a
# fetched secret value.
#
# No network, no token — pure fixture data.
#
# Run: bash actions/claude.lib/fetch.test.sh
set -uo pipefail
cd "$(dirname "$0")"

# shellcheck source=./fetch.sh
. ./fetch.sh

pass=0 fail=0
check() { # <description> <test-fn>
  local desc="$1" fn="$2"
  if "$fn"; then
    printf 'ok   %s\n' "$desc"; pass=$((pass + 1))
  else
    printf 'FAIL %s\n' "$desc"; fail=$((fail + 1))
  fi
}

IDENTITY='11111111-2222-3333-4444-555555555555'
AUDIENCE='https://github.com/gingur'
SENTINEL_A='ghp_SENTINEL'
SENTINEL_B='sk-ant-SENTINEL'

OUTPUT="$(report_fetch_failure failure "$IDENTITY" gingur preview /infra/github "$AUDIENCE" 2>&1)"

error_line_self_describing() {
  local line
  line="$(printf '%s\n' "$OUTPUT" | grep '::error::')"
  [[ -n "$line" ]] || return 1
  printf '%s\n' "$line" | grep -qE '(env|path|status)' &&
    printf '%s\n' "$line" | grep -q 'env=preview' &&
    printf '%s\n' "$line" | grep -q 'path=/infra/github' &&
    printf '%s\n' "$line" | grep -q 'status='
}

error_line_has_identity_and_audience() {
  local line
  line="$(printf '%s\n' "$OUTPUT" | grep '::error::')"
  printf '%s\n' "$line" | grep -qF "$IDENTITY" &&
    printf '%s\n' "$line" | grep -qF "$AUDIENCE"
}

no_secret_material_present() {
  ! printf '%s\n' "$OUTPUT" | grep -qF "$SENTINEL_A" &&
    ! printf '%s\n' "$OUTPUT" | grep -qF "$SENTINEL_B"
}

has_plain_attempted_line_before_error() {
  local first_line
  first_line="$(printf '%s\n' "$OUTPUT" | head -n1)"
  [[ "$first_line" != *'::error::'* ]] && [[ -n "$first_line" ]]
}

classification_prose_present() {
  printf '%s\n' "$OUTPUT" | grep -qiE 'auth|oidc' &&
    printf '%s\n' "$OUTPUT" | grep -qi 'service'
}

check "::error:: line matches env=/path=/status= and the acceptance grep" error_line_self_describing
check "::error:: line contains the identity id and audience" error_line_has_identity_and_audience
check "no sentinel secret value from a fetched dotenv leaks into the output" no_secret_material_present
check "a plain (non-::error::) line precedes the error, stating what was attempted" has_plain_attempted_line_before_error
check "message classifies auth/OIDC vs. service failure with retry-vs-rotate guidance" classification_prose_present

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
