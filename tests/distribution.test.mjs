/*
 * [INPUT]: 发布计划、成品审计与 Swift 启动器。
 * [OUTPUT]: 发行包命名、成品隐私和启动器回归；发布状态与恢复见 release.test.mjs。
 * [POS]: 分发单元与合成集成测试，不启动真实后台或访问 GitHub。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  copyFileSync,
  renameSync,
  existsSync,
  symlinkSync,
  readdirSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { releasePlan } from '../scripts/release-plan.mjs';
import { auditArtifact, distributionEnvironment } from '../scripts/artifact-audit.mjs';

const root = resolve(import.meta.dirname, '..');
function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'palboo-distribution-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('every version produces one DMG, including patches and prereleases', () => {
  for (const version of [
    '0.9.0',
    '1.0.1',
    '1.12.0',
    '2.0.3-beta.1',
    '1.0.0-rc.1',
    '1.0.0+build.42',
  ]) {
    const plan = releasePlan(version);
    assert.deepEqual(plan.assets, [`dist/palboo-${version}-darwin-arm64.dmg`]);
    assert.equal(plan.prerelease, /-(rc|beta)\./.test(version));
  }
  for (const version of [
    'v1.0.0',
    '01.0.0',
    '1.0',
    '1.0.0.0',
    '1.0.0-01',
    '1.0.0\n',
    '1.0.0;echo bad',
  ])
    assert.throws(() => releasePlan(version));
});

test('privacy audit reads binary bytes and rejects paths, secrets, metadata and links without printing values', (t) => {
  const dir = fixture(t),
    file = join(dir, 'program');
  writeFileSync(file, Buffer.from([0, 1, 2]));
  assert.equal(auditArtifact(dir).files, 1);
  for (const secret of [
    '/' + 'Users/' + 'fixture-name/private/source.rs',
    '/' + 'home/' + 'fixture-name/src/main.rs',
    'ghp_' + 'S'.repeat(32),
    '-----BEGIN ' + 'PRIVATE KEY-----',
  ]) {
    writeFileSync(file, Buffer.concat([Buffer.from([0]), Buffer.from(secret)]));
    assert.throws(
      () => auditArtifact(dir),
      (error) => !error.message.includes(secret),
    );
  }
  writeFileSync(file, Buffer.from(homedir() + '/private-file', 'utf16le'));
  assert.throws(() => auditArtifact(dir), /构建者主目录/);
  writeFileSync(file, 'safe');
  writeFileSync(join(dir, '._program'), 'metadata');
  assert.throws(() => auditArtifact(dir), /元数据/);
  rmSync(join(dir, '._program'));
  symlinkSync(file, join(dir, 'link'));
  assert.throws(() => auditArtifact(dir), /符号链接/);
});

test('release flags preserve argument boundaries, existing settings and the original environment', () => {
  const env = {
    CARGO_ENCODED_RUSTFLAGS: '-C\x1ftarget-cpu=generic',
    CARGO_HOME: '/build cache/cargo',
  };
  const built = distributionEnvironment('/project with spaces', env);
  const flags = built.CARGO_ENCODED_RUSTFLAGS.split('\x1f');
  assert.deepEqual(flags.slice(0, 2), ['-C', 'target-cpu=generic']);
  assert.ok(flags.includes('--remap-path-prefix=/project with spaces=/build/palboo'));
  assert.ok(flags.includes('--remap-path-prefix=/build cache/cargo=/build/cargo'));
  assert.equal(env.CARGO_ENCODED_RUSTFLAGS, '-C\x1ftarget-cpu=generic');
});

test(
  'native launcher resolves its moved bundle and preserves pause, cancellation and error outcomes',
  { skip: process.platform !== 'darwin' },
  (t) => {
    const dir = fixture(t);
    let app = join(dir, 'Original.app');
    mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
    writeFileSync(
      join(app, 'Contents/Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>PalbooLauncher</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
    );
    execFileSync('xcrun', [
      'swiftc',
      '-D',
      'LAUNCHER_TEST',
      '-target',
      'arm64-apple-macosx14.0',
      join(root, 'scripts/app-launcher.swift'),
      '-o',
      join(app, 'Contents/MacOS/PalbooLauncher'),
    ]);
    const moved = join(dir, "moved space's app.app");
    renameSync(app, moved);
    app = moved;
    const log = join(dir, 'calls.txt');
    const cli = join(app, 'Contents/MacOS/palboo');
    writeFileSync(
      cli,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$1" in
--version) echo 'palboo 1.0.0';;
app-mode)
  case "$SCENARIO" in
  pause) echo '{"mode":"release","paused":true}';;
  development-pause) echo '{"mode":"development","paused":true,"url":"http://127.0.0.1:9/#token=synthetic"}';;
  development) echo '{"mode":"development"}';;
  cancel) echo '已取消重开' >&2; exit 1;;
  failure) echo 'synthetic launch failure' >&2; exit 2;;
  wrapped-failure) echo 'Error: Error: synthetic launch failure (-600)' >&2; exit 2;;
  esac;;
popout)
  case "$SCENARIO" in
  unsupported) echo '桌面浮窗仅支持 macOS 15 及以上的 Apple Silicon 设备' >&2; exit 1;;
  broken-window) echo 'synthetic popout failure' >&2; exit 3;;
  esac;;
esac
`,
      { mode: 0o755 },
    );
    const run = (scenario, args = []) => {
      rmSync(log, { force: true });
      return spawnSync(join(app, 'Contents/MacOS/PalbooLauncher'), args, {
        env: {
          ...process.env,
          PALBOO_LAUNCHER_HOME: join(dir, 'launcher'),
          CALLS: log,
          SCENARIO: scenario,
        },
        encoding: 'utf8',
      });
    };
    const checked = run('', ['--check']);
    assert.equal(checked.status, 0, checked.stderr || String(checked.signal));
    assert.equal(
      checked.stdout.trim(),
      'palboo 1.0.0',
      JSON.stringify({ checked, calls: existsSync(log) ? readFileSync(log, 'utf8') : 'missing' }),
    );
    assert.equal(readFileSync(log, 'utf8').trim(), '--version');
    for (const scenario of ['', 'cancel', 'unsupported', 'development']) {
      assert.equal(run(scenario).status, 0);
      const commands = readFileSync(log, 'utf8').trim().split('\n');
      assert.equal(commands[0], 'app-mode launch');
      assert.deepEqual(
        commands.slice(1),
        ['cancel', 'development'].includes(scenario) ? [] : ['popout'],
      );
    }
    for (const scenario of ['pause', 'development-pause']) {
      const paused = run(scenario);
      assert.equal(paused.status, 1);
      assert.match(paused.stderr, /ChatGPT/);
      assert.equal(readFileSync(log, 'utf8').trim(), 'app-mode launch');
    }
    for (const scenario of ['failure', 'broken-window']) assert.equal(run(scenario).status, 1);
    const wrappedFailure = run('wrapped-failure');
    assert.equal(wrappedFailure.status, 1);
    assert.equal(wrappedFailure.stderr.trim(), 'synthetic launch failure (-600)');
    rmSync(cli);
    assert.equal(run('', ['--check']).status, 1);
  },
);
