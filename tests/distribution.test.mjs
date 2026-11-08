/*
 * [INPUT]: 发布脚本、成品审计、Swift 启动器与隔离的 GitHub CLI 替身。
 * [OUTPUT]: 新标签缺失/已有标签解析、自动发布、重跑跳过、修订/摘要错误拒绝与启动器回归。
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

function publishFixture(t, version = '1.0.1') {
  const dir = releaseFixture(t, version);
  const sha = 'a'.repeat(40);
  copyFileSync(join(root, 'scripts/release.mjs'), join(dir, 'scripts/release.mjs'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'target/reports'), { recursive: true });
  const plan = releasePlan(version);
  const bytes = Buffer.from('checked-dmg-fixture');
  const metadata = {
    version,
    commit: sha,
    artifact: plan.assets[0],
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  writeFileSync(join(dir, plan.assets[0]), bytes);
  writeFileSync(join(dir, 'target/reports/package.json'), JSON.stringify(metadata));
  writeFileSync(join(dir, 'bin/git'), '#!/bin/sh\nprintf "%s" "$CHECKOUT_SHA"\n', { mode: 0o755 });
  writeFileSync(
    join(dir, 'bin/gh'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2), env = process.env;
if (args[0] === 'api') {
  if (env.API_ERROR) { console.error('gh: API unavailable (HTTP 503)'); process.exit(1); }
  const path = args[1];
  if (path.includes('/releases/tags/') && env.EXISTING) {
    console.log(JSON.stringify({draft: env.EXISTING === 'draft'}));
  } else if (path.endsWith('/commits/main')) {
    console.log(JSON.stringify({sha: env.MAIN_SHA}));
  } else if (path.includes('/git/ref/tags/') && env.TAG_SHA) {
    console.log(JSON.stringify({object:{sha: env.TAG_OBJECT_SHA || env.TAG_SHA, type: env.TAG_OBJECT_SHA ? 'tag' : 'commit'}}));
  } else if (path.includes('/commits/')) {
    if (env.TAG_SHA && !env.TAG_COMMIT_MISSING) console.log(JSON.stringify({sha: env.TAG_SHA}));
    else { console.error('gh: No commit found for SHA: ' + path.split('/').at(-1) + ' (HTTP 422)'); process.exit(1); }
  } else { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
} else {
  fs.writeFileSync(env.CALLS, JSON.stringify(args));
  if (env.UPLOAD_ERROR) process.exit(1);
}
`,
    { mode: 0o755 },
  );
  const calls = join(dir, 'calls.json');
  const env = {
    ...process.env,
    PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    GITHUB_ACTIONS: 'true',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REPOSITORY: '0xTotoroX/palboo',
    GITHUB_SHA: sha,
    GITHUB_STEP_SUMMARY: '',
    CHECKOUT_SHA: sha,
    MAIN_SHA: sha,
    CALLS: calls,
  };
  return {
    dir,
    plan,
    metadata,
    calls,
    sha,
    run: (extra = {}) =>
      spawnSync(process.execPath, ['scripts/release.mjs'], {
        cwd: dir,
        env: { ...env, ...extra },
        encoding: 'utf8',
      }),
  };
}

test('main publishes the checked DMG and exact commit without a manual draft stage', (t) => {
  for (const version of ['1.0.0', '1.0.1', '1.0.1-rc.1']) {
    const f = publishFixture(t, version);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(f.calls));
    assert.deepEqual(args.slice(0, 4), ['release', 'create', f.plan.tag, f.plan.assets[0]]);
    assert.equal(args[args.indexOf('--target') + 1], f.sha);
    assert.equal(args.includes('--prerelease'), f.plan.prerelease);
    assert.equal(args.includes('--draft'), false);
    assert.equal(args.includes('--clobber'), false);
  }
});

test('published versions and superseded main builds skip; API failure is not a new version', (t) => {
  const f = publishFixture(t);
  for (const extra of [{ EXISTING: 'published' }, { MAIN_SHA: 'b'.repeat(40) }]) {
    const result = f.run(extra);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(f.calls), false);
  }
  for (const extra of [
    { API_ERROR: '1' },
    { EXISTING: 'draft' },
    { TAG_SHA: 'b'.repeat(40) },
    { TAG_SHA: f.sha, TAG_COMMIT_MISSING: '1' },
    { CHECKOUT_SHA: 'b'.repeat(40) },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_REPOSITORY: 'someone/fork' },
  ]) {
    assert.notEqual(f.run(extra).status, 0, JSON.stringify(extra));
    assert.equal(existsSync(f.calls), false);
  }
  assert.notEqual(f.run({ UPLOAD_ERROR: '1' }).status, 0);
});

test('existing lightweight and annotated tags resolve to the verified commit before publication', (t) => {
  for (const extra of [{}, { TAG_OBJECT_SHA: 'b'.repeat(40) }]) {
    const f = publishFixture(t);
    const result = f.run({ TAG_SHA: f.sha, ...extra });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(f.calls), true);
  }
});

test('publication rejects mismatched versions, missing notes and altered or missing App bytes', (t) => {
  for (const edit of [
    (f) =>
      writeFileSync(join(f.dir, 'Cargo.lock'), '[[package]]\nname = "palboo"\nversion = "9.9.9"\n'),
    (f) => rmSync(join(f.dir, `.github/release-notes/${f.plan.tag}.md`)),
    (f) => writeFileSync(join(f.dir, f.plan.assets[0]), 'altered'),
    (f) => rmSync(join(f.dir, f.plan.assets[0])),
    (f) =>
      writeFileSync(
        join(f.dir, 'target/reports/package.json'),
        JSON.stringify({ ...f.metadata, commit: 'b'.repeat(40) }),
      ),
    (f) =>
      writeFileSync(
        join(f.dir, 'target/reports/package.json'),
        JSON.stringify({ ...f.metadata, version: '9.9.9' }),
      ),
  ]) {
    const f = publishFixture(t);
    edit(f);
    assert.notEqual(f.run().status, 0);
    assert.equal(existsSync(f.calls), false);
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
