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

# turn_verify — comment-contract check for plan/implement turns. The agent's
# contract is at least one comment per turn (its summary, or a blocker
# report). A run that "succeeds" silently burns real quota with the operator
# none the wiser — fail the job instead, so the handoff posts the failure
# comment and returns the baton.
# Reads env: GH_TOKEN, REPO, ISSUE, BOT, TURN_STARTED.
turn_verify() {
  local n
  n=$(gh api "repos/$REPO/issues/$ISSUE/comments" --paginate \
    --jq "[.[] | select(.user.login == \"$BOT\" and .created_at >= \"$TURN_STARTED\")] | length")
  if [[ "$n" -eq 0 ]]; then
    echo "::error::agent turn ended without posting any comment (contract: at least one per turn)"
    exit 1
  fi
}
