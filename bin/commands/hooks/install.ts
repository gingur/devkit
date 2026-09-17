import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedCommand } from '../../command.ts';

const HOOKS_DIR = '.githooks';
const BODY_DIR = '.husky';
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
    // This runs from `prepare`, so it fires on every install — including ones
    // with no git repository at all, such as a Docker build that copies source
    // without .git. That is a normal condition, not a miswiring, and it must
    // not fail the install.
    let root: string;
    try {
      root = git('rev-parse', '--show-toplevel');
    } catch {
      console.log('devkit: not a git repository — skipping hook install');
      return;
    }

    const dir = join(root, HOOKS_DIR);
    mkdirSync(dir, { recursive: true });

    for (const hook of HOOKS) {
      const path = join(dir, hook);
      copyFileSync(SHIM, path);

      // Both modes, because they are different things and each fails alone.
      //
      // The filesystem bit is what git checks before RUNNING the hook here;
      // copyFileSync does not carry it, and without this git skips the hook
      // with only a `hint:` on stderr. Caught exactly that way on this repo.
      chmodSync(path, 0o755);

      // The tracked bit is what every OTHER checkout gets. On Windows
      // chmodSync cannot set a POSIX bit and Git for Windows runs
      // core.filemode=false, so the recorded mode would be 100644 and the shim
      // would be inert for everyone. update-index --chmod is honoured
      // regardless of core.filemode.
      git('update-index', '--add', '--chmod=+x', `${HOOKS_DIR}/${hook}`);

      // The shim runs the body and refuses when it is missing, so say so at
      // install time rather than at the first commit.
      if (!existsSync(join(root, BODY_DIR, hook))) {
        console.log(
          `devkit: no ${BODY_DIR}/${hook} yet — create it, or the ${hook} hook will fail`,
        );
      }
    }

    git('config', 'core.hooksPath', HOOKS_DIR);

    console.log(`devkit: installed ${HOOKS.map((h) => `${HOOKS_DIR}/${h}`).join(', ')}`);
    console.log(`devkit: core.hooksPath -> ${HOOKS_DIR}`);
    console.log(`devkit: commit ${HOOKS_DIR}/ — tracked is what makes it work in worktrees`);
  },
} satisfies ParsedCommand;
