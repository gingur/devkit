import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedCommand } from '../../command.ts';

const HOOKS_DIR = '.githooks';
const SHIM = fileURLToPath(new URL('./shim.sh', import.meta.url));

/** Hooks devkit installs a shim for. The shim dispatches on its own basename. */
const HOOKS = ['pre-commit'];

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export default {
  kind: 'parsed',
  describe: "Install devkit's git hooks",
  run() {
    // Worktrees share the main checkout's git dir, so installing from one would
    // write the shim into the wrong tree.
    const root = git('rev-parse', '--show-toplevel');
    const dir = join(root, HOOKS_DIR);
    mkdirSync(dir, { recursive: true });

    for (const hook of HOOKS) {
      const path = join(dir, hook);
      copyFileSync(SHIM, path);
      // Git skips a hook that is not executable, emitting only a `hint:` line —
      // another way for a hook to be absent without looking absent.
      chmodSync(path, 0o755);
    }

    git('config', 'core.hooksPath', HOOKS_DIR);

    console.log(`devkit: installed ${HOOKS.map((h) => `${HOOKS_DIR}/${h}`).join(', ')}`);
    console.log(`devkit: core.hooksPath -> ${HOOKS_DIR}`);
    console.log(`devkit: commit ${HOOKS_DIR}/ — tracked is what makes it work in worktrees`);
  },
} satisfies ParsedCommand;
