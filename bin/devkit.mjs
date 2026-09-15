#!/usr/bin/env node
// devkit — one executable over the tooling devkit manages.
//
// A consumer's package.json declares `@gingur/devkit` and nothing else for
// lint/format/pre-commit, and calls these subcommands instead of raw tool
// binaries. devkit owns the versions; the subcommand names are the stable
// surface.
//
// Arguments after the subcommand pass through untouched, so a repo needing a
// flag devkit does not model just adds it: `devkit lint --quiet src/`.

import { spawn } from 'node:child_process';
import { constants } from 'node:os';

import { toolArgv } from './tools.mjs';

const USAGE = `devkit — managed lint, format and pre-commit tooling

  devkit lint [...args]      oxlint over the repo
  devkit fmt [...args]       oxfmt over the repo
  devkit staged [...args]    lint-staged, for a pre-commit hook
  devkit hooks install       install husky's git hooks

Arguments after the subcommand pass through to the underlying tool.
`;

/** Run a managed tool in the caller's cwd and exit with its result. */
function run(pkg, args) {
  const [exe, ...prefix] = toolArgv(pkg);
  const child = spawn(exe, [...prefix, ...args], { stdio: 'inherit' });

  // A tool killed by a signal has a null exit code. Report it the way a shell
  // does so a caller's `set -e` and CI both see a failure rather than a 0.
  child.on('exit', (code, signal) => {
    process.exit(signal ? 128 + (constants.signals[signal] ?? 0) : code);
  });
}

/** Install husky's hooks via its programmatic entry point. */
async function installHooks() {
  const { default: husky } = await import('husky');
  const message = husky();
  if (message) console.log(message);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'lint':
    run('oxlint', args);
    break;
  case 'fmt':
    run('oxfmt', args);
    break;
  case 'staged':
    run('lint-staged', args);
    break;
  case 'hooks':
    if (args[0] !== 'install') {
      console.error(`devkit hooks: expected \`install\`, got \`${args[0] ?? ''}\`\n\n${USAGE}`);
      process.exit(2);
    }
    await installHooks();
    break;
  case undefined:
  case '-h':
  case '--help':
    console.log(USAGE);
    break;
  default:
    console.error(`devkit: unknown command \`${command}\`\n\n${USAGE}`);
    process.exit(2);
}
