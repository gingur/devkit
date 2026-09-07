// Globs track what oxfmt and oxlint can each handle, not what any one consumer
// happens to have. A file type the repo-wide `oxfmt --check` rejects but the
// hook never sees is a gate that only fails in CI.
//
// Verified against oxfmt 0.58 / oxlint 1.73:
//   both      js mjs cjs jsx ts mts cts tsx vue
//   lint only astro svelte          (oxfmt has no parser for these)
//   fmt only  json jsonc json5 md mdx markdown yml yaml css scss less
//             html htm toml graphql gql
// Not supported by either: sass (indented syntax), xml.
//
// `--no-error-on-unmatched-pattern` because oxfmt exits 2 when every path it is
// handed is excluded by an ignore file, which a commit confined to an ignored
// directory produces. That is a clean commit, not a failure.
const FORMAT = 'oxfmt --no-error-on-unmatched-pattern';
const LINT = 'oxlint --fix';

export default {
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}': [FORMAT, LINT],
  '*.{astro,svelte}': [LINT],
  '*.{json,jsonc,json5,md,mdx,markdown,yml,yaml,css,scss,less,html,htm,toml,graphql,gql}': [FORMAT],
};
