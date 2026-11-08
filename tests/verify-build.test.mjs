/* [INPUT]: Real verification helper with isolated compiler/build command substitutes.
 * [OUTPUT]: One shared web build, both Rust profiles, stale/missing output and failure recovery.
 * [POS]: Build reuse regression; never compiles or overwrites the working checkout.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('verification reuses web bytes across profiles and rebuilds changed or damaged outputs', (t) => {
  const root = resolve(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'palboo-verify-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of ['scripts', 'src', 'ui', '.cargo', 'bin']) mkdirSync(join(dir, path));
  for (const name of ['verify.mjs', 'brand.mjs', 'artifact-audit.mjs'])
    copyFileSync(join(root, 'scripts', name), join(dir, 'scripts', name));
  for (const name of [
    'Cargo.toml',
    'Cargo.lock',
    'package.json',
    'package-lock.json',
    'build.rs',
    'scripts/build-panel.mjs',
    'scripts/third-party-notices.mjs',
    'scripts/license-texts.json',
    'tsconfig.json',
    'ui/entry.js',
  ])
    writeFileSync(join(dir, name), '{}');
  const command = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const name = path.basename(process.argv[1]);
if (name === 'rustc') { console.log('fixture-rustc'); process.exit(); }
fs.appendFileSync('calls.txt', name + ' ' + process.argv.slice(2).join(' ') + '\\n');
if (name === 'npm') {
  fs.mkdirSync('target/web', {recursive:true});
  if (process.env.BUILD_FAIL) { fs.writeFileSync('target/web/index.html', 'partial'); process.exit(1); }
  for (const entry of ['index','board','feature','reader'])
    fs.writeFileSync('target/web/' + entry + '.html', fs.readFileSync('ui/entry.js'));
} else {
  const profile = process.argv.includes('--release') ? 'release' : 'debug';
  fs.mkdirSync('target/' + profile, {recursive:true});
  fs.writeFileSync('target/' + profile + '/palboo', '#!/bin/sh\\nprintf "palboo 1.0.0"\\n', {mode:0o755});
}
`;
  for (const name of ['npm', 'cargo', 'rustc'])
    writeFileSync(join(dir, 'bin', name), command, { mode: 0o755 });
  const run = (extra = {}) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {prepareTestBinary} from './scripts/verify.mjs'; prepareTestBinary('debug'); prepareTestBinary('release');",
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, ...extra },
      },
    );
  const builds = () => readFileSync(join(dir, 'calls.txt'), 'utf8').trim().split('\n');
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(builds(), [
    'npm run build:web',
    'cargo build --locked',
    'cargo build --locked --release',
  ]);
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(builds().length, 3);

  // A cache may restore an ordinary CLI that cargo test did not rebuild.
  writeFileSync(join(dir, 'target/debug/palboo'), '#!/bin/sh\nprintf "palboo stale"\n');
  assert.equal(run().status, 0);
  assert.equal(builds().filter((line) => line === 'cargo build --locked').length, 2);
  assert.equal(builds().filter((line) => line === 'cargo build --locked --release').length, 1);
  assert.match(readFileSync(join(dir, 'target/debug/palboo'), 'utf8'), /palboo 1\.0\.0/);

  writeFileSync(join(dir, 'target/web/reader.html'), 'corrupted');
  assert.equal(run().status, 0);
  assert.equal(readFileSync(join(dir, 'target/web/reader.html'), 'utf8'), '{}');
  rmSync(join(dir, 'target/web/index.html'));
  assert.equal(run().status, 0);
  assert.equal(builds().filter((line) => line.startsWith('npm')).length, 3);
  assert.equal(builds().filter((line) => line.startsWith('cargo')).length, 3);

  writeFileSync(join(dir, 'ui/entry.js'), 'new source');
  assert.notEqual(run({ BUILD_FAIL: '1' }).status, 0);
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(dir, 'target/web/reader.html'), 'utf8'), 'new source');
  assert.equal(builds().filter((line) => line.startsWith('cargo')).length, 5);
});
