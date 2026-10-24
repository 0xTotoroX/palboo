/*
 * [INPUT]: 发布计划、成品审计、Swift 启动器与真实 Release shell；隔离合成目录。
 * [OUTPUT]: 版本筛选、隐私拒绝、启动器移动/失败语义和发布附件回归。
 * [POS]: 分发单元与合成集成测试，不启动真实后台或访问 GitHub。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

test('only a zero patch produces a DMG, including prerelease candidates', () => {
  for (const version of ['0.9.0', '1.0.0', '1.12.0', '2.0.0', '1.0.0-rc.1', '1.0.0+build.42']) {
    const plan = releasePlan(version);
    assert.deepEqual(plan.assets, [`dist/palboo-${version}-darwin-arm64.dmg`]);
    assert.equal(plan.installer, true);
    assert.equal(plan.prerelease, version.includes('-rc.'));
  }
  for (const version of ['1.0.1', '1.2.10', '2.0.3-beta.1'])
    assert.deepEqual(releasePlan(version).assets, []);
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

function releaseFixture(t, version) {
  const dir = fixture(t);
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, '.github/release-notes'), { recursive: true });
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({ version, packages: { '': { version } } }),
  );
  writeFileSync(join(dir, 'Cargo.toml'), `[package]\nversion = "${version}"\n`);
  writeFileSync(join(dir, 'Cargo.lock'), `[[package]]\nname = "palboo"\nversion = "${version}"\n`);
  writeFileSync(join(dir, `.github/release-notes/v${version}.md`), 'Reviewed notes\n');
  copyFileSync(join(root, 'scripts/release-plan.mjs'), join(dir, 'scripts/release-plan.mjs'));
  return dir;
}

test('patch packaging exits before compilation and does not use a stale installer', (t) => {
  const dir = releaseFixture(t, '1.0.1');
  for (const file of readdirSync(join(root, 'scripts')).filter((name) => name.endsWith('.mjs')))
    copyFileSync(join(root, 'scripts', file), join(dir, 'scripts', file));
  writeFileSync(join(dir, 'dist/old.dmg'), 'preserve');
  const result = spawnSync(process.execPath, ['scripts/package.mjs'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /补丁版本/);
  assert.deepEqual(readdirSync(join(dir, 'dist')), ['old.dmg']);
  assert.equal(existsSync(join(dir, 'target')), false);
});

test('the actual publish shell attaches only the planned DMG, refuses overwrites and marks prereleases', (t) => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
  const shell = workflow
    .split('      - name: Publish reviewed notes and the planned assets\n')[1]
    .split('        run: |\n')[1]
    .split('\n      - name:')[0]
    .split('\n')
    .map((line) => line.replace(/^          /, ''))
    .join('\n');
  for (const version of ['1.0.0', '1.0.1', '1.0.0-rc.1']) {
    const dir = releaseFixture(t, version),
      plan = releasePlan(version);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      '#!/bin/sh\nif [ "$2" = view ]; then [ "$EXISTING" = 1 ]; exit $?; fi\nprintf "%s\\n" "$@" >> "$CALLS"\n',
      { mode: 0o755 },
    );
    for (const asset of plan.assets) writeFileSync(join(dir, asset), 'dmg-fixture');
    const calls = join(dir, 'calls.txt');
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RELEASE_TAG: plan.tag,
      INSTALLER: String(plan.installer),
      PRERELEASE: String(plan.prerelease),
      CALLS: calls,
    };
    const run = (extra = {}) =>
      spawnSync('/bin/bash', ['-c', shell], {
        cwd: dir,
        env: { ...env, ...extra },
        encoding: 'utf8',
      });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const args = readFileSync(calls, 'utf8').split('\n');
    assert.deepEqual(
      args.filter((s) => s.endsWith('.dmg')),
      plan.assets,
    );
    assert.ok(!args.some((s) => /\.(zip|gz)$/.test(s)));
    assert.equal(args.includes('--prerelease'), plan.prerelease);
    assert.ok(args.includes(`--latest=${!plan.prerelease}`));
    rmSync(calls);
    result = run({ EXISTING: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(calls), false);
    if (plan.installer) {
      rmSync(join(dir, plan.assets[0]));
      assert.notEqual(run().status, 0);
      assert.equal(existsSync(calls), false);
    }
    assert.notEqual(
      spawnSync(process.execPath, ['scripts/release-plan.mjs', 'v9.9.0'], { cwd: dir }).status,
      0,
    );
    writeFileSync(join(dir, 'Cargo.lock'), '[[package]]\nname = "palboo"\nversion = "9.9.9"\n');
    assert.notEqual(
      spawnSync(process.execPath, ['scripts/release-plan.mjs', plan.tag], { cwd: dir }).status,
      0,
    );
  }
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
launch)
  case "$SCENARIO" in
  pause) echo 'Codex 集成已暂停';;
  cancel) echo '已取消重开' >&2; exit 1;;
  failure) echo 'synthetic launch failure' >&2; exit 2;;
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
        env: { ...process.env, CALLS: log, SCENARIO: scenario },
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
    for (const scenario of ['', 'pause', 'cancel', 'unsupported']) {
      assert.equal(run(scenario).status, 0);
      const commands = readFileSync(log, 'utf8').trim().split('\n');
      assert.equal(commands[0], 'launch --no-open --restart-running');
      assert.deepEqual(
        commands.slice(1),
        scenario === 'pause' ? ['start'] : scenario === 'cancel' ? [] : ['popout'],
      );
    }
    for (const scenario of ['failure', 'broken-window']) assert.equal(run(scenario).status, 1);
    rmSync(cli);
    assert.equal(run('', ['--check']).status, 1);
  },
);
