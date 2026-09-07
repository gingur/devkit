// Hand both tools everything staged rather than curating an extension
// allowlist. oxfmt's detection is a linguist-style table keyed on full filename
// as well as extension -- it formats `.webmanifest`, `.pcss`, `.code-workspace`
// and bare `.prettierrc`, among others -- so any allowlist drifts from it
// silently, leaving file types that a repo-wide `oxfmt --check` rejects but the
// hook waved through. That divergence is what a shared config exists to prevent.
//
// Safe because each tool ignores input it cannot parse: given a mixed batch,
// oxfmt formats only what it recognises and leaves the rest byte-identical,
// binaries included, and oxlint reports the same diagnostics it would have
// reported alone.
//
// Both need --no-error-on-unmatched-pattern: each exits non-zero when every
// path it was handed is excluded by an ignore file, which a commit confined to
// an ignored directory (`dist/`, `coverage/`) produces. That is a clean commit,
// not a failure.
const FORMAT = 'oxfmt --no-error-on-unmatched-pattern';
const LINT = 'oxlint --fix --no-error-on-unmatched-pattern';

export default {
  // A single group, so formatting finishes before linting starts on the same
  // file. Separate globs would put them in different task groups, which
  // lint-staged runs concurrently -- two writers on one file.
  '*': [FORMAT, LINT],
};
