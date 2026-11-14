/* [INPUT]: Explicit original and Palboo-derived controller modules, isolated data directory.
 * [OUTPUT]: Actual upstream discovery cancels on shutdown only after the Palboo fix.
 * [POS]: Controller regression oracle; no real Desktop, sockets, accounts or user data.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [original, patched, directory] = process.argv.slice(2);
const results = [];
for (const [label, source] of [
  ['original', original],
  ['patched', patched],
]) {
  const text = readFileSync(source, 'utf8');
  const marker = '// packages/desktop-control/src/release-main.ts';
  assert.equal(text.split(marker).length, 2);
  assert.ok(text.includes('var stop = () => abort.abort();'));
  assert.ok(text.includes('process.once("SIGTERM", stop);'));
  const module = join(directory, `${label}.mjs`);
  writeFileSync(
    module,
    text.slice(0, text.indexOf(marker)) +
      '\nexport { InstalledRendererCdpControlSession, runDesktopController };\n',
  );
  const { InstalledRendererCdpControlSession, runDesktopController } = await import(
    pathToFileURL(module)
  );
  const abort = new AbortController();
  let reached;
  const discovering = new Promise((resolve) => {
    reached = resolve;
  });
  let discoverySignal,
    disposed = 0,
    serverClosed = 0,
    rendererClosed = 0;
  const session = new InstalledRendererCdpControlSession(
    {
      close() {
        rendererClosed++;
      },
    },
    'http://127.0.0.1:1',
    'synthetic',
    ['codex'],
    500,
    1,
    {
      listTargets(_endpoint, signal) {
        discoverySignal = signal;
        reached();
        return new Promise(() => {});
      },
    },
    { target: { id: 'synthetic' } },
    () => {
      disposed++;
    },
  );
  const running = runDesktopController({ rendererPath: 'synthetic' }, abort.signal, {
    readRenderer: async () => 'synthetic',
    install: async () => session,
    startAttachmentServer: async () => ({
      close: async () => {
        serverClosed++;
      },
    }),
    ready() {},
    publishStatus() {},
    monitorIntervalMs: 1,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const keepAlive = setInterval(() => {}, 1000);
  const timeout = setTimeout(() => {
    throw new Error(`${label} failed to shut down`);
  }, 3000);
  try {
    await discovering;
    // 实际发送 SIGTERM 给本隔离测试进程，沿用官方入口的取消回调。
    await new Promise((resolve) => {
      process.once('SIGTERM', () => {
        abort.abort();
        resolve();
      });
      process.kill(process.pid, 'SIGTERM');
    });
    const cancelledImmediately = discoverySignal.aborted;
    assert.equal(cancelledImmediately, label === 'patched');
    await running;
    assert.equal(serverClosed, 1);
    assert.equal(rendererClosed, 1);
    assert.equal(disposed, 1);
    results.push({ label, cancelledImmediately, serverClosed, rendererClosed });
  } finally {
    clearInterval(keepAlive);
    clearTimeout(timeout);
  }
}
console.log(JSON.stringify(results));
