#!/usr/bin/env node
// devkit — one executable over the tooling devkit manages.
//
// A consumer's package.json declares `@gingur/devkit` and nothing else for
// lint/format/pre-commit, and calls these subcommands instead of raw tool
// binaries. devkit owns the versions; the subcommand names are the stable
// surface. Commands live one-per-file under commands/; see router.mjs.

import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { register } from './router.mjs';

const program = new Command('devkit').description(
  'Managed lint, format and pre-commit tooling for @gingur projects',
);

await register(program, fileURLToPath(new URL('./commands', import.meta.url)));

// Commander exits 1 on a usage error; devkit uses 2, and the tests pin it. The
// override is not inherited by commands added with addCommand, so it is applied
// to every node — without this, `devkit frobnicate` exits 2 while
// `devkit hooks uninstall` exits 1.
//
// Displayed help is a success even when Commander reaches it by erroring — a
// bare `devkit`, or a group named without a subcommand, should print usage and
// exit 0. Only a real usage error (unknown command, unknown option, bad
// argument) is a 2.
/**
 * @param {Command} command
 * @returns {void}
 */
function pinExitCodes(command) {
  command.exitOverride((err) => {
    const informational = err.code.startsWith('commander.help') || err.code === 'commander.version';
    process.exit(informational ? 0 : 2);
  });
  command.commands.forEach(pinExitCodes);
}
pinExitCodes(program);

await program.parseAsync(process.argv);
