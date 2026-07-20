#!/usr/bin/env bash
# Fixture tests for the turn contract guards (devkit#150).
#
# These lock the agent comment-identity contract: the agent posts its turn
# comment as the Claude GitHub App (`claude[bot]`), while reviews and gh-shelling
# steps come from $BOT. #147 changed that identity without updating the guards,
# so every plan/implement/review turn false-failed while doing its job correctly
# (see docs/incidents/2026-07-17-turn-guard-identity.md). Nothing in CI caught
# it, because devkit had no CI on its own actions.
#
# The guards' only GitHub read is `_turn_gh`, so overriding it here runs the
# REAL jq selectors — the part that actually broke — against fixture JSON with
# no network and no token.
#
# Run: bash actions/claude.lib/turn.test.sh
set -uo pipefail
cd "$(dirname "$0")"

# shellcheck source=./turn.sh
. ./turn.sh

REPO="gingur/driver" ISSUE=96 PR=118 BOT="gingur-bot"
TURN_STARTED="2026-07-17T19:43:00Z"
FIXTURE=""

# Override the guards' single read: same jq filter, fixture data.
_turn_gh() { jq "$2" "$FIXTURE"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fixture() { # <name> <json>
  printf '%s' "$2" > "$TMP/$1.json"
  echo "$TMP/$1.json"
}

comment() { # <login> <created_at>
  printf '{"user":{"login":"%s"},"created_at":"%s"}' "$1" "$2"
}
review() { # <login> <submitted_at>
  printf '{"user":{"login":"%s"},"submitted_at":"%s"}' "$1" "$2"
}

AFTER="2026-07-17T19:44:29Z"
BEFORE="2026-07-17T17:06:36Z"
EMPTY="[]"

pass=0 fail=0
check() { # <description> <expected-rc> <guard-fn>
  local desc="$1" want="$2" fn="$3" got
  ( "$fn" ) >/dev/null 2>&1
  got=$?
  if [[ "$got" == "$want" ]]; then
    printf 'ok   %s\n' "$desc"; pass=$((pass + 1))
  else
    printf 'FAIL %s (expected rc=%s, got rc=%s)\n' "$desc" "$want" "$got"; fail=$((fail + 1))
  fi
}

# --- turn_verify: the comment contract -------------------------------------
# The regression case: the agent's own comment is authored by claude[bot].
FIXTURE=$(fixture claude_bot "[$(comment 'claude[bot]' "$AFTER")]")
check "turn_verify accepts a claude[bot] comment (the #147 regression case)" 0 turn_verify

# Back-compat: pre-#147 turns commented as $BOT and must still pass.
FIXTURE=$(fixture bot "[$(comment 'gingur-bot' "$AFTER")]")
check "turn_verify accepts a \$BOT comment (pre-#147 back-compat)" 0 turn_verify

# A human/other-bot comment is not the agent's contract output.
FIXTURE=$(fixture operator "[$(comment 'gingur' "$AFTER"),$(comment 'github-actions[bot]' "$AFTER")]")
check "turn_verify rejects operator/github-actions comments only" 1 turn_verify

FIXTURE=$(fixture none "$EMPTY")
check "turn_verify rejects an empty thread" 1 turn_verify

# The window matters: a comment from before the turn is not this turn's output.
FIXTURE=$(fixture stale "[$(comment 'claude[bot]' "$BEFORE")]")
check "turn_verify rejects a comment predating TURN_STARTED" 1 turn_verify

# Mixed thread — the real driver#96 shape: many authors, one of them the agent.
FIXTURE=$(fixture mixed "[$(comment 'gingur' "$AFTER"),$(comment 'github-actions[bot]' "$AFTER"),$(comment 'claude[bot]' "$AFTER")]")
check "turn_verify finds the agent comment among other authors" 0 turn_verify

# --- turn_verify_review: the verdict contract -------------------------------
# Reviews are submitted as $BOT (gh/PAT identity), comments as claude[bot];
# either satisfies the one-verdict-per-turn contract.
FIXTURE=$(fixture review_bot "[$(review 'gingur-bot' "$AFTER")]")
check "turn_verify_review accepts a \$BOT-submitted review" 0 turn_verify_review

FIXTURE=$(fixture review_claude "[$(review 'claude[bot]' "$AFTER")]")
check "turn_verify_review accepts a claude[bot] review" 0 turn_verify_review

FIXTURE=$(fixture review_none "$EMPTY")
check "turn_verify_review rejects no review and no comment" 1 turn_verify_review

FIXTURE=$(fixture review_stale "[$(review 'gingur-bot' "$BEFORE")]")
check "turn_verify_review rejects a review predating TURN_STARTED" 1 turn_verify_review

# --- turn_verify_committer: the committer contract --------------------------
# Net-new guard (#163): every commit the work branch carries that main
# doesn't must be committed by the bot account. _turn_git_committers is the
# guard's only git read — same redefinition pattern as _turn_gh — so this
# runs with no real git history.
BASE="origin/main"
COMMITTERS=""
_turn_git_committers() { printf '%s\n' "$COMMITTERS"; }

COMMITTERS=$'301771478+gingur-bot@users.noreply.github.com\n301771478+gingur-bot@users.noreply.github.com'
check "turn_verify_committer accepts all-bot committers" 0 turn_verify_committer

COMMITTERS=$'301771478+gingur-bot@users.noreply.github.com\ntroy.rhinehart@gmail.com'
check "turn_verify_committer rejects a non-bot committer among bot commits" 1 turn_verify_committer

COMMITTERS="gingur@users.noreply.github.com"
check "turn_verify_committer rejects a lone non-bot committer" 1 turn_verify_committer

COMMITTERS=""
check "turn_verify_committer passes when the branch has no new commits" 0 turn_verify_committer

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
