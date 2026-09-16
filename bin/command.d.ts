// The contract every file under commands/ implements.
//
// Types only — bin/ is JavaScript, checked through JSDoc. Node refuses to strip
// types for files under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING,
// confirmed on 22 and 24, no flag lifts it), which is exactly where a consumer
// runs devkit from. So the runtime is .mjs and the types live here.
//
// `kind` is the load-bearing field. devkit's commands split into two sorts with
// opposite flag semantics, and the router needs to know which it is *before* it
// parses anything:
//
//   passthrough — devkit must stay blind. `devkit lint --quiet src/` works only
//                 because nothing between the subcommand and oxlint interprets
//                 those arguments. That blindness is the documented escape hatch
//                 for flags devkit does not model.
//   parsed      — devkit owns the flags. An unknown one is a user error, not
//                 something to forward to a tool that will misread it.

import type { Command } from 'commander';

export interface PassthroughCommand {
  kind: 'passthrough';
  describe: string;
  /** Receives every argument after the subcommand, in order, unparsed. */
  run(argv: string[]): void | Promise<void>;
}

export interface ParsedCommand<Options = Record<string, unknown>> {
  kind: 'parsed';
  describe: string;
  /** Declare `.option()` / `.argument()` here; runs at registration time. */
  configure?(command: Command): void;
  run(options: Options, args: string[]): void | Promise<void>;
}

export type CommandModule = PassthroughCommand | ParsedCommand;

/** Optional `index.mjs` in a command directory, describing the group itself. */
export interface CommandGroup {
  describe: string;
}

/** A command file, and the command path its location implies. */
export interface Route {
  /** e.g. `['hooks', 'install']` */
  path: string[];
  file: string;
}
