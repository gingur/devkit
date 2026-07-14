#!/usr/bin/env bun
// Claude Code `PreToolUse` hook for devkit's `claude.reconcile` composite
// (gingur/devkit#136, ask gingur/devkit#134): belt-and-suspenders denial of
// a raw `gh` *mutation* typed into a Bash tool call during a shadow
// reconcile turn. The reconcile turn's legitimate mutation path is the
// checked-out `gingur/driver` repo's `skills/` wrappers, which spawn `gh`
// from **bun** — never as a bare `gh` Bash command — so this hook never
// sees, and never interferes with, that path.
//
// Adapted from gingur/infra `box/bin/gingur-driver-gh-guard.ts` (source of
// truth for the resident-seat version; gingur/infra#89), with two
// portability changes for running on a GitHub Actions runner instead of the
// box's resident seat:
//   - the classifier is imported from the local vendored `./gh-guard.ts`
//     instead of the box's `../lib/gh-guard.ts`;
//   - the log path is runner-portable (`$RUNNER_TEMP`/`$GITHUB_WORKSPACE`,
//     overridable via `GINGUR_GH_GUARD_LOG`) instead of the box's
//     `wslHome`-derived path from `box/lib/config.ts`.
// De-dupe follow-up: once infra publishes gh-guard as a shared package,
// replace both vendored files here with that dependency.
//
// Schema verified against the Claude Code hooks docs
// (docs.claude.com/en/docs/claude-code/hooks — "Common input fields",
// "PreToolUse", "JSON output" sections) as of 2026-07:
//   - stdin carries one JSON object per invocation, including `tool_name`
//     ("Bash" for shell calls) and, for Bash, `tool_input.command` (the
//     shell string) — plus common fields (session_id, cwd, hook_event_name,
//     ...) this hook ignores.
//   - A deny is signalled by exiting 0 and printing
//     `{"hookSpecificOutput":{"hookEventName":"PreToolUse",
//     "permissionDecision":"deny","permissionDecisionReason":"..."}}` to
//     stdout (the documented "JSON output" decision-control mechanism; exit
//     code 2 also blocks a PreToolUse call, but only the JSON form carries a
//     reason back to the model).
//   - Allow is simply: no stdout, exit 0.
//
// The actual read/write classification is pure in `gh-guard.ts`; this file
// only wires stdin/stdout/the log file to it.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classifyGhCommand } from './gh-guard.ts';

interface PreToolUseEvent {
  tool_name?: string;
  tool_input?: { command?: string };
}

const logFile =
  process.env.GINGUR_GH_GUARD_LOG ??
  join(process.env.RUNNER_TEMP ?? process.env.GITHUB_WORKSPACE ?? '.', 'gh-guard-deny.log');

const raw = await Bun.stdin.text();

let event: PreToolUseEvent;
try {
  event = JSON.parse(raw) as PreToolUseEvent;
} catch {
  // Unparseable input — nothing to classify. Fail open: this hook only ever
  // adds denials on top of a command it can positively identify as a gh
  // mutation, never blocks on ambiguity about the event envelope itself.
  process.exit(0);
}

const command = event.tool_name === 'Bash' ? event.tool_input?.command : undefined;
if (typeof command !== 'string' || classifyGhCommand(command) === 'allow') {
  process.exit(0);
}

const reason =
  `gh-guard: blocked raw \`gh\` mutation — use the driver's skills/ wrappers ` +
  `instead of raw gh (see gingur/driver CLAUDE.md): ${command}`;

mkdirSync(dirname(logFile), { recursive: true });
appendFileSync(logFile, `${new Date().toISOString()} ${command}\n`);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }),
);
console.error(reason);
