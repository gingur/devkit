// File-based routing: the directory structure under commands/ is the command
// path. `commands/hooks/install.ts` is `devkit hooks install`. Adding a command
// means adding a file; nothing here changes.
//
// Command modules are imported eagerly, and that is deliberate rather than a
// missed optimisation. Commander needs each command's option specs at
// registration time to generate help and to reject unknown flags, so a command
// cannot be loaded only once it is matched. The cost is kept near zero by
// keeping command modules thin — metadata and a handler, with heavy work behind
// a lazy import *inside* the handler.

import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Command } from 'commander';

import type { CommandGroup, CommandModule, Route } from './command.ts';

const COMMAND_EXT = '.ts';
const GROUP_FILE = 'index';

function isRoutable(name: string): boolean {
  return extname(name) === COMMAND_EXT && !name.includes('.test.');
}

/** Walk a commands directory into routes, depth-first, alphabetically. */
export async function discover(dir: string, prefix: string[] = []): Promise<Route[]> {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const routes: Route[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...(await discover(full, [...prefix, entry.name])));
    } else if (isRoutable(entry.name)) {
      const name = basename(entry.name, COMMAND_EXT);
      // index.ts describes the group it sits in; it is not itself a command.
      if (name === GROUP_FILE) continue;
      routes.push({ path: [...prefix, name], file: full });
    }
  }

  return routes;
}

async function load<T>(file: string): Promise<T> {
  // A bare Windows path is not a valid ESM specifier.
  return (await import(pathToFileURL(file).href)).default as T;
}

/**
 * Find or create the Command that owns `path`'s final segment, creating
 * intermediate group commands as needed.
 */
async function parentOf(program: Command, path: string[], dir: string): Promise<Command> {
  let parent = program;

  for (const [depth, segment] of path.slice(0, -1).entries()) {
    const existing = parent.commands.find((c) => c.name() === segment);
    if (existing) {
      parent = existing;
      continue;
    }

    const groupFile = join(dir, ...path.slice(0, depth + 1), `${GROUP_FILE}${COMMAND_EXT}`);
    const meta = await load<CommandGroup | undefined>(groupFile).catch(() => undefined);

    const group = new Command(segment).description(meta?.describe ?? `${segment} commands`);
    parent.addCommand(group);
    parent = group;
  }

  return parent;
}

function applyPassthrough(
  command: Command,
  module: Extract<CommandModule, { kind: 'passthrough' }>,
): void {
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
    .action((args: string[]) => module.run(args));
}

function applyParsed(command: Command, module: Extract<CommandModule, { kind: 'parsed' }>): void {
  module.configure?.(command);
  command.action((...argv: unknown[]) => {
    // Commander passes declared arguments, then options, then the Command.
    const options = argv.at(-2) as Record<string, unknown>;
    const args = argv.slice(0, -2) as string[][];
    return module.run(options, args.flat());
  });
}

/** Register every command found under `dir` onto `program`. */
export async function register(program: Command, dir: string): Promise<Route[]> {
  // Pass-through in a subcommand requires positional options on the program,
  // so that `devkit lint --fix` does not resolve `--fix` against devkit itself.
  program.enablePositionalOptions();

  const routes = await discover(dir);

  for (const route of routes) {
    const module = await load<CommandModule>(route.file);
    const command = new Command(route.path.at(-1)).description(module.describe);

    if (module.kind === 'passthrough') applyPassthrough(command, module);
    else applyParsed(command, module);

    (await parentOf(program, route.path, dir)).addCommand(command);
  }

  return routes;
}
