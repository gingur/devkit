/**
 * Vendored copy of gingur/infra `box/lib/gh-guard.ts` (gingur/infra#89) —
 * that file is the source of truth. This copy exists because
 * devkit's `actions/claude.reconcile` composite cannot depend on infra at
 * runtime (gingur/devkit#136, ask gingur/devkit#134; sourcing decision:
 * vendor, not runtime-clone or wait-for-published-package). Re-sync by hand
 * on infra-side change. De-dupe follow-up: once infra publishes gh-guard as
 * a shared package, drop this vendored copy (and gh-guard-hook.ts's import
 * of it) in favor of that dependency.
 */

/**
 * gh-layer shadow guard classifier (gingur/infra#89): pure decision logic
 * for whether a Bash command contains a raw `gh` *mutation*. This is the
 * belt-and-suspenders complement to the shadow gating that otherwise lives
 * only in `gingur/driver`'s action wrappers (`skills/lib/wrapper.ts`) — the
 * driver's own `CLAUDE.md` mandates "every consequential action goes
 * through the `skills/` wrappers — never raw `gh`." Those wrappers spawn
 * `gh` from **bun** (`bun …/skills/comment/comment.ts …`), never as a bare
 * `gh` Bash command, so this classifier never sees — and never interferes
 * with — the legitimate mutation path; it only catches the model typing raw
 * `gh` into a Bash tool call.
 *
 * Security posture: fail CLOSED on any `gh` invocation this classifier
 * doesn't specifically recognize as a read (unrecognized top-level
 * subcommand, bare `gh`, or a `gh api` call with no explicit read
 * indication). Never deny a non-`gh` command, no matter what it contains as
 * plain text (e.g. `echo gh pr merge` is inert and allowed).
 */

type Decision = 'allow' | 'deny';

const PREFIX_COMMANDS = new Set(['env', 'sudo', 'time']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const ISSUE_WRITE_VERBS = new Set(['comment', 'edit', 'close', 'reopen', 'delete', 'create']);
const PR_WRITE_VERBS = new Set([
  'comment',
  'edit',
  'close',
  'reopen',
  'merge',
  'ready',
  'review',
  'create',
]);
const CREATE_EDIT_DELETE = new Set(['create', 'edit', 'delete']);
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Split a shell string into top-level segments on `;`, `&&`, `||`, `|`,
    respecting single/double quotes so an operator inside a quoted argument
    is never mistaken for a segment boundary. */
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';') {
      segments.push(current);
      current = '';
      continue;
    }
    if ((ch === '&' || ch === '|') && command[i + 1] === ch) {
      segments.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === '|') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

/** Split one segment into words, honoring quotes (contents kept literal,
    quote characters themselves stripped) but doing no further shell
    semantics (no expansion) — sufficient to classify a command shape. */
function splitWords(segment: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let inWord = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      inWord = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) {
        words.push(current);
        current = '';
        inWord = false;
      }
      continue;
    }
    current += ch;
    inWord = true;
  }
  if (inWord) words.push(current);
  return words;
}

/** Drop leading env-var assignments (`FOO=bar`) and common prefix commands
    (`env`, `sudo`, `time`), in any order/repetition, to reach the real
    command word. */
function stripPrefixes(words: string[]): string[] {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (w !== undefined && (ENV_ASSIGNMENT.test(w) || PREFIX_COMMANDS.has(w))) {
      i++;
      continue;
    }
    break;
  }
  return words.slice(i);
}

function isGh(command: string): boolean {
  return command === 'gh' || command.endsWith('/gh');
}

function classifyWriteVerb(verb: string | undefined, writeVerbs: Set<string>): Decision {
  if (verb === undefined) return 'deny'; // ambiguous shape — fail closed
  return writeVerbs.has(verb) ? 'deny' : 'allow';
}

/** `gh api` is classified by HTTP method, not subcommand name: an explicit
    write method denies; an explicit non-write method (typically GET)
    allows regardless of `-f`/`-F`; with no explicit method, `-f`/`-F`/
    `--field`/`--input` imply gh's own default-to-POST behavior and deny;
    otherwise gh's default GET applies and it's a read. */
function classifyApi(args: string[]): Decision {
  let method: string | null = null;
  let hasFieldWrite = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '-X' || a === '--method') {
      method = (args[i + 1] ?? '').toUpperCase();
      i++;
      continue;
    }
    if (a.startsWith('--method=')) {
      method = a.slice('--method='.length).toUpperCase();
      continue;
    }
    if (a === '-f' || a === '-F' || a === '--field' || a === '--input') {
      hasFieldWrite = true;
      continue;
    }
    if (a.startsWith('--field=') || a.startsWith('--input=')) {
      hasFieldWrite = true;
      continue;
    }
  }
  if (method !== null) return WRITE_METHODS.has(method) ? 'deny' : 'allow';
  return hasFieldWrite ? 'deny' : 'allow';
}

function classifyGhInvocation(args: string[]): Decision {
  const sub = args[0];
  if (sub === undefined) return 'deny'; // bare `gh` — ambiguous, fail closed
  switch (sub) {
    case 'issue':
      return classifyWriteVerb(args[1], ISSUE_WRITE_VERBS);
    case 'pr':
      return classifyWriteVerb(args[1], PR_WRITE_VERBS);
    case 'release':
    case 'label':
    case 'milestone':
      return classifyWriteVerb(args[1], CREATE_EDIT_DELETE);
    case 'api':
      return classifyApi(args.slice(1));
    default:
      // Any other top-level gh subcommand (gh repo, gh workflow, gh secret,
      // gh run, ...) is unrecognized here — fail closed rather than guess.
      return 'deny';
  }
}

/**
 * Classify a full shell command string as "allow" or "deny". Denies if
 * *any* top-level segment (split on `;`, `&&`, `||`, `|`) is a `gh`
 * mutation; never denies a segment whose command isn't `gh` (by name or an
 * absolute path ending `/gh`), no matter what its arguments look like.
 */
export function classifyGhCommand(command: string): Decision {
  for (const rawSegment of splitSegments(command)) {
    const words = stripPrefixes(splitWords(rawSegment));
    const cmd = words[0];
    if (cmd === undefined || !isGh(cmd)) continue;
    if (classifyGhInvocation(words.slice(1)) === 'deny') return 'deny';
  }
  return 'allow';
}
