// Resolution for the tools devkit manages on a consumer's behalf.
//
// Consumers depend on `@gingur/devkit` alone, so oxlint, oxfmt and lint-staged
// are devkit's own dependencies — under pnpm's strict layout they never appear
// in the consumer's `node_modules/.bin`. Nothing may invoke them by bare name.
// Everything goes through `toolBin`, which resolves them out of devkit's own
// install tree from wherever devkit happens to be installed.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Absolute path to a managed tool's executable. `pkg` is the npm package name,
 * which is also its bin name for every tool devkit manages.
 *
 * @param {string} pkg
 * @returns {string}
 */
export function toolBin(pkg) {
  const manifest = require.resolve(`${pkg}/package.json`);
  /** @type {{ bin: string | Record<string, string | undefined> }} */
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
  const entry = typeof bin === 'string' ? bin : bin[pkg];
  // Reading an arbitrary package's manifest is genuinely fallible, and the
  // alternative failure is a path join against undefined several frames later.
  if (!entry) throw new Error(`${pkg} declares no bin named "${pkg}"`);
  return join(dirname(manifest), entry);
}

/**
 * The argv prefix that runs a managed tool.
 *
 * Every tool devkit manages ships a `#!/usr/bin/env node` script rather than a
 * native binary (oxlint and oxfmt are thin shims over a `dist/cli.js`). Running
 * them through `process.execPath` instead of the shebang keeps them on the same
 * runtime that started devkit, and does not depend on the executable bit
 * surviving a checkout on a filesystem that does not carry one.
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

/**
 * Run a managed tool in the caller's cwd and exit with its result.
 *
 * @param {string} pkg
 * @param {string[]} args
 * @returns {void}
 */
export function runTool(pkg, args) {
  const [exe, ...prefix] = toolArgv(pkg);
  const child = spawn(exe, [...prefix, ...args], { stdio: 'inherit' });

  // A tool killed by a signal has a null exit code. Report it the way a shell
  // does so a caller's `set -e` and CI both see a failure rather than a 0.
  child.on('exit', (code, signal) => {
    process.exit(signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 0));
  });
}
