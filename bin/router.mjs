// File-based routing: the directory structure under commands/ is the command
// path. `commands/hooks/install.mjs` is `devkit hooks install`. Adding a command
// means adding a file; nothing here changes.
//
// Command modules are imported eagerly, and that is deliberate rather than a
// missed optimisation. Commander needs each command's option specs at
// registration time to generate help and to reject unknown flags, so a command
// cannot be loaded only once it is matched. The cost is kept near zero by
// keeping command modules thin — metadata and a handler, with heavy work behind
// a lazy import *inside* the handler.

/** @import { CommandGroup, CommandModule, Route } from './command.d.ts' */

import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Command } from 'commander';

const COMMAND_EXT = '.mjs';
const GROUP_FILE = 'index';

/**
 * @param {string} name
 * @returns {boolean}
 */
function isRoutable(name) {
  return extname(name) === COMMAND_EXT && !name.includes('.test.');
}

/**
 * Walk a commands directory into routes, depth-first, alphabetically.
 *
 * @param {string} dir
 * @param {string[]} [prefix]
 * @returns {Promise<Route[]>}
 */
export async function discover(dir, prefix = []) {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  /** @type {Route[]} */
  const routes = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...(await discover(full, [...prefix, entry.name])));
    } else if (isRoutable(entry.name)) {
      const name = basename(entry.name, COMMAND_EXT);
      // index.mjs describes the group it sits in; it is not itself a command.
      if (name === GROUP_FILE) continue;
      routes.push({ path: [...prefix, name], file: full });
    }
  }

  return routes;
}

/**
 * @template T
 * @param {string} file
 * @returns {Promise<T>}
 */
async function load(file) {
  // A bare Windows path is not a valid ESM specifier.
  return (await import(pathToFileURL(file).href)).default;
}

/**
 * Find or create the Command that owns `path`'s final segment, creating
 * intermediate group commands as needed.
 *
 * @param {Command} program
 * @param {string[]} path
 * @param {string} dir
 * @returns {Promise<Command>}
 */
async function parentOf(program, path, dir) {
  let parent = program;

  for (const [depth, segment] of path.slice(0, -1).entries()) {
    const existing = parent.commands.find((c) => c.name() === segment);
    if (existing) {
      parent = existing;
      continue;
    }

    const groupFile = join(dir, ...path.slice(0, depth + 1), `${GROUP_FILE}${COMMAND_EXT}`);
    /** @type {CommandGroup | undefined} */
    const meta = await load(groupFile).catch(() => undefined);

    const group = new Command(segment).description(meta?.describe ?? `${segment} commands`);
    parent.addCommand(group);
    parent = group;
  }

  return parent;
}

/**
 * @param {Command} command
 * @param {Extract<CommandModule, { kind: 'passthrough' }>} module
 * @returns {void}
 */
function applyPassthrough(command, module) {
  command
    .argument('[args...]')
    // Without this an unmodelled flag is an error; with it, it becomes an
    // ordinary command-argument and reaches the tool. This is what makes
    // `devkit lint --fix` work.
    .allowUnknownOption()
    // And this keeps options *after* a path from being reparsed as devkit's:
    // `devkit lint src/ --fix`.
    .passThroughOptions()
    // Commander would otherwise answer `devkit lint --help` itself. A blind
    // wrapper must let the tool answer for its own flags.
    .helpOption(false)
    .action((args) => module.run(args));
}

/**
 * @param {Command} command
 * @param {Extract<CommandModule, { kind: 'parsed' }>} module
 * @returns {void}
 */
function applyParsed(command, module) {
  module.configure?.(command);
  command.action((/** @type {unknown[]} */ ...argv) => {
    // Commander passes declared arguments, then options, then the Command.
    const options = /** @type {Record<string, unknown>} */ (argv.at(-2));
    const args = /** @type {string[]} */ (argv.slice(0, -2));
    return module.run(options, args.flat());
  });
}

/**
 * Register every command found under `dir` onto `program`.
 *
 * @param {Command} program
 * @param {string} dir
 * @returns {Promise<Route[]>}
 */
export async function register(program, dir) {
  // Pass-through in a subcommand requires positional options on the program,
  // so that `devkit lint --fix` does not resolve `--fix` against devkit itself.
  program.enablePositionalOptions();

  const routes = await discover(dir);

  for (const route of routes) {
    /** @type {CommandModule} */
    const module = await load(route.file);
    const command = new Command(route.path.at(-1)).description(module.describe);

    if (module.kind === 'passthrough') applyPassthrough(command, module);
    else applyParsed(command, module);

    (await parentOf(program, route.path, dir)).addCommand(command);
  }

  return routes;
}
