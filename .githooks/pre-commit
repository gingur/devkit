#!/bin/sh
# devkit-managed git hook entry point. Installed by `devkit hooks install` and
# COMMITTED on purpose — that is the whole point of it.
#
# husky points core.hooksPath at .husky/_, which it generates during install and
# gitignores. core.hooksPath is repository config, so every `git worktree add`
# inherits it, but the worktree has no node_modules and therefore no .husky/_.
# Git does not warn when core.hooksPath names a directory that does not exist;
# it runs no hook and exits 0. Commits from a worktree silently skip every
# check. Confirmed on three worktrees of gingur/spinquest-lab.
#
# Being tracked, this file exists in every worktree. When the tooling is missing
# it says so and fails, because a hook that cannot run must not look like a hook
# that passed.

set -e

hook=$(basename "$0")
here=$(cd "$(dirname "$0")/.." && pwd)

# A worktree has its own directory but shares the main checkout's git dir, which
# is where the installed dependencies live.
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=''
[ -n "$common" ] && main=$(dirname "$common") || main=''

root=''
for candidate in "$here" "$main"; do
  [ -n "$candidate" ] || continue
  if [ -d "$candidate/node_modules/.bin" ]; then
    root=$candidate
    break
  fi
done

if [ -z "$root" ]; then
  echo "devkit: no node_modules in $here" >&2
  [ -n "$main" ] && [ "$main" != "$here" ] && echo "devkit: nor in the main worktree $main" >&2
  echo "devkit: cannot run the $hook hook — run 'pnpm install' here." >&2
  echo "devkit: refusing to commit with checks silently disabled." >&2
  exit 1
fi

PATH="$root/node_modules/.bin:$PATH"
export PATH

# The hook body stays where husky kept it, so adopting this costs no edits.
body="$here/.husky/$hook"
[ -f "$body" ] || exit 0

sh -e "$body" "$@"
