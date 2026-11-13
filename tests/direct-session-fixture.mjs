// [INPUT]: 隔离测试数据目录与合成启动参数。
// [OUTPUT]: 合成 CDP、Controller 与可正常退出的共享服务。
// [POS]: direct_session_tests.rs 的进程树夹具，不读取用户 Codex 目录。
// [PROTOCOL]: 变更时同步 tests/AGENTS.md。
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const data = process.env.CODEXHOST_DATA_DIR;
const write = (name, value) => {
  const file = join(data, name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
};
const mode = process.argv[2];
if (mode === 'service') {
  const server = createServer((req, res) => {
    const valid =
      req.url === '/v1/shutdown' && req.headers.authorization === `Bearer ${'0'.repeat(64)}`;
    res.writeHead(valid ? 200 : 403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: { stopping: valid } }));
    if (valid) {
      write('service-stopped', true);
      setTimeout(() => process.exit(0), 10);
    }
  });
  server.listen(0, '127.0.0.1', () => {
    write('mapping-store/store.lock', { pid: process.pid });
    write('shared-host-lifecycle.lock', null);
    write(`client-hosts/host-${process.pid}-fixture.json`, {
      version: 1,
      owner: 'service',
      pid: process.pid,
      port: server.address().port,
      token: '0'.repeat(64),
    });
    write('service-pid', process.pid);
  });
} else if (mode === 'cdp') {
  createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        existsSync(join(data, 'no-page'))
          ? []
          : [
              {
                id: 'synthetic',
                title: 'Synthetic',
                type: 'page',
                url: 'app://-/index.html',
                webSocketDebuggerUrl: 'ws://127.0.0.1:1/synthetic',
              },
            ],
      ),
    );
  }).listen(Number(process.argv[3]), '127.0.0.1');
} else {
  const startedAt = Date.now();
  const args = process.argv.slice(2);
  const port = Number(args[args.indexOf('--attachment-port') + 1]);
  const status = () =>
    write('diagnostics/desktop-controller-v1.json', {
      schemaVersion: 1,
      pid: process.pid,
      startedAt,
      renderer: { state: existsSync(join(data, 'allow-installed')) ? 'installed' : 'installing' },
    });
  createServer((_req, res) => res.end('{}')).listen(port, '127.0.0.1', status);
  setInterval(status, 100);
  process.on('SIGTERM', () => {
    write(`controller-stopped-${process.pid}`, true);
    process.exit(0);
  });
}
setTimeout(() => process.exit(99), 90000).unref();
