/* [INPUT]: 显式指定的官方 CodexHost、官方 Node/校验模块及当前 Palboo。
 * [OUTPUT]: 前台 Host 的真实祖先、官方管道授权、重复主服务复用及外部后台拒绝回归。
 * [POS]: 隔离 CODEX_HOME/Host 数据；不连接用户管道，不修改官方代码或关闭官方安全检查。
 * [PROTOCOL]: 变更时同步 tests/AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function fixture() {
  const fs = await import('node:fs'),
    path = await import('node:path'),
    net = await import('node:net');
  const { spawn, spawnSync } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const root = process.env.PALBOO_FIXTURE_ROOT,
    node = process.execPath,
    script = path.join(root, 'fixture.mjs');
  const role = process.argv[2];
  if (role === 'orphan') {
    const p = spawn(node, [script, 'peer0'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PALBOO_FIXTURE_LABEL: 'orphan' },
    });
    p.unref();
    return;
  }
  if (role === 'peer0' || role === 'peer1') {
    const p = spawn(node, [script, role === 'peer0' ? 'peer1' : 'peer2'], { stdio: 'ignore' });
    await new Promise((resolve) => p.on('exit', resolve));
    return;
  }
  if (role === 'peer2') {
    const socket = net.createConnection(process.env.PALBOO_FIXTURE_SOCKET);
    let bytes = '';
    await new Promise((resolve, reject) => {
      socket.on('data', (b) => (bytes += b));
      socket.on('end', resolve);
      socket.on('error', reject);
    });
    fs.writeFileSync(path.join(root, process.env.PALBOO_FIXTURE_LABEL + '.json'), bytes);
    return;
  }
  const authorization = createRequire(import.meta.url)(process.env.PALBOO_TEST_PEER_AUTHORIZER);
  const socket = path.join(root, 'native.sock');
  const server = net.createServer((s) => {
    const result = authorization.authorizeSocketPeer(s._handle.fd, false);
    s.end(JSON.stringify({ authorized: result.authorized, reason: result.reason ?? null }));
  });
  await new Promise((r) => server.listen(socket, r));
  const data = process.env.PALBOO_FIXTURE_DATA,
    context = path.join(root, 'context.json'),
    shim = path.join(root, 'shim');
  const installation = process.env.PALBOO_TEST_CODEXHOST_PACKAGE;
  const runtime = path.join(installation, 'app/host-runtime.mjs'),
    host = path.join(installation, 'bin/codexhost');
  const stock = process.env.PALBOO_TEST_STOCK_CLI;
  fs.writeFileSync(
    shim,
    `#!${node}\nimport {spawn} from 'node:child_process';\nspawn(${JSON.stringify(node)},[${JSON.stringify(script)},'peer0'],{stdio:'ignore'});setInterval(()=>{},1000);\n`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    context,
    JSON.stringify({
      executable: path.join(root, 'palboo'),
      desktop: node,
      endpoint: 'http://127.0.0.1:54323',
      stock,
      shim,
      service: { installation: host, node, runtime, stock, data },
    }),
    { mode: 0o600 },
  );
  const children = [];
  const start = (label) => {
    const p = spawn(path.join(root, 'palboo'), ['app-server', '--analytics-default-enabled'], {
      env: {
        ...process.env,
        PALBOO_NATIVE_CLI_CONTEXT: context,
        PALBOO_FIXTURE_SOCKET: socket,
        PALBOO_FIXTURE_LABEL: label,
        CODEX_CLI_PATH: path.join(root, 'palboo'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(p);
    return p;
  };
  const waitFile = async (name) => {
    const until = Date.now() + 20000;
    while (!fs.existsSync(path.join(root, name))) {
      if (Date.now() > until) throw Error('fixture timeout: ' + name);
      await new Promise((r) => setTimeout(r, 25));
    }
    return JSON.parse(fs.readFileSync(path.join(root, name)));
  };
  const first = start('first');
  let errors = '';
  first.stderr.on('data', (b) => (errors += b));
  if (process.env.PALBOO_FIXTURE_REJECT === '1') {
    const initialized = new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(Error('native fallback initialize timeout: ' + errors)),
        15000,
      );
      first.stdout.on('data', (b) => {
        output += b;
        for (const line of output.split('\n')) {
          try {
            const message = JSON.parse(line);
            if (message.id === 1) {
              clearTimeout(timer);
              resolve(message.result != null);
            }
          } catch {}
        }
      });
      first.on('exit', (code) => {
        clearTimeout(timer);
        reject(Error('native fallback exited: ' + code + ' ' + errors));
      });
    });
    first.stdin.write(
      JSON.stringify({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'palboo_native_fallback_test', version: '1' },
          capabilities: { experimentalApi: true },
        },
      }) + '\n',
    );
    const nativeInitialized = await initialized;
    first.stdin.end();
    const code = await new Promise((r) => first.on('exit', r));
    const failure = JSON.parse(fs.readFileSync(path.join(root, 'compatibility-error.json')));
    console.log(JSON.stringify({ code, nativeInitialized, failure }));
    server.close();
    return;
  }
  const positive = await waitFile('first.json');
  const owner = JSON.parse(fs.readFileSync(path.join(data, 'shared-host-ready.json')));
  start('second');
  const repeated = await waitFile('second.json');
  const sameOwner =
    JSON.parse(fs.readFileSync(path.join(data, 'shared-host-ready.json'))).pid === owner.pid;
  spawn(node, [script, 'orphan'], {
    env: { ...process.env, PALBOO_FIXTURE_SOCKET: socket },
    stdio: 'ignore',
  });
  const negative = await waitFile('orphan.json');
  console.log(JSON.stringify({ positive, repeated, negative, sameOwner, ownerPid: owner.pid }));
  await new Promise((r) => process.stdin.once('data', r));
  const stopped = spawnSync(
    host,
    ['host', 'stop', '--node', node, '--host-runtime', runtime, '--data', data],
    { stdio: 'ignore', timeout: 15000 },
  );
  for (const p of children) p.kill('SIGTERM');
  server.close();
  if (stopped.status !== 0) process.exitCode = 1;
}

const ready =
  process.platform === 'darwin' &&
  [
    'PALBOO_TEST_CLI',
    'PALBOO_TEST_CODEXHOST_PACKAGE',
    'PALBOO_TEST_BUNDLED_NODE',
    'PALBOO_TEST_PEER_AUTHORIZER',
    'PALBOO_TEST_STOCK_CLI',
  ].every((k) => process.env[k]);
test(
  'foreground official Host retains native authorization; detached ancestry is rejected',
  { skip: !ready },
  async (t) => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'palboo-native-ancestry-')));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const data = join(temp, 'data');
    mkdirSync(data, { mode: 0o700 });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) =>
          !k.startsWith('CODEXHOST_') &&
          k !== 'CODEX_CLI_PATH' &&
          k !== 'PALBOO_NATIVE_CLI_CONTEXT',
      ),
    );
    delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
    env.CODEX_HOME = join(temp, 'codex-home');
    env.CODEXHOST_WEB_SERVICE = '0';
    env.CODEXHOST_REMOTE_SSH_MANAGED = '0';
    const run = (name, reject = false) => {
      const root = join(temp, name);
      mkdirSync(root, { mode: 0o700 });
      copyFileSync(realpathSync(process.env.PALBOO_TEST_CLI), join(root, 'palboo'));
      chmodSync(join(root, 'palboo'), 0o700);
      writeFileSync(join(root, 'fixture.mjs'), `await (${fixture.toString()})();\n`);
      const p = spawn(
        realpathSync(process.env.PALBOO_TEST_BUNDLED_NODE),
        [join(root, 'fixture.mjs'), 'root', '--remote-debugging-port=54323'],
        {
          env: {
            ...env,
            PALBOO_FIXTURE_ROOT: root,
            PALBOO_FIXTURE_DATA: data,
            PALBOO_FIXTURE_REJECT: reject ? '1' : '0',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let errors = '',
        output = '';
      p.stderr.on('data', (b) => (errors += b));
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('root timeout: ' + errors)), 40000);
        p.stdout.on('data', (b) => {
          output += b;
          if (output.includes('\n')) {
            clearTimeout(timer);
            try {
              resolve(JSON.parse(output.split('\n')[0]));
            } catch (e) {
              reject(e);
            }
          }
        });
        p.on('exit', (code) => {
          clearTimeout(timer);
          if (!output) reject(Error(`root exited ${code}: ${errors}`));
        });
      });
      return { p, result };
    };
    const first = run('first');
    t.after(() => {
      if (first.p.exitCode === null) first.p.stdin.end('stop\n');
    });
    const result = await first.result;
    assert.equal(result.positive.authorized, true);
    assert.equal(result.repeated.authorized, true);
    assert.equal(result.sameOwner, true);
    assert.equal(result.negative.authorized, false);
    assert.equal(result.negative.reason, 'untrusted-process-ancestry');
    const before = readFileSync(join(data, 'shared-host-ready.json'), 'utf8');
    const other = run('other', true),
      refused = await other.result;
    assert.equal(refused.code, 0);
    assert.equal(refused.nativeInitialized, true);
    assert.match(refused.failure.message, /后台不属于本次桌面/);
    assert.ok(refused.failure.host_ancestors.length > 0);
    assert.equal(readFileSync(join(data, 'shared-host-ready.json'), 'utf8'), before);
    process.kill(result.ownerPid, 0);
    first.p.stdin.end('stop\n');
    const [code] = await once(first.p, 'exit');
    assert.equal(code, 0);
  },
);
