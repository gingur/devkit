// The guard that makes file-based routing trustworthy: every file under
// commands/ must actually become a command. A file that silently fails to
// register looks exactly like a file that was never added.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { discover, register } from './router.mjs';

const COMMANDS = fileURLToPath(new URL('./commands', import.meta.url));

/**
 * Every command path Commander actually ended up with, as dotted strings.
 *
 * @param {Command} command
 * @param {string[]} [prefix]
 * @returns {string[]}
 */
function registered(command, prefix = []) {
  return command.commands.flatMap((child) => {
    const path = [...prefix, child.name()];
    // `help` is Commander's own, not ours; groups contribute their children.
    if (child.name() === 'help') return [];
    return child.commands.length ? registered(child, path) : [path.join('.')];
  });
}

async function build() {
  const program = new Command('devkit');
  const routes = await register(program, COMMANDS);
  return { program, routes };
}

test('every discovered route becomes a registered command', async () => {
  const { program, routes } = await build();
  assert.deepEqual(registered(program).sort(), routes.map((r) => r.path.join('.')).sort());
});

test('the commands/ tree on disk matches the registered paths', async () => {
  // Deliberately re-walks the filesystem rather than reusing discover(), so a
  // bug in discover() cannot make this assertion agree with itself.
  const onDisk = [];
  for (const entry of await readdir(COMMANDS, { withFileTypes: true, recursive: true })) {
    if (!entry.name.endsWith('.mjs') || entry.name.includes('.test.')) continue;
    if (entry.name === 'index.mjs') continue; // group metadata, not a command
    const dir = entry.parentPath.slice(COMMANDS.length).split('/').filter(Boolean);
    onDisk.push([...dir, entry.name.replace(/\.mjs$/, '')].join('.'));
  }

  const { program } = await build();
  assert.deepEqual(registered(program).sort(), onDisk.sort());
});

test('every command declares a known kind and a description', async () => {
  const { routes } = await build();
  assert.ok(routes.length > 0, 'discovered no commands at all');

  for (const route of routes) {
    const module = (await import(route.file)).default;
    assert.ok(
      module.kind === 'passthrough' || module.kind === 'parsed',
      `${route.path.join(' ')} has kind ${String(module.kind)}`,
    );
    assert.ok(module.describe.length > 0, `${route.path.join(' ')} has no description`);
  }
});

test('a pass-through command accepts variadic arguments so nothing is dropped', async () => {
  // Flag semantics are asserted behaviourally in devkit.test.mjs — Commander
  // keeps allowUnknownOption/passThroughOptions/helpOption on private fields,
  // and pinning those here would test the library rather than the router. What
  // belongs here is that the router gave the command somewhere to put argv.
  const { program } = await build();
  const lint = program.commands.find((c) => c.name() === 'lint');
  assert.ok(lint, 'lint was not registered at all');

  const [argument, ...rest] = lint.registeredArguments;
  assert.equal(rest.length, 0, 'pass-through takes exactly one argument slot');
  assert.ok(argument?.variadic, 'pass-through args must be variadic');
});

test('discover ignores test files and group metadata', async () => {
  const routes = await discover(COMMANDS);
  assert.ok(!routes.some((r) => r.file.includes('.test.')));
  assert.ok(!routes.some((r) => r.path.at(-1) === 'index'));
});
