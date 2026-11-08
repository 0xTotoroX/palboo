/* [INPUT]: Real CLI in a temporary App, synthetic Dev adapter and isolated mode/data directories.
 * [OUTPUT]: Handover acknowledgment, active supervisor/controller/orphan-backend protection, conservative unknown-record handling, revision and data-preservation regression.
 * [POS]: No real host, developer source, user preferences or native windows are touched.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';

const binary = resolve('target/debug/palboo');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'palboo-modes-'));
  const control = join(root, 'launcher'),
    data = join(root, 'release-data'),
    source = join(root, 'source');
  for (const path of [control, data, join(source, 'scripts'), join(source, 'target/dev/real')])
    mkdirSync(path, { recursive: true });
  writeFileSync(
    join(data, 'config.json'),
    JSON.stringify({ performance: { integrationEnabled: false } }),
  );
  writeFileSync(join(data, 'keep.txt'), 'release data');
  writeFileSync(join(source, 'target/dev/real/keep.txt'), 'dev data');
  writeFileSync(join(source, 'package.json'), '{"name":"palboo"}');
  writeFileSync(
    join(source, 'scripts/app-mode.mjs'),
    `import fs from 'node:fs';const file=process.argv[2], input=JSON.parse(fs.readFileSync(file)); fs.appendFileSync(process.env.MODE_CALLS,input.action+'\\n');
  if(process.env.PALBOO_START_DISCONNECTED)throw Error('release startup flag leaked into Dev');
  const failed=process.env.MODE_FAIL===input.action;
  fs.writeFileSync(file+'.result',JSON.stringify(failed?{error:'synthetic '+input.action+' failure'}:{ready:true,url:'http://127.0.0.1:1/#synthetic-new-settings'}));process.exitCode=failed?1:0;`,
  );
  const executable = join(root, 'Palboo.app/Contents/MacOS/palboo');
  mkdirSync(join(root, 'Palboo.app/Contents/MacOS'), { recursive: true });
  copyFileSync(binary, executable);
  const env = {
    ...process.env,
    PALBOO_LAUNCHER_HOME: control,
    PALBOO_HOME: join(source, 'target/dev/real'),
    PALBOO_START_DISCONNECTED: '1',
    MODE_CALLS: join(root, 'calls'),
  };
  const prefs = {
    mode: 'release',
    revision: 4,
    source,
    node: process.execPath,
    executable,
    releaseData: data,
  };
  const prefsFile = join(control, 'app-mode.json');
  writeFileSync(prefsFile, JSON.stringify(prefs));
  const children = [];
  t.after(async () => {
    for (const child of children) child.kill('SIGTERM');
    const runtime = join(data, 'runtime.json');
    if (existsSync(runtime)) {
      try {
        execFileSync(executable, ['--data-dir', data, 'stop'], { env, stdio: 'ignore' });
      } catch {}
    }
    await delay(100);
    rmSync(root, { recursive: true, force: true });
  });
  return { root, control, data, source, executable, env, prefs, prefsFile, children };
}
function register(f, source, active = false) {
  return execFileSync(
    f.executable,
    [
      '--data-dir',
      f.data,
      'app-mode',
      'register',
      '--source',
      source,
      '--node',
      process.execPath,
      ...(active ? ['--active'] : []),
    ],
    { env: f.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 },
  );
}
function anotherSource(f, name) {
  const source = join(f.root, name);
  mkdirSync(join(source, 'scripts'), { recursive: true });
  writeFileSync(join(source, 'package.json'), '{"name":"palboo"}');
  copyFileSync(join(f.source, 'scripts/app-mode.mjs'), join(source, 'scripts/app-mode.mjs'));
  return source;
}
async function supervisor(f, source) {
  writeFileSync(
    join(source, 'scripts/dev.mjs'),
    "process.stdout.write('ready\\n'); setInterval(() => {}, 1000);\n",
  );
  const child = spawn(process.execPath, [join(source, 'scripts/dev.mjs')], {
    env: f.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  f.children.push(child);
  await once(child.stdout, 'data');
  return child;
}

test('registration keeps an active source and allows same-source updates including --active', async (t) => {
  const f = fixture(t),
    replacement = anotherSource(f, 'replacement'),
    child = await supervisor(f, f.source);
  writeFileSync(f.prefsFile, JSON.stringify({ ...f.prefs, mode: 'development' }));
  writeFileSync(
    join(f.source, 'target/dev/owner.json'),
    JSON.stringify({ pid: child.pid, root: f.source, nonce: 'synthetic' }),
  );
  const original = readFileSync(f.prefsFile, 'utf8');
  for (const active of [false, true]) {
    assert.throws(
      () => register(f, replacement, active),
      (error) => error.status !== 0 && /原开发会话仍在运行/.test(error.stderr),
    );
    assert.equal(readFileSync(f.prefsFile, 'utf8'), original);
    process.kill(child.pid, 0);
  }
  assert.throws(
    () =>
      execFileSync(f.executable, ['app-mode', 'recover'], {
        env: f.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (error) => /开发进程仍在运行/.test(error.stderr),
  );
  assert.equal(readFileSync(f.prefsFile, 'utf8'), original);
  const alias = join(f.root, 'source-alias');
  symlinkSync(f.source, alias, 'dir');
  register(f, alias);
  register(f, f.source, true);
  const saved = JSON.parse(readFileSync(f.prefsFile));
  assert.equal(saved.source, realpathSync(f.source));
  assert.equal(saved.mode, 'development');
  assert.equal(saved.revision, 6);
  assert.equal(readFileSync(f.env.MODE_CALLS, 'utf8'), 'status\n');
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  register(f, replacement);
  assert.equal(JSON.parse(readFileSync(f.prefsFile)).source, realpathSync(replacement));
});

test('a worktree registration cannot hide its active controller, even with a stale owner PID', async (t) => {
  const f = fixture(t),
    controller = anotherSource(f, 'controller'),
    replacement = anotherSource(f, 'replacement'),
    child = await supervisor(f, controller);
  const original = readFileSync(f.prefsFile, 'utf8');
  for (const pid of [child.pid, 2147483647]) {
    writeFileSync(
      join(f.source, 'target/dev/owner.json'),
      JSON.stringify({ pid, root: f.source, controller, nonce: 'synthetic' }),
    );
    assert.throws(
      () => register(f, replacement),
      (error) => /原开发会话仍在运行/.test(error.stderr),
    );
    assert.equal(readFileSync(f.prefsFile, 'utf8'), original);
  }
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  register(f, replacement);
  assert.equal(JSON.parse(readFileSync(f.prefsFile)).source, realpathSync(replacement));
});

test('unreadable or invalid old ownership records do not permit registration to overwrite identity', (t) => {
  const f = fixture(t),
    replacement = anotherSource(f, 'replacement'),
    original = readFileSync(f.prefsFile, 'utf8');
  for (const owner of ['{broken', '{}', '{"pid":1,"controller":"relative/path"}']) {
    writeFileSync(join(f.source, 'target/dev/owner.json'), owner);
    assert.throws(
      () => register(f, replacement),
      (error) => /开发.*记录.*未更改运行模式/.test(error.stderr),
    );
    assert.equal(readFileSync(f.prefsFile, 'utf8'), original);
  }
});

function recover(f) {
  return execFileSync(f.executable, ['--data-dir', f.data, 'app-mode', 'recover'], {
    env: f.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  });
}
function blockedModeChanges(f, replacement, message) {
  const original = readFileSync(f.prefsFile, 'utf8');
  for (const action of [
    () => register(f, replacement),
    () => register(f, replacement, true),
    () => recover(f),
  ]) {
    assert.throws(action, (error) => error.status !== 0 && message.test(String(error.stderr)));
    assert.equal(readFileSync(f.prefsFile, 'utf8'), original);
    assert.equal(existsSync(join(f.data, 'runtime.json')), false, 'release must not start');
    assert.equal(existsSync(f.env.MODE_CALLS), false, 'Dev adapters must not run');
  }
}
function orphanLocation(f, location) {
  const stalePid = 2147483647;
  writeFileSync(f.prefsFile, JSON.stringify({ ...f.prefs, mode: 'development' }));
  writeFileSync(
    join(f.source, 'target/dev/owner.json'),
    JSON.stringify({ pid: stalePid, root: f.source }),
  );
  if (location === 'current') return join(f.source, 'target/dev/real');
  if (location === 'session') {
    const data = join(f.root, 'selected-runtime');
    mkdirSync(data);
    writeFileSync(join(f.source, 'target/dev/session.json'), JSON.stringify({ runtime: data }));
    return data;
  }
  const selected = join(f.root, 'handoff worktree'),
    unrelated = join(f.root, 'unrelated');
  for (const root of [selected, unrelated])
    mkdirSync(join(root, 'target/dev/real'), { recursive: true });
  writeFileSync(
    join(selected, 'target/dev/owner.json'),
    JSON.stringify({ pid: stalePid, controller: f.source }),
  );
  writeFileSync(
    join(unrelated, 'target/dev/owner.json'),
    JSON.stringify({ pid: process.pid, root: unrelated }),
  );
  writeFileSync(
    join(unrelated, 'target/dev/real/runtime.json'),
    '{unrelated runtime must not be read',
  );
  // 只提供 Git 的 NUL 分隔只读清单；不初始化仓库、提交或修改任何真实 Git 状态。
  mkdirSync(join(f.source, '.git'));
  const bin = join(f.root, 'fixture-bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'git'),
    `#!/usr/bin/env node
const args=process.argv.slice(2);
if(args[0]!=='-C'||args.slice(2).join(' ')!=='worktree list --porcelain -z')process.exit(2);
if(process.env.MODE_WORKTREE_FAIL)process.exit(1);
process.stdout.write(JSON.parse(process.env.MODE_WORKTREES).map(path=>'worktree '+path+'\\0HEAD '+'0'.repeat(40)+'\\0\\0').join(''));
`,
    { mode: 0o700 },
  );
  f.env.PATH = bin + ':' + process.env.PATH;
  f.env.MODE_WORKTREES = JSON.stringify([f.source, selected, unrelated]);
  return join(selected, 'target/dev/real');
}
async function isolatedBackend(f, data) {
  writeFileSync(
    join(data, 'config.json'),
    JSON.stringify({ performance: { integrationEnabled: false } }),
  );
  const child = spawn(f.executable, ['--data-dir', data, 'serve', '--port', '0'], {
    env: f.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  f.children.push(child);
  let stderr = '',
    spawnError;
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('error', (error) => (spawnError = error));
  const runtimePath = join(data, 'runtime.json');
  for (let i = 0; i < 200; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw Error(stderr || 'isolated backend exited');
    if (existsSync(runtimePath)) {
      const runtime = JSON.parse(readFileSync(runtimePath));
      assert.equal(runtime.pid, child.pid);
      return child;
    }
    await delay(25);
  }
  throw Error(stderr || 'isolated backend did not become ready');
}

for (const location of ['current', 'session', 'worktree']) {
  test(`orphan Rust backend in ${location} blocks registration and recovery until it exits`, async (t) => {
    const f = fixture(t),
      replacement = anotherSource(f, 'replacement');
    const data = orphanLocation(f, location),
      child = await isolatedBackend(f, data);
    blockedModeChanges(f, replacement, /开发.*仍在运行/);
    process.kill(child.pid, 0);
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    recover(f);
    assert.equal(JSON.parse(readFileSync(f.prefsFile)).mode, 'release');
    register(f, replacement);
    assert.equal(JSON.parse(readFileSync(f.prefsFile)).source, realpathSync(replacement));
  });

  test(`invalid or unidentified ${location} runtime identities cannot authorize a mode change`, (t) => {
    const f = fixture(t),
      replacement = anotherSource(f, 'replacement');
    const data = orphanLocation(f, location),
      path = join(data, 'runtime.json');
    for (const record of [
      '{broken',
      '{}',
      'null',
      '{"pid":0}',
      '{"pid":"42"}',
      '{"pid":2147483648}',
    ]) {
      writeFileSync(path, record);
      blockedModeChanges(f, replacement, /开发.*记录.*未更改运行模式/);
    }
    // PID 存活但命令并非已知 Rust 后台时，也不能把身份不明等同于退出。
    writeFileSync(path, JSON.stringify({ pid: process.pid }));
    blockedModeChanges(f, replacement, /开发.*仍在运行/);
    rmSync(path);
    mkdirSync(path);
    blockedModeChanges(f, replacement, /开发.*记录.*未更改运行模式/);
  });
}

test('unknown session paths and unavailable related worktree listings remain protected', (t) => {
  const f = fixture(t),
    replacement = anotherSource(f, 'replacement');
  orphanLocation(f, 'session');
  const path = join(f.source, 'target/dev/session.json');
  for (const record of ['{broken', '{}', '{"runtime":null}', '{"runtime":"relative"}']) {
    writeFileSync(path, record);
    blockedModeChanges(f, replacement, /开发.*记录.*未更改运行模式/);
  }
  rmSync(path);
  orphanLocation(f, 'worktree');
  f.env.MODE_WORKTREE_FAIL = '1';
  blockedModeChanges(f, replacement, /无法核对开发 worktree/);
});

async function worker(f, overrides = {}) {
  const file = join(f.control, `request-${Date.now()}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      update: {
        mode: 'development',
        source: f.source,
        node: process.execPath,
        expectedRevision: 4,
        ...overrides,
      },
      previous: 'release',
      connection: null,
      returnUrl: 'http://127.0.0.1:2/#old-settings',
    }),
  );
  const child = spawn(f.executable, ['app-mode', 'worker', '--request', file], {
    env: f.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  f.children.push(child);
  let error = '';
  child.stderr.on('data', (chunk) => (error += chunk));
  for (let i = 0; i < 200; i++) {
    if (existsSync(file + '.ready')) break;
    if (child.exitCode !== null) throw Error(error);
    await delay(25);
  }
  assert.ok(existsSync(file + '.ready'), error || 'worker not ready');
  const ready = JSON.parse(readFileSync(file + '.ready'));
  return { url: ready.url, error: ready.error, child };
}
async function complete(url) {
  for (let i = 0; i < 250; i++) {
    const state = await (await fetch(url + '/state')).json();
    if (['done', 'failed'].includes(state.phase)) return state;
    await delay(30);
  }
  throw Error('handover did not complete');
}

test('switch waits for its page, commits one revision and keeps both data directories', async (t) => {
  const f = fixture(t),
    w = await worker(f);
  await delay(150);
  assert.equal(existsSync(f.env.MODE_CALLS), false);
  assert.equal(JSON.parse(readFileSync(f.prefsFile)).mode, 'release');
  const page = await (await fetch(w.url)).text();
  assert.match(page, /method:'POST'/);
  assert.equal((await fetch(w.url + '/state/start')).status, 405);
  assert.equal((await fetch(w.url.replace(/[^/]+$/, 'wrong') + '/state')).status, 404);
  await fetch(w.url + '/state/start', { method: 'POST' });
  const result = await complete(w.url);
  assert.equal(result.phase, 'done');
  const saved = JSON.parse(readFileSync(f.prefsFile));
  assert.equal(saved.mode, 'development');
  assert.equal(saved.revision, 5);
  assert.equal(saved.releaseData, f.data);
  assert.equal(readFileSync(join(f.data, 'keep.txt'), 'utf8'), 'release data');
  assert.equal(readFileSync(join(f.source, 'target/dev/real/keep.txt'), 'utf8'), 'dev data');
  assert.deepEqual(readFileSync(f.env.MODE_CALLS, 'utf8').trim().split('\n'), ['prepare', 'open']);
});
test('failed compilation and stale tabs cannot start or overwrite the selected mode', async (t) => {
  const f = fixture(t);
  f.env.MODE_FAIL = 'prepare';
  const original = readFileSync(f.prefsFile, 'utf8');
  const w = await worker(f);
  await fetch(w.url + '/state/start', { method: 'POST' });
  assert.match((await complete(w.url)).message, /synthetic prepare failure/);
  assert.equal(readFileSync(f.prefsFile, 'utf8'), original);
  const stale = await worker(f, { expectedRevision: 3 });
  await fetch(stale.url + '/state/start', { method: 'POST' });
  assert.match((await complete(stale.url)).message, /其他操作/);
  assert.equal(readFileSync(f.prefsFile, 'utf8'), original);
  assert.equal(readFileSync(f.env.MODE_CALLS, 'utf8'), 'prepare\n');
});
test('failed Dev startup restores release using release data despite an inherited Dev home', async (t) => {
  const f = fixture(t);
  f.env.MODE_FAIL = 'open';
  const original = readFileSync(f.prefsFile, 'utf8'),
    w = await worker(f);
  await fetch(w.url + '/state/start', { method: 'POST' });
  const result = await complete(w.url);
  assert.equal(result.phase, 'failed');
  assert.match(result.message, /已恢复原模式/);
  assert.equal(readFileSync(f.prefsFile, 'utf8'), original);
  assert.ok(existsSync(join(f.data, 'runtime.json')));
  assert.equal(existsSync(join(f.source, 'target/dev/real/runtime.json')), false);
  assert.match(result.url, /#token=/);
});

test('an active release can correct a leftover development preference without losing data', async (t) => {
  const f = fixture(t);
  writeFileSync(f.prefsFile, JSON.stringify({ ...f.prefs, mode: 'development' }));
  const w = await worker(f, { mode: 'release' });
  await fetch(w.url + '/state/start', { method: 'POST' });
  assert.equal((await complete(w.url)).phase, 'done');
  const saved = JSON.parse(readFileSync(f.prefsFile));
  assert.equal(saved.mode, 'release');
  assert.equal(saved.revision, 5);
  assert.equal(readFileSync(join(f.data, 'keep.txt'), 'utf8'), 'release data');
  assert.equal(readFileSync(join(f.source, 'target/dev/real/keep.txt'), 'utf8'), 'dev data');
  assert.equal(existsSync(f.env.MODE_CALLS), false);
});

test('cold recovery keeps the preference until the newly started backend connects', async (t) => {
  const f = fixture(t);
  writeFileSync(f.prefsFile, JSON.stringify({ ...f.prefs, mode: 'development' }));
  writeFileSync(
    join(f.data, 'config.json'),
    JSON.stringify({ performance: { integrationEnabled: true } }),
  );
  // The launch command confirms HTTP availability; the synthetic host completes later.
  writeFileSync(f.executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  let connected = false,
    observed;
  const firstRead = new Promise((resolve) => {
    observed = resolve;
  });
  const server = createServer((_req, res) => {
    res
      .setHeader('Content-Type', 'application/json')
      .end(JSON.stringify({ connection: { status: connected ? 'connected' : 'connecting' } }));
    observed();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  writeFileSync(
    join(f.data, 'runtime.json'),
    JSON.stringify({
      pid: process.pid,
      port: server.address().port,
      token: 'fixture',
      version: 'fixture',
      executable: f.executable,
    }),
  );
  const child = spawn(binary, ['--data-dir', f.data, 'app-mode', 'recover'], {
    env: f.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  f.children.push(child);
  let error = '';
  child.stderr.on('data', (chunk) => {
    error += chunk;
  });
  const done = new Promise((resolve) => child.on('exit', resolve));
  await firstRead;
  await delay(80);
  assert.equal(child.exitCode, null);
  assert.equal(JSON.parse(readFileSync(f.prefsFile)).mode, 'development');
  connected = true;
  assert.equal(await done, 0, error);
  assert.equal(JSON.parse(readFileSync(f.prefsFile)).mode, 'release');
  assert.equal(readFileSync(join(f.source, 'target/dev/real/keep.txt'), 'utf8'), 'dev data');
});
