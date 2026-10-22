/*
 * [INPUT]: 独立 Foundation 偏好域、旧/新 Dev Dock 固定项和私有临时备份目录。
 * [OUTPUT]: 原位迁移、旧书签清理、重复项去重、无固定项零新增及其他偏好保留回归。
 * [POS]: 开发安装器的系统偏好集成验收；不读写用户 Dock 或刷新 Dock。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { repairDevelopmentDock } from '../scripts/dev-dock.mjs';

function run(source) {
  const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-'], {
    encoding: 'utf8',
    input: `ObjC.import('Foundation');\n${source}`,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}

test(
  'Dev Dock migration preserves position and unrelated preferences, removes old aliases and duplicates',
  {
    skip: process.platform !== 'darwin',
  },
  (t) => {
    const domain = `local.palboo.dock-test.${randomUUID()}`;
    const root = mkdtempSync(join(tmpdir(), 'palboo-dock-'));
    const defaults = `const d = $.NSUserDefaults.alloc.initWithSuiteName(${JSON.stringify(domain)});`;
    t.after(() => {
      run(`${defaults} d.removePersistentDomainForName(${JSON.stringify(domain)}); d.synchronize;`);
      rmSync(root, { recursive: true, force: true });
    });
    const other = {
      'tile-type': 'file-tile',
      'tile-data': { 'bundle-identifier': 'other.app', book: 'keep' },
    };
    const old = {
      GUID: 99,
      'tile-type': 'file-tile',
      'tile-data': {
        'bundle-identifier': 'local.codex-buddy.dev-launcher',
        book: 'old-file-identity',
        'file-data': { _CFURLString: 'file:///private/archive/CodexBuddy%20Dev.app/' },
      },
    };
    run(
      `${defaults} d.setPersistentDomainForName($({'persistent-apps': ${JSON.stringify([other, old, other, old])}, 'other-setting': 42}), ${JSON.stringify(domain)}); d.synchronize;`,
    );
    const result = repairDevelopmentDock({ domain, backupDirectory: join(root, 'backup') });
    assert.equal(result.changed, 2);
    assert.equal(statSync(result.backup).mode & 0o777, 0o600);
    assert.match(readFileSync(result.backup, 'utf8'), /old-file-identity/);
    const saved = run(
      `${defaults} JSON.stringify(ObjC.deepUnwrap(d.persistentDomainForName(${JSON.stringify(domain)})));`,
    );
    assert.equal(saved['other-setting'], 42);
    assert.equal(saved['persistent-apps'].length, 3);
    assert.deepEqual(saved['persistent-apps'][0], other);
    assert.deepEqual(saved['persistent-apps'][2], other);
    const tile = saved['persistent-apps'][1]['tile-data'];
    assert.equal(tile['bundle-identifier'], 'local.palboo.dev-launcher');
    assert.equal(tile['file-data']._CFURLString, 'file:///Applications/Palboo%20Dev.app/');
    assert.equal(tile.book, undefined);
    assert.deepEqual(repairDevelopmentDock({ domain, backupDirectory: join(root, 'repeat') }), {
      changed: 0,
    });
    run(
      `${defaults} d.setObjectForKey($(${JSON.stringify([other])}), 'persistent-apps'); d.synchronize;`,
    );
    assert.deepEqual(repairDevelopmentDock({ domain, backupDirectory: join(root, 'unpinned') }), {
      changed: 0,
    });
    assert.deepEqual(
      run(`${defaults} JSON.stringify(ObjC.deepUnwrap(d.objectForKey('persistent-apps')));`),
      [other],
    );
  },
);
