/* [INPUT]: Real CLI in a temporary App, synthetic Dev adapter and isolated mode/data directories.
 * [OUTPUT]: Handover acknowledgment, revision, success/failure and data-preservation regression.
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
} from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';

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
