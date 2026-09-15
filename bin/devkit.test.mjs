// The CLI's contract: subcommands reach the right tool, arguments pass through
// untouched, and a failing tool fails the caller.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const CLI = fileURLToPath(new URL('./devkit.mjs', import.meta.url));

/** @param {string[]} args */
function devkit(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('no command prints usage and exits 0', () => {
  const { status, stdout } = devkit([]);
  assert.equal(status, 0);
  assert.match(stdout, /devkit lint/);
});

test('--help prints usage and exits 0', () => {
  assert.equal(devkit(['--help']).status, 0);
});

test('an unknown command exits 2 and names what was passed', () => {
  const { status, stderr } = devkit(['frobnicate']);
  assert.equal(status, 2);
  assert.match(stderr, /unknown command `frobnicate`/);
});

test('hooks rejects anything but install', () => {
  const { status, stderr } = devkit(['hooks', 'uninstall']);
  assert.equal(status, 2);
  assert.match(stderr, /expected `install`/);
});

// One case per subcommand, proving the argument reached the intended tool.
// --help is used because all three exit 0 and name themselves in the output,
// so the assertion does not depend on a working repo to lint or format.
for (const [command, signature] of [
  ['lint', /oxlint/i],
  ['fmt', /oxfmt/i],
  ['staged', /lint-staged/i],
]) {
  test(`${command} runs its tool and passes arguments through`, () => {
    const { status, stdout, stderr } = devkit([command, '--help']);
    assert.equal(status, 0, stderr);
    assert.match(stdout + stderr, signature);
  });
}

test("a tool's non-zero exit becomes the CLI's exit code", () => {
  // oxlint rejects an unknown flag. The point is that the failure propagates
  // rather than being swallowed by the wrapper.
  const { status } = devkit(['lint', '--not-a-real-flag']);
  assert.notEqual(status, 0);
});
