// Resolution for the tools devkit manages on a consumer's behalf.
//
// Consumers depend on `@gingur/devkit` alone, so oxlint, oxfmt and lint-staged
// are devkit's own dependencies — under pnpm's strict layout they never appear
// in the consumer's `node_modules/.bin`. Nothing may invoke them by bare name.
// Everything goes through `toolBin`, which resolves them out of devkit's own
// install tree from wherever devkit happens to be installed.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Absolute path to a managed tool's executable.
 *
 * @param {string} pkg npm package name, which is also its bin name for every
 *   tool devkit manages (`oxlint`, `oxfmt`, `lint-staged`).
 * @returns {string}
 */
export function toolBin(pkg) {
  const manifest = require.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
  return join(dirname(manifest), typeof bin === 'string' ? bin : bin[pkg]);
}

/**
 * The argv prefix that runs a managed tool.
 *
 * Every tool devkit manages ships a `#!/usr/bin/env node` script rather than a
 * native binary (oxlint and oxfmt are thin shims over a `dist/cli.js`). Running
 * them through `process.execPath` instead of the shebang keeps them on the same
 * Node that started devkit, and does not depend on the executable bit surviving
 * a checkout on a filesystem that does not carry one.
 *
 * @param {string} pkg
 * @returns {[string, string]}
 */
export function toolArgv(pkg) {
  return [process.execPath, toolBin(pkg)];
}

/**
 * A shell command string that runs a managed tool, for callers that can only
 * express a command as text — lint-staged task arrays, chiefly.
 *
 * @param {string} pkg
 * @returns {string}
 */
export function toolCommand(pkg) {
  return toolArgv(pkg)
    .map((part) => JSON.stringify(part))
    .join(' ');
}
