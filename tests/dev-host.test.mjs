/*
 * [INPUT]: 临时配置、含网页构建依赖的开发入口、合成本机 CDP/API 与开发常量构建。
 * [OUTPUT]: 开发端点/窗口绑定、显式选择优先、真实目标选择、配置/存储隔离与恢复契约；日志走结构化诊断以兼容最低 Node 测试运行器。
 * [POS]: 开发宿主边界回归；不连接用户应用或读取真实聊天。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { format, promisify } from 'node:util';
import { copyFileSync, symlinkSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import {
  endpointUrl,
  hostSettingsDirectory,
  realTarget,
  findHost,
  findDevelopmentHost,
  initializeData,
  restoreInstallation,
  pauseInstallation,
  requestRuntime,
} from '../scripts/dev-host.mjs';

// Node 22.16 can misread raw UTF-8 stdout interleaved with its binary test reports.
// Preserve the messages as structured diagnostics (nodejs/node#64706).
test.beforeEach((t) => {
  t.mock.method(console, 'log', (...args) => t.diagnostic(format(...args)));
});

const temporary = (t) => {
  const path = mkdtempSync(join(tmpdir(), 'buddy-real-dev-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};
async function server(t, handler) {
  const instance = createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        instance.closeAllConnections();
        instance.close(resolve);
      }),
  );
  return { port: instance.address().port, origin: `http://127.0.0.1:${instance.address().port}` };
}
test('real development accepts only local CDP and actual app pages', () => {
  assert.equal(endpointUrl('9229'), 'http://127.0.0.1:9229');
  for (const endpoint of [
    'https://127.0.0.1:9229',
    'http://example.com:9229',
    'http://127.0.0.1:9229/fixture',
    'http://u:p@localhost:9229',
  ])
    assert.throws(() => endpointUrl(endpoint));
  assert.equal(
    realTarget({ type: 'page', url: 'app://-/index.html?initialRoute=/threads/example' }),
    true,
  );
  for (const url of [
    'http://127.0.0.1:1234/fixture',
    'app://-/index.html?initialRoute=/settings',
    'app://-/index.html?initialRoute=/overlay',
  ])
    assert.equal(realTarget({ type: 'page', url }), false);
});

test('Dev startup reads its own force/ask setting and inherits installation only before first configuration', (t) => {
  const source = temporary(t),
    data = join(source, 'dev');
  mkdirSync(data);
  writeFileSync(join(source, 'config.json'), JSON.stringify({ hostRestartPolicy: 'ask' }));
  assert.equal(hostSettingsDirectory(source, data), source);
  writeFileSync(join(data, 'config.json'), JSON.stringify({ hostRestartPolicy: 'force' }));
  assert.equal(
    JSON.parse(readFileSync(join(hostSettingsDirectory(source, data), 'config.json')))
      .hostRestartPolicy,
    'force',
  );
  writeFileSync(join(source, 'config.json'), JSON.stringify({ hostRestartPolicy: 'force' }));
  writeFileSync(join(data, 'config.json'), JSON.stringify({ hostRestartPolicy: 'ask' }));
  assert.equal(
    JSON.parse(readFileSync(join(hostSettingsDirectory(source, data), 'config.json')))
      .hostRestartPolicy,
    'ask',
  );
});

function developmentDiscovery(t) {
  const source = temporary(t),
    data = join(source, 'dev');
  mkdirSync(data);
  const installed = 'http://127.0.0.1:41234',
    endpoint = 'http://127.0.0.1:51952',
    runtime = { port: 41235, token: 'synthetic-installation' },
    state = { connection: { endpoint: installed, targetId: 'installed-window' } },
    calls = [],
    pages = new Map();
  writeFileSync(join(source, 'config.json'), JSON.stringify({ cdpEndpoint: installed }));
  writeFileSync(join(source, 'runtime.json'), JSON.stringify(runtime));
  // A Dev runtime is deliberately unusable: restoration must retain the installation's runtime.
  writeFileSync(join(data, 'runtime.json'), JSON.stringify({ port: 1, token: 'unused-dev' }));
  const save = (extra = {}) =>
    writeFileSync(
      join(data, 'config.json'),
      JSON.stringify({ cdpEndpoint: endpoint, targetId: 'dev-window', ...extra }),
    );
  const page = (id) => ({ id, type: 'page', url: 'app://-/index.html' });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(String(url));
    if (String(url) === `http://127.0.0.1:${runtime.port}/api/state`) {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-installation');
      return Response.json(state);
    }
    const targets = pages.get(String(url));
    if (targets) return Response.json(targets.map(page));
    throw new Error('synthetic endpoint unavailable');
  });
  save();
  return { source, data, installed, endpoint, runtime, state, calls, pages, save };
}

test('Dev discovers its saved dynamic port while preserving the installation recovery identity', async (t) => {
  const f = developmentDiscovery(t);
  f.pages.set(f.endpoint + '/json/list', ['another-window', 'dev-window']);
  for (const paused of [false, true]) {
    f.save({ performance: { integrationEnabled: !paused }, codexHost: { enabled: paused } });
    const found = await findDevelopmentHost(
      f.source,
      paused ? { 'restart-running': true } : {},
      () => assert.fail('the saved available endpoint must not need host preparation'),
      f.data,
    );
    assert.equal(found.endpoint, f.endpoint);
    assert.equal(found.target.id, 'dev-window');
    assert.deepEqual(found.installation, f.runtime);
    assert.deepEqual(found.installedState, f.state);
  }
  assert.equal(f.calls.includes(f.installed + '/json/list'), false);
});

test('a stale saved Dev endpoint cannot silently select another endpoint or replay its window ID', async (t) => {
  const f = developmentDiscovery(t);
  f.pages.set(f.installed + '/json/list', ['dev-window', 'installed-window']);
  await assert.rejects(
    findDevelopmentHost(f.source, {}, () => assert.fail('ordinary Dev cannot prepare'), f.data),
    { code: 'NO_DEBUG_HOST' },
  );
  f.save({ performance: { integrationEnabled: false } });
  await assert.rejects(
    findDevelopmentHost(
      f.source,
      { 'restart-running': true },
      () => assert.fail('paused Dev cannot prepare'),
      f.data,
    ),
    { code: 'NO_DEBUG_HOST' },
  );
  assert.equal(f.calls.includes(f.installed + '/json/list'), false);
  const explicit = await findDevelopmentHost(
    f.source,
    { cdp: f.installed },
    () => assert.fail('explicit endpoint cannot prepare'),
    f.data,
  );
  assert.equal(explicit.target.id, 'installed-window');
});

test('explicit target and endpoint override saved Dev choices and never fall back to another window', async (t) => {
  const f = developmentDiscovery(t);
  f.pages.set(f.endpoint + '/json/list', ['dev-window']);
  f.pages.set(f.installed + '/json/list', ['explicit-window', 'installed-window']);
  const prepare = () => assert.fail('explicit choices cannot prepare a host');
  for (const options of [
    { target: 'explicit-window' },
    { target: 'explicit-window', cdp: f.installed, 'restart-running': true },
  ]) {
    const found = await findDevelopmentHost(f.source, options, prepare, f.data);
    assert.equal(found.target.id, 'explicit-window');
    assert.equal(found.endpoint, f.installed);
    assert.equal(found.pinnedTarget, true);
  }
  await assert.rejects(
    findDevelopmentHost(f.source, { cdp: f.endpoint, target: 'explicit-window' }, prepare, f.data),
    /指定的真实 Codex 窗口不存在/,
  );
});

test('explicit CDP overrides malformed unrelated saved addresses without losing recovery identity', async (t) => {
  const f = developmentDiscovery(t);
  const selected = 'http://127.0.0.1:51954';
  f.pages.set(selected + '/json/list', ['chosen-window']);
  const prepare = () => assert.fail('an explicit endpoint must not prepare a host');
  for (const bad of ['config', 'development', 'runtime']) {
    writeFileSync(
      join(f.source, 'config.json'),
      JSON.stringify({
        cdpEndpoint: bad === 'config' ? 'http://127.0.0.1:9229/obsolete' : f.installed,
      }),
    );
    f.save({ cdpEndpoint: bad === 'development' ? 'not-an-endpoint' : f.endpoint });
    f.state.connection.endpoint = bad === 'runtime' ? 'https://localhost:9229' : f.installed;
    for (const options of [
      { cdp: selected },
      { cdp: selected, target: 'chosen-window', 'restart-running': true },
    ]) {
      f.calls.length = 0;
      const found = await findDevelopmentHost(f.source, options, prepare, f.data);
      assert.equal(found.endpoint, selected);
      assert.equal(found.target.id, 'chosen-window');
      assert.deepEqual(found.installation, f.runtime);
      assert.deepEqual(found.installedState, f.state);
      assert.deepEqual(
        f.calls.filter((url) => url.endsWith('/json/list')),
        [selected + '/json/list'],
      );
    }
    await assert.rejects(findDevelopmentHost(f.source, {}, prepare, f.data));
    await assert.rejects(
      findDevelopmentHost(f.source, { cdp: 'http://example.invalid:9229' }, prepare, f.data),
      /本机 CDP/,
    );
  }
  // 有效的同端点配置仍选择原窗口，而非退化到聚焦窗口或歧义错误。
  f.state.connection.endpoint = f.installed;
  f.save();
  f.pages.set(f.endpoint + '/json/list', ['another-window', 'dev-window']);
  const same = await findDevelopmentHost(f.source, { cdp: f.endpoint }, prepare, f.data);
  assert.equal(same.target.id, 'dev-window');
});

test('authorized host preparation can replace an unavailable saved Dev port without reusing its target', async (t) => {
  const f = developmentDiscovery(t);
  const preparedEndpoint = 'http://127.0.0.1:51953';
  f.pages.set(preparedEndpoint + '/json/list', ['replacement-window']);
  let preparations = 0;
  const found = await findDevelopmentHost(
    f.source,
    { 'restart-running': true },
    () => {
      preparations++;
      return preparedEndpoint;
    },
    f.data,
  );
  assert.equal(preparations, 1);
  assert.equal(found.endpoint, preparedEndpoint);
  assert.equal(found.target.id, 'replacement-window');
  assert.deepEqual(found.installation, f.runtime);
});

test('API failures retain the backend reason instead of only an HTTP status', async (t) => {
  const api = await server(t, (_, res) =>
    res.writeHead(400).end(JSON.stringify({ message: '所选 Codex 窗口已关闭' })),
  );
  await assert.rejects(
    requestRuntime({ port: api.port, token: 'synthetic' }, 'connect', {}),
    /connect 请求失败 \(400\)：所选 Codex 窗口已关闭/,
  );
});

test('a verified replacement can retire a missing old target without connecting installation elsewhere', async (t) => {
  const root = temporary(t),
    journal = join(root, 'paused.json'),
    requests = [];
  const old = await server(t, (_, res) => res.end('[]'));
  const api = await server(t, (req, res) => {
    requests.push(req.url);
    res.end(JSON.stringify({ connection: { status: 'disconnected' } }));
  });
  const saved = JSON.stringify({
    runtime: { port: api.port, token: 'synthetic' },
    endpoint: old.origin,
    targetId: 'old-window',
    detached: true,
  });
  writeFileSync(journal, saved, { mode: 0o600 });
  await restoreInstallation(journal, { endpoint: old.origin, target: { id: 'new-window' } });
  assert.deepEqual(requests, ['/api/state']);
  assert.equal(existsSync(journal), false);
  const archived = readdirSync(root).find((name) => name.startsWith('paused.json.stale-'));
  assert.equal(readFileSync(join(root, archived), 'utf8'), saved);
  assert.equal(statSync(join(root, archived)).mode & 0o777, 0o600);
});

test('a still available original target is restored even when a different host was found', async (t) => {
  const root = temporary(t),
    journal = join(root, 'paused.json'),
    requests = [];
  const old = await server(t, (_, res) =>
    res.end(JSON.stringify([{ id: 'old', type: 'page', url: 'app://-/index.html' }])),
  );
  const api = await server(t, (req, res) => {
    requests.push(req.url);
    res.end(JSON.stringify({ connection: { status: 'disconnected' } }));
  });
  writeFileSync(
    journal,
    JSON.stringify({
      runtime: { port: api.port, token: 'synthetic' },
      endpoint: old.origin,
      targetId: 'old',
    }),
  );
  await restoreInstallation(journal, { endpoint: old.origin, target: { id: 'new' } });
  assert.deepEqual(requests, ['/api/state', '/api/connect']);
  assert.equal(existsSync(journal), false);
});

test('no-host startup reports one useful error and leaves the old restoration journal untouched', async (t) => {
  const root = temporary(t),
    scripts = join(root, 'scripts'),
    data = join(root, 'target/dev/real');
  mkdirSync(scripts);
  mkdirSync(data, { recursive: true });
  for (const file of [
    'dev.mjs',
    'brand.mjs',
    'dev-sources.mjs',
    'dev-host.mjs',
    'dev-panel.mjs',
    'dev-web.mjs',
    'dev-runtime.mjs',
    'build-panel.mjs',
  ])
    copyFileSync(resolve(import.meta.dirname, '../scripts', file), join(scripts, file));
  mkdirSync(join(root, 'ui/settings'), { recursive: true });
  copyFileSync(
    resolve(import.meta.dirname, '../ui/settings/dev-sources.js'),
    join(root, 'ui/settings/dev-sources.js'),
  );
  symlinkSync(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'), 'dir');
  const requests = [];
  const api = await server(t, (req, res) => {
    requests.push(req.url);
    res.end('{}');
  });
  const host = await server(t, (_, res) => res.end('[]'));
  const journal = join(root, 'target/dev/paused-installation.json');
  const saved = JSON.stringify({
    runtime: { port: api.port, token: 'synthetic' },
    endpoint: host.origin,
    targetId: 'old',
  });
  writeFileSync(journal, saved);
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [join(scripts, 'dev.mjs'), '--no-open', '--cdp', host.origin],
      {
        env: { ...process.env, PALBOO_HOME: join(root, 'installation') },
        timeout: 10000,
      },
    ),
    (error) => error.code === 1 && error.stderr.split('没有找到可调试的真实 Codex').length === 2,
  );
  assert.deepEqual(requests, []);
  assert.equal(readFileSync(journal, 'utf8'), saved);
  assert.match(
    readJsonForTest(join(root, 'target/dev/launcher-error.json')).message,
    /没有找到可调试/,
  );
  assert.equal(existsSync(join(root, 'target/dev/owner.json')), false);
});

function readJsonForTest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
test('host discovery uses configured real window and never falls back to a fixture', async (t) => {
  const source = temporary(t);
  let targets = [
    { id: 'one', type: 'page', url: 'app://-/index.html' },
    { id: 'two', type: 'page', url: 'app://-/index.html' },
  ];
  const endpoint = await server(t, (_, res) => res.end(JSON.stringify(targets)));
  writeFileSync(join(source, 'config.json'), JSON.stringify({ targetId: 'two' }));
  const host = await findHost(source, { cdp: endpoint.origin });
  assert.equal(host.target.id, 'two');
  await assert.rejects(findHost(source, { cdp: endpoint.origin, target: 'missing' }), /不存在/);
  targets = [{ id: 'fixture', type: 'page', url: endpoint.origin + '/fixture' }];
  await assert.rejects(findHost(source, { cdp: endpoint.origin }), /没有找到可调试的真实 Codex/);
});
test('Dev prepares a missing host once, then discovers its real page without changing installation settings', async (t) => {
  const source = temporary(t);
  const saved = JSON.stringify({ hostRestartPolicy: 'force', cdpEndpoint: 'http://127.0.0.1:1' });
  writeFileSync(join(source, 'config.json'), saved);
  const originalFetch = globalThis.fetch;
  const host = await server(t, (_, res) =>
    res.end(JSON.stringify([{ id: 'reopened', type: 'page', url: 'app://-/index.html' }])),
  );
  t.mock.method(globalThis, 'fetch', (url, options) =>
    String(url).startsWith(host.origin)
      ? originalFetch(url, options)
      : Promise.reject(new Error('fixture: no host')),
  );
  let preparations = 0;
  const found = await findDevelopmentHost(source, { 'restart-running': true }, async () => {
    preparations++;
    return host.origin + '\n';
  });
  assert.equal(preparations, 1);
  assert.equal(found.target.id, 'reopened');
  assert.equal(readFileSync(join(source, 'config.json'), 'utf8'), saved);
});

test('Dev respects cancellation and explicit connection choices without retrying restart', async (t) => {
  const source = temporary(t);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fixture: no host');
  });
  let preparations = 0;
  const prepare = async () => {
    preparations++;
    throw new Error('已取消重开，ChatGPT 保持运行。');
  };
  await assert.rejects(
    findDevelopmentHost(source, { 'restart-running': true }, prepare),
    /已取消重开/,
  );
  assert.equal(preparations, 1);
  for (const options of [
    {},
    { 'restart-running': true, cdp: '12345' },
    { 'restart-running': true, target: 'selected' },
  ])
    await assert.rejects(findDevelopmentHost(source, options, prepare), /没有找到可调试/);
  assert.equal(preparations, 1);
});

test('Dev reuses an available host and never invokes restart policy', async (t) => {
  const source = temporary(t);
  const host = await server(t, (_, res) =>
    res.end(JSON.stringify([{ id: 'same', type: 'page', url: 'app://-/index.html' }])),
  );
  writeFileSync(join(source, 'config.json'), JSON.stringify({ cdpEndpoint: host.origin }));
  const found = await findDevelopmentHost(source, { 'restart-running': true }, () =>
    assert.fail('must reuse'),
  );
  assert.equal(found.target.id, 'same');
});

test('selected CodexHost applies only through explicitly authorized Dev preparation', async (t) => {
  const source = temporary(t);
  const host = await server(t, (_, res) =>
    res.end(JSON.stringify([{ id: 'same', type: 'page', url: 'app://-/index.html' }])),
  );
  writeFileSync(
    join(source, 'config.json'),
    JSON.stringify({ cdpEndpoint: host.origin, codexHost: { enabled: true } }),
  );
  let prepared = 0;
  const prepare = () => {
    prepared++;
    return host.origin;
  };
  await findDevelopmentHost(source, {}, prepare, source);
  assert.equal(prepared, 0);
  await findDevelopmentHost(source, { 'restart-running': true }, prepare, source);
  assert.equal(prepared, 1);
  await findDevelopmentHost(source, { 'restart-running': true, cdp: host.origin }, prepare, source);
  assert.equal(prepared, 1);
});

test('paused integration never prepares or restarts a missing or available Dev host', async (t) => {
  const source = temporary(t);
  const host = await server(t, (_, res) =>
    res.end(JSON.stringify([{ id: 'same', type: 'page', url: 'app://-/index.html' }])),
  );
  writeFileSync(
    join(source, 'config.json'),
    JSON.stringify({
      cdpEndpoint: host.origin,
      codexHost: { enabled: true },
      performance: { integrationEnabled: false },
    }),
  );
  const prepare = () => assert.fail('paused integration must not prepare a host');
  const found = await findDevelopmentHost(source, { 'restart-running': true }, prepare);
  assert.equal(found.target.id, 'same');
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fixture: no host');
  });
  await assert.rejects(
    findDevelopmentHost(source, { 'restart-running': true }, prepare),
    /没有找到可调试/,
  );
});

test('first real session copies settings privately and later sessions preserve development edits', (t) => {
  const root = temporary(t),
    source = join(root, 'installed'),
    data = join(root, 'dev');
  mkdirSync(source);
  mkdirSync(data);
  const original = JSON.stringify({
    model: 'test-model',
    stepwise: { generationMode: 'auto', maxItems: 3 },
  });
  writeFileSync(join(source, 'config.json'), original);
  writeFileSync(join(source, 'secrets.json'), JSON.stringify({ apiKey: 'synthetic-test-value' }));
  const host = { endpoint: 'http://127.0.0.1:9229', target: { id: 'one' } };
  initializeData(source, data, host);
  const config = JSON.parse(readFileSync(join(data, 'config.json')));
  assert.equal(config.stepwise.generationMode, 'manual');
  assert.equal(config.model, 'test-model');
  assert.equal(config.stepwise.maxItems, 3);
  assert.equal(statSync(join(data, 'secrets.json')).mode & 0o777, 0o600);
  config.model = 'dev-only';
  writeFileSync(join(data, 'config.json'), JSON.stringify(config));
  initializeData(source, data, { ...host, target: { id: 'two' } });
  assert.equal(JSON.parse(readFileSync(join(data, 'config.json'))).model, 'dev-only');
  assert.equal(readFileSync(join(source, 'config.json'), 'utf8'), original);
});
test('restoration reconnects the original window and retains recovery on failure', async (t) => {
  const root = temporary(t),
    journal = join(root, 'paused.json'),
    requests = [];
  let unavailable = false;
  const api = await server(t, (req, res) => {
    if (unavailable) {
      res.writeHead(503).end('{}');
      return;
    }
    assert.equal(req.headers.authorization, 'Bearer synthetic');
    requests.push(req.url);
    res.end(
      JSON.stringify(
        req.url === '/api/state' ? { connection: { status: 'disconnected' } } : { ok: true },
      ),
    );
  });
  const saved = {
    runtime: { port: api.port, token: 'synthetic' },
    endpoint: 'http://127.0.0.1:9229',
    targetId: 'one',
    detached: true,
  };
  writeFileSync(journal, JSON.stringify(saved));
  await restoreInstallation(journal);
  assert.deepEqual(requests, ['/api/state', '/api/connect', '/api/panel/open']);
  assert.equal(existsSync(journal), false);
  writeFileSync(journal, JSON.stringify(saved));
  unavailable = true;
  await assert.rejects(restoreInstallation(journal), /恢复记录已保留/);
  assert.equal(existsSync(journal), true);
});
test('a selected host can start after the paused installation exited, retaining its exact recovery record', async (t) => {
  const root = temporary(t),
    journal = join(root, 'paused.json');
  const { stdout } = await promisify(execFile)(process.execPath, [
    '-e',
    'console.log(process.pid)',
  ]);
  const pid = Number(stdout.trim());
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const api = await server(t, (_, res) => res.writeHead(503).end('{}'));
  const saved = JSON.stringify({
    runtime: { pid, port: api.port, token: 'synthetic' },
    endpoint: 'http://127.0.0.1:9229',
    targetId: 'original',
    detached: true,
    edgeFeatures: ['model'],
  });
  writeFileSync(journal, saved, { mode: 0o600 });
  // Exiting Dev must preserve pending restoration even if the backend has exited.
  await assert.rejects(restoreInstallation(journal), /恢复记录已保留/);
  assert.equal(readFileSync(journal, 'utf8'), saved);
  await restoreInstallation(journal, {
    endpoint: 'http://127.0.0.1:9231',
    target: { id: 'current' },
  });
  assert.equal(existsSync(journal), false);
  const archived = readdirSync(root).find((name) => name.startsWith('paused.json.stale-'));
  assert.equal(readFileSync(join(root, archived), 'utf8'), saved);
  assert.equal(statSync(join(root, archived)).mode & 0o777, 0o600);
});
test('an unreachable but live or unknown installation cannot lose its recovery record on startup', async (t) => {
  const root = temporary(t),
    journal = join(root, 'paused.json');
  const api = await server(t, (_, res) => res.writeHead(503).end('{}'));
  for (const pid of [process.pid, undefined, null, 0, -1, '123', 1.5]) {
    const saved = JSON.stringify({
      runtime: { pid, port: api.port, token: 'synthetic' },
      endpoint: 'http://127.0.0.1:9229',
      targetId: 'original',
      edgeFeatures: ['model'],
    });
    writeFileSync(journal, saved, { mode: 0o600 });
    await assert.rejects(
      restoreInstallation(journal, {
        endpoint: 'http://127.0.0.1:9231',
        target: { id: 'current' },
      }),
      /恢复记录已保留/,
    );
    assert.equal(readFileSync(journal, 'utf8'), saved);
    assert.equal(readdirSync(root).filter((name) => name.includes('.stale-')).length, 0);
  }
});
test('development storage never reads or migrates installation preferences', async () => {
  for (const development of [false, true]) {
    const result = await build({
      absWorkingDir: resolve(import.meta.dirname, '..'),
      stdin: {
        contents: "import * as c from './ui/shared/constants.js'; globalThis.result=c;",
        resolveDir: resolve(import.meta.dirname, '..'),
      },
      bundle: true,
      write: false,
      format: 'iife',
      define: { PALBOO_DEVELOPMENT: String(development) },
    });
    const context = { window: {} };
    runInNewContext(result.outputFiles[0].text, context);
    for (const [key, value] of Object.entries(context.result).filter(
      ([key]) => key.endsWith('_KEY') && key !== 'API_KEY',
    )) {
      assert.equal(value.startsWith('palboo-dev:'), development, key);
    }
    assert.equal(context.result.DEVELOPMENT, development);
  }
});

test('an orphan development backend blocks startup before touching installation recovery', async (t) => {
  const root = temporary(t),
    scripts = join(root, 'scripts'),
    data = join(root, 'target/dev/real');
  mkdirSync(scripts);
  mkdirSync(data, { recursive: true });
  for (const file of [
    'dev.mjs',
    'brand.mjs',
    'dev-sources.mjs',
    'dev-host.mjs',
    'dev-panel.mjs',
    'dev-web.mjs',
    'dev-runtime.mjs',
    'build-panel.mjs',
  ])
    copyFileSync(resolve(import.meta.dirname, '../scripts', file), join(scripts, file));
  mkdirSync(join(root, 'ui/settings'), { recursive: true });
  copyFileSync(
    resolve(import.meta.dirname, '../ui/settings/dev-sources.js'),
    join(root, 'ui/settings/dev-sources.js'),
  );
  symlinkSync(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'), 'dir');
  writeFileSync(join(data, 'runtime.json'), JSON.stringify({ pid: process.pid }));
  const requests = [];
  const api = await server(t, (req, res) => {
    requests.push(req.url);
    res.end('{}');
  });
  const journal = join(root, 'target/dev/paused-installation.json');
  writeFileSync(journal, JSON.stringify({ runtime: { port: api.port, token: 'synthetic' } }));
  await assert.rejects(
    promisify(execFile)(process.execPath, [join(scripts, 'dev.mjs'), '--no-open'], {
      env: { ...process.env, PALBOO_HOME: join(root, 'installation') },
      timeout: 10000,
    }),
    (error) => error.code === 1 && error.stderr.includes('开发数据目录仍有后台运行'),
  );
  assert.deepEqual(requests, []);
  assert.equal(existsSync(journal), true);
  assert.equal(existsSync(join(root, 'target/dev/owner.json')), false);
});

test('Dev closes installed edge views and restores them only on their original connection', async (t) => {
  const journal = join(temporary(t), 'paused.json'),
    requests = [];
  t.mock.method(globalThis, 'WebSocket', function () {
    const socket = {
      send() {
        queueMicrotask(() =>
          socket.onmessage({
            data: JSON.stringify({ id: 1, result: { result: { value: { occupied: false } } } }),
          }),
        );
      },
      close() {},
    };
    queueMicrotask(() => socket.onopen());
    return socket;
  });
  const endpoint = 'http://127.0.0.1:9229';
  let connection = { status: 'connected', endpoint, targetId: 'original' };
  const entries = [
    { id: 'model', owner: 'model-owner', placement: 'edge', open: true },
    { id: 'board', owner: 'board-owner', placement: 'edge', open: false },
    { id: 'next', owner: 'next-owner', placement: 'sidebar', open: true },
  ];
  let recovery = 'ready';
  let recoveryReads = 0;
  const api = await server(t, async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : null;
    requests.push([req.url, body]);
    if (req.url === '/api/state') return res.end(JSON.stringify({ connection }));
    if (req.url === '/api/features') {
      if (body.op === 'close') {
        assert.equal(
          JSON.parse(readFileSync(journal)).edgeFeatures[0],
          'model',
          'recovery saved before close',
        );
        assert.equal(body.owner, 'model-owner');
        entries[0].open = false;
      }
      if (body.op === 'reveal') {
        entries[0].pending = { placement: 'edge' };
        recoveryReads = 0;
      }
      if (body.op === 'state' && entries[0].pending && ++recoveryReads > 1) {
        assert.equal(existsSync(journal), true, 'journal retained until ready');
        entries[0].pending = null;
        entries[0].open = recovery === 'ready';
      }
      return res.end(JSON.stringify({ features: entries }));
    }
    if (req.url === '/api/disconnect') connection = { ...connection, status: 'disconnected' };
    if (req.url === '/api/connect')
      connection = { status: 'connected', endpoint: body.endpoint, targetId: body.targetId };
    res.end('{}');
  });
  const host = {
    endpoint,
    target: { id: 'original', webSocketDebuggerUrl: 'ws://127.0.0.1:9229' },
    installation: { port: api.port, token: 'synthetic' },
  };
  for (const entry of [
    { placement: 'sidebar', open: true, pending: { placement: 'edge' } },
    { placement: 'edge', open: false, pending: { placement: 'edge' } },
  ]) {
    entries.push({ id: 'moving', ...entry });
    await assert.rejects(pauseInstallation(host, journal), /正在交接/);
    assert.equal(existsSync(journal), false);
    entries.pop();
  }
  await pauseInstallation(host, journal);
  assert.equal(entries[0].open, false);
  assert.equal(entries[2].open, true);
  assert.equal(connection.status, 'disconnected');
  await restoreInstallation(journal);
  assert.equal(entries[0].open, true);
  assert.equal(existsSync(journal), false);
  assert.deepEqual(
    requests
      .filter(([path, b]) => path === '/api/features' && b.op === 'reveal')
      .map(([, b]) => b.id),
    ['model'],
  );
  await pauseInstallation(host, journal);
  recovery = 'failed';
  await assert.rejects(restoreInstallation(journal), /未能恢复/);
  assert.equal(existsSync(journal), true);
  connection = { status: 'connected', endpoint, targetId: 'other' };
  await restoreInstallation(journal);
  assert.equal(entries[0].open, false, 'do not reopen on another chat');
});

test('cold-started host replacing its initial page target updates the unpinned Dev target before handoff', async (t) => {
  const journal = join(temporary(t), 'paused.json');
  const cdp = await server(t, (_, res) =>
    res.end(
      JSON.stringify([
        {
          id: 'main-window',
          type: 'page',
          url: 'app://-/index.html',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9229/main',
        },
      ]),
    ),
  );
  t.mock.method(globalThis, 'WebSocket', function (url) {
    const socket = {
      send() {
        queueMicrotask(() =>
          socket.onmessage({
            data: JSON.stringify({
              id: 1,
              result: { result: { value: { occupied: false, focused: true } } },
            }),
          }),
        );
      },
      close() {},
    };
    queueMicrotask(() =>
      String(url).endsWith('/initial') ? socket.onerror(new Error('closed')) : socket.onopen(),
    );
    return socket;
  });
  const unpinned = {
    endpoint: cdp.origin,
    target: { id: 'initial-window', webSocketDebuggerUrl: 'ws://127.0.0.1:9229/initial' },
    retryInterval: 5,
  };
  await pauseInstallation(unpinned, journal);
  assert.equal(unpinned.target.id, 'main-window');

  const pinned = {
    endpoint: cdp.origin,
    target: { id: 'initial-window', webSocketDebuggerUrl: 'ws://127.0.0.1:9229/initial' },
    pinnedTarget: true,
    retryInterval: 5,
  };
  await assert.rejects(pauseInstallation(pinned, journal), /无法连接宿主调试窗口/);
  assert.equal(pinned.target.id, 'initial-window');
});
