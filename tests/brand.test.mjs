/*
 * [INPUT]: Product identity helpers and isolated old/new checkout metadata.
 * [OUTPUT]: PALBOO precedence, old worktree environment compatibility and binary selection.
 * [POS]: Rename regression; no user files, services or credentials are read.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleEnvironment, sourceBinaryName } from '../scripts/brand.mjs';

test('new environment names take precedence while older worktrees receive aliases', () => {
  const original = { CODEX_BUDDY_HOME: '/old', PALBOO_HOME: '/new', PATH: '/bin' };
  assert.deepEqual(compatibleEnvironment(original), {
    CODEX_BUDDY_HOME: '/new',
    PALBOO_HOME: '/new',
    PATH: '/bin',
  });
  assert.equal(original.CODEX_BUDDY_HOME, '/old');
  assert.equal(
    compatibleEnvironment({ CODEX_BUDDY_DEV_ASSETS: '/fixture' }).PALBOO_DEV_ASSETS,
    '/fixture',
  );
  assert.equal(
    compatibleEnvironment({ CODEX_BUDDY_MODEL: 'old', PALBOO_MODEL: '' }).PALBOO_MODEL,
    '',
    'an explicitly empty current value must not revive the old one',
  );
});

test('the source package determines its executable without rewriting an older worktree', () => {
  const directory = mkdtempSync(join(tmpdir(), 'palboo-brand-'));
  try {
    const path = join(directory, 'package.json');
    writeFileSync(path, '{"name":"codex-buddy"}');
    assert.equal(sourceBinaryName(directory), 'codex-buddy');
    writeFileSync(path, '{"name":"palboo"}');
    assert.equal(sourceBinaryName(directory), 'palboo');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { migrateBrandStorage } from '../ui/shared/brand-storage.js';
test('stored preferences migrate once, retain old values and never overwrite current choices', () => {
  const values = new Map([
    ['codex-buddy-dev:companion-stepwise-panel-width-v1', '415'],
    ['codex-buddy-liquid-variant', 'clear'],
    ['palboo-liquid-variant', 'regular'],
    ['unrelated', 'untouched'],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  migrateBrandStorage(storage);
  assert.equal(values.get('palboo-dev:companion-stepwise-panel-width-v1'), '415');
  assert.equal(values.get('palboo-liquid-variant'), 'regular');
  assert.equal(values.get('codex-buddy-liquid-variant'), 'clear');
  assert.equal(values.get('unrelated'), 'untouched');
  values.delete('palboo-dev:companion-stepwise-panel-width-v1');
  migrateBrandStorage(storage);
  assert.equal(values.has('palboo-dev:companion-stepwise-panel-width-v1'), false);
  assert.doesNotThrow(() =>
    migrateBrandStorage({
      getItem() {
        throw Error('denied');
      },
    }),
  );
});
