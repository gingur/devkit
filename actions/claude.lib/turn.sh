# Shared step shell for the agent-turn composites (claude.plan,
# claude.implement, claude.review). Sourced from each composite's step as
#
#   . "${GITHUB_ACTION_PATH}/../claude.lib/turn.sh"
#
# Load-bearing trick: sourcing does not change GITHUB_ACTION_PATH — it still
# points at the *sourcing composite's* directory when this code runs, so the
# "../claude.agent.md" and "prompt.md" references below resolve per-composite.
# Version-safe by construction: GitHub ships the whole repo at the action's
# pinned ref, so this lib always matches the composite's ref (the existing
# ../claude.agent.md reference is the precedent), including on PR branches.

# turn_instructions <PROMPT_VAR> — append the turn's env contract to
# $GITHUB_ENV: the escaped system prompt (AGENT_MD), the composite's own
# prompt.md under the caller-chosen name (PLAN_MD / TASK_MD), the turn start
# instant (TURN_STARTED), and the claude executable override (CLAUDE_EXEC).
turn_instructions() {
  {
    # claude.agent.md -> system prompt via claude_args: escape for the
    # double-quoted shell-quote value it gets embedded in (backslashes,
    # then quotes, then "$" — claude-code-action's shell-quote parse runs
    # env-less, so an unescaped $WORD would be substituted with empty
    # string). The file must contain no line starting with "#" (stripped
    # by CCA).
    echo 'AGENT_MD<<EOF_9c4e1b'
    sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\$/\\$/g' "${GITHUB_ACTION_PATH}/../claude.agent.md"
    echo 'EOF_9c4e1b'
    echo "$1<<EOF_9c4e1b"
    cat "${GITHUB_ACTION_PATH}/prompt.md"
    echo 'EOF_9c4e1b'
    echo "TURN_STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    # Self-hosted runners share the operator HOME: concurrent turns racing
    # claude-code-action's installer over ~/.claude/downloads delete each
    # other's download mid-verify (devkit#92 + hooks#18, 2026-07-10).
    # Prefer the host's own install; empty falls back to the installer.
    echo "CLAUDE_EXEC=$([[ -x "$HOME/.local/bin/claude" ]] && echo "$HOME/.local/bin/claude")"
  } >> "$GITHUB_ENV"
}

# _turn_gh <api-path> <jq-filter> — the guards' only GitHub read.
# Isolated behind one function so the contract checks can be exercised against
# fixtures (actions/claude.lib/turn.test.sh) with no network: a test redefines
# this after sourcing, and the real jq selectors — the part that actually broke
# in #147 — still run verbatim.
_turn_gh() {
  gh api "$1" --paginate --jq "$2"
}

# turn_verify — comment-contract check for plan/implement turns. The agent's
# contract is at least one comment per turn (its summary, or a blocker
# report). A run that "succeeds" silently burns real quota with the operator
# none the wiser — fail the job instead, so the handoff posts the failure
# comment and returns the baton.
#
# Identity: since #147 retired the github_token-authored action panel, the
# agent posts its turn comment as the Claude GitHub App (`claude[bot]`), not as
# $BOT (the PAT login the run triggers on). The check accepts EITHER — matching
# only $BOT silently false-failed every post-#147 plan turn even though a valid
# comment was posted, which drove the PM to re-dispatch in a loop (driver#96,
# 2026-07-17).
# Reads env: GH_TOKEN, REPO, ISSUE, BOT, TURN_STARTED.
turn_verify() {
  local n
  n=$(_turn_gh "repos/$REPO/issues/$ISSUE/comments" \
    "[.[] | select((.user.login == \"$BOT\" or .user.login == \"claude[bot]\") and .created_at >= \"$TURN_STARTED\")] | length")
  if [[ "$n" -eq 0 ]]; then
    _turn_evidence "repos/$REPO/issues/$ISSUE/comments" .created_at
    echo "::error::agent turn ended without posting any comment (contract: at least one per turn)"
    exit 1
  fi
}

# _turn_evidence <api-path> <timestamp-field> — print what actually landed in
# the turn window before failing, so the run log diagnoses itself instead of
# asserting a bare (and possibly false) "posted nothing". The #147 identity
# flip cost hours precisely because the error claimed no comment existed while
# a valid one did — authored by a login the check did not accept.
_turn_evidence() {
  local path="$1" field="$2" total authors
  total=$(_turn_gh "$path" "[.[] | select($field >= \"$TURN_STARTED\")] | length" 2>/dev/null) || total="?"
  authors=$(_turn_gh "$path" "[.[] | select($field >= \"$TURN_STARTED\") | .user.login] | unique | join(\", \")" 2>/dev/null) || authors=""
  echo "::notice::turn-contract evidence — since $TURN_STARTED: ${total} entr(ies) at $path by [${authors:-none}]; accepted authors: [$BOT, claude[bot]]"
}

# turn_verify_review — verdict-contract check for the review turn: a submitted
# COMMENT review OR a PR comment by the agent since the turn started. Same
# dual-identity rule as turn_verify ($BOT or the Claude App).
# Reads env: GH_TOKEN, REPO, PR, BOT, TURN_STARTED.
turn_verify_review() {
  local r c
  r=$(_turn_gh "repos/$REPO/pulls/$PR/reviews" \
    "[.[] | select((.user.login == \"$BOT\" or .user.login == \"claude[bot]\") and .submitted_at >= \"$TURN_STARTED\")] | length")
  c=$(_turn_gh "repos/$REPO/issues/$PR/comments" \
    "[.[] | select((.user.login == \"$BOT\" or .user.login == \"claude[bot]\") and .created_at >= \"$TURN_STARTED\")] | length")
  if [[ "$r" -eq 0 && "$c" -eq 0 ]]; then
    _turn_evidence "repos/$REPO/pulls/$PR/reviews" .submitted_at
    _turn_evidence "repos/$REPO/issues/$PR/comments" .created_at
    echo "::error::review turn ended without posting a PR review or comment (contract: one verdict per turn)"
    exit 1
  fi
}
