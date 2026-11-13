/* [INPUT]: 当前 Palboo 与显式指定的官方 Host/Node/stock CLI。
 * [OUTPUT]: 私有入口 → 前台 Host → 真实 Shim → 真实 app-server 初始化及祖先验证。
 * [POS]: 隔离 CODEX_HOME/Host 数据的完整后端握手；不启动第二个真实 ChatGPT、不访问用户会话。
 * [PROTOCOL]: 变更时同步 tests/AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function fixture() {
  const fs = await import('node:fs'),
    path = await import('node:path');
  const { spawn, spawnSync } = await import('node:child_process');
  const root = process.env.PALBOO_REAL_ROOT,
    pkg = process.env.PALBOO_TEST_CODEXHOST_PACKAGE;
  const node = process.execPath,
    stock = process.env.PALBOO_TEST_STOCK_CLI,
    host = path.join(pkg, 'bin/codexhost'),
    runtime = path.join(pkg, 'app/host-runtime.mjs');
  const data = path.join(root, 'data'),
    proxy = path.join(root, 'palboo'),
    context = path.join(root, 'context.json');
  fs.mkdirSync(data, { mode: 0o700 });
  fs.writeFileSync(
    context,
    JSON.stringify({
      executable: proxy,
      desktop: node,
      endpoint: 'http://127.0.0.1:54324',
      stock,
      shim: path.join(pkg, 'libexec/codexhost-shim'),
      service: { installation: host, node, runtime, stock, data },
    }),
    { mode: 0o600 },
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !k.startsWith('CODEXHOST_') &&
        ![
          'CODEX_CLI_PATH',
          'PALBOO_NATIVE_CLI_CONTEXT',
          'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
        ].includes(k),
    ),
  );
  Object.assign(env, {
    CODEX_HOME: path.join(root, 'codex-home'),
    CODEX_CLI_PATH: proxy,
    PALBOO_NATIVE_CLI_CONTEXT: context,
    CODEXHOST_HOST_NODE_PATH: node,
    CODEXHOST_HOST_RUNTIME_PATH: runtime,
    CODEXHOST_STOCK_CODEX_PATH: stock,
    CODEXHOST_LAUNCHER_EXECUTABLE: host,
    CODEXHOST_DATA_DIR: data,
    CODEXHOST_SHARED_DATA_DIR: data,
    CODEXHOST_WEB_SERVICE: '0',
    CODEXHOST_REMOTE_SSH_MANAGED: '0',
  });
  const child = spawn(
    proxy,
    ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'],
    { env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let errors = '';
  child.stderr.on('data', (b) => (errors += b));
  try {
    const reply = new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('initialize timeout: ' + errors)), 15000);
      child.stdout.on('data', (b) => {
        output += b;
        for (const line of output.split('\n')) {
          try {
            const m = JSON.parse(line);
            if (m.id === 1) {
              clearTimeout(timer);
              resolve(m);
            }
          } catch {}
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('main CLI exited: ' + code + ' ' + errors));
      });
    });
    child.stdin.write(
      JSON.stringify({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'codex-desktop', version: '1' },
          capabilities: { experimentalApi: true },
        },
      }) + '\n',
    );
    const initialized = await reply;
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const owner = JSON.parse(fs.readFileSync(path.join(data, 'shared-host-ready.json')));
    let pid = owner.pid,
      descendant = false;
    for (let i = 0; i < 64 && pid > 1; i++) {
      if (pid === process.pid) {
        descendant = true;
        break;
      }
      pid = Number(
        spawnSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], {
          encoding: 'utf8',
        }).stdout.trim(),
      );
    }
    const executable = spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'comm='], {
      encoding: 'utf8',
    }).stdout.trim();
    console.log(
      JSON.stringify({
        initialized: initialized.result != null,
        codexHome: initialized.result?.codexHome,
        descendant,
        executable,
        fallback: fs.existsSync(path.join(root, 'compatibility-error.json')),
      }),
    );
  } finally {
    child.stdin.end();
    spawnSync(host, ['host', 'stop', '--node', node, '--host-runtime', runtime, '--data', data], {
      env,
      stdio: 'ignore',
      timeout: 15000,
    });
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}

const ready =
  process.platform === 'darwin' &&
  [
    'PALBOO_TEST_CLI',
    'PALBOO_TEST_CODEXHOST_PACKAGE',
    'PALBOO_TEST_BUNDLED_NODE',
    'PALBOO_TEST_STOCK_CLI',
  ].every((k) => process.env[k]);
test(
  'real Shim initializes through the private entry and keeps a native desktop ancestor',
  { skip: !ready },
  (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'palboo-real-shim-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    copyFileSync(realpathSync(process.env.PALBOO_TEST_CLI), join(root, 'palboo'));
    chmodSync(join(root, 'palboo'), 0o700);
    const script = join(root, 'fixture.mjs');
    writeFileSync(script, `await (${fixture.toString()})();\n`);
    const run = spawnSync(
      realpathSync(process.env.PALBOO_TEST_BUNDLED_NODE),
      [script, '--remote-debugging-port=54324'],
      { env: { ...process.env, PALBOO_REAL_ROOT: root }, encoding: 'utf8', timeout: 40000 },
    );
    assert.equal(run.status, 0, run.stderr || String(run.error));
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.initialized, true);
    assert.equal(result.descendant, true);
    assert.equal(result.fallback, false);
    assert.equal(result.codexHome, join(root, 'codex-home'));
    assert.equal(
      result.executable,
      join(realpathSync(process.env.PALBOO_TEST_CODEXHOST_PACKAGE), 'libexec/codexhost-shim'),
    );
  },
);
