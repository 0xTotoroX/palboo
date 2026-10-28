/*
 * [INPUT]: e2e 的独立 Chromium 合成聊天、真实 Rust API 和当前二进制。
 * [OUTPUT]: 真实 Wry 大纲点击经 Rust/CDP 定位正文，以及呈现/收回/重开验收。
 * [POS]: 显式 --native-popout 的原生交接子流程；探针只注入自有测试窗口，不截图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const probeScript = `
const errors = [];
addEventListener('error', e => errors.push(e.message));
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
async function poll() {
  try {
    const panel = window.__companionFloatingPanel;
    const rows = [...document.querySelectorAll('.csw-outline-row')];
    const response = await fetch('/native-test-probe', {
      method: 'POST', body: JSON.stringify({
        active: panel?.state.runtimeActive,
        moving: window.__companionPopout?.motionActive(),
        rows: rows.filter(n => n.getBoundingClientRect().height > 0)
          .map(n => n.getAttribute('data-outline-id')),
        viewport: [innerWidth, innerHeight], errors,
        notice: document.querySelector('#popout-notice')?.textContent,
      })
    });
    for (const command of await response.json()) {
      if (command.kind === 'jump') {
        const row = rows.find(n => n.getAttribute('data-outline-id') === command.id);
        if (!row) throw Error('native outline row missing');
        row.click();
      }
      if (command.kind === 'dock') {
        if (window.__buddyNativeChrome) {
          window.__companionPopout.dock();
          continue;
        }
        const button = document.querySelector('[data-window-control="dock"]');
        if (!button || !button.getBoundingClientRect().height) throw Error('native dock control missing');
        if (button.disabled) throw Error('native dock control stayed disabled after entry');
        button.click();
      }
    }
  } catch (error) { errors.push(String(error)); }
  setTimeout(poll, 80);
}
poll();
`;

export async function checkNativePopout({
  desktop,
  api,
  base,
  runtime,
  binary,
  dataDir,
  output,
  record,
  waitFor,
  delay,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'palboo-native-popout-'));
  rmSync(join(output, 'native-failure.json'), { force: true });
  const helper = join(dir, 'probe');
  let latest, child;
  let commands = [];
  const responses = [],
    checks = [];
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      if (req.url === '/native-test-probe') {
        latest = JSON.parse(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(commands.splice(0)));
        return;
      }
      if (req.url === '/native-test-probe.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(probeScript);
        return;
      }
      // Forward the real lease/authorization unchanged. Only the synthetic page gets a probe.
      const upstream = await fetch(base + req.url, {
        method: req.method,
        headers: {
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
          'Content-Type': req.headers['content-type'] || 'application/json',
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        signal: AbortSignal.timeout(15000),
      });
      let content = await upstream.text();
      if (req.url === '/panel')
        content = content.replace(
          '</body>',
          '<script src="/native-test-probe.js"></script></body>',
        );
      if (req.url === '/api/panel/command')
        responses.push({
          request: JSON.parse(body),
          status: upstream.status,
          result: JSON.parse(content),
        });
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'text/plain',
      });
      res.end(content);
    } catch (error) {
      res.writeHead(502);
      res.end(JSON.stringify({ message: String(error) }));
    }
  });
  const stopWindow = async () => {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await waitFor(
      () => child.exitCode !== null || child.signalCode,
      'native test process did not stop',
    );
  };
  try {
    execFileSync('swiftc', [join(import.meta.dirname, 'native-probe.swift'), '-o', helper]);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    writeFileSync(
      join(dir, 'runtime.json'),
      JSON.stringify({
        ...runtime,
        pid: process.pid,
        port: server.address().port,
      }),
      { mode: 0o600 },
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      latest = null;
      commands = [];
      await desktop.getByRole('button', { name: 'Palboo', exact: true }).dblclick({ delay: 80 });
      await waitFor(
        () => desktop.evaluate(() => !window.__companionFloatingPanel.state.detachPending),
        'host detach did not finish',
      );
      const opened = await api('panel/open', {});
      assert.equal(opened.status, 200);
      const lease = opened.body.lease;
      assert.ok(lease);
      writeFileSync(join(dir, 'panel.json'), readFileSync(join(dataDir, 'panel.json')));
      child = spawn(binary, ['--data-dir', dir, 'panel-window', '--lease', lease], {
        env: { ...process.env, PALBOO_DEV_GENIE: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk) => {
          log = (log + chunk).slice(-3000);
        });
      await waitFor(
        async () => {
          assert.equal(child.exitCode, null, log);
          if (!latest?.active || latest.moving !== false || latest.rows.length < 2) return false;
          return (await api('panel/state', { lease })).body.presented;
        },
        'native window not presented with outline',
        20000,
      );
      const windows = JSON.parse(
        execFileSync(helper, ['windows', String(child.pid)], { encoding: 'utf8' }),
      );
      const bounds = windows
        .map((w) => w.kCGWindowBounds)
        .find((b) => b.Width > 300 && b.Height > 300);
      assert.ok(bounds, 'real native window is visible');
      assert.equal(
        await desktop
          .locator('[data-companion-stepwise-root]')
          .evaluate((n) => getComputedStyle(n).visibility),
        'hidden',
      );
      const id = latest.rows[1];
      const before = await desktop.evaluate((id) => {
        const target = document.querySelector(
          '[data-companion-stepwise-outline-id="' + CSS.escape(id) + '"]',
        );
        const scroll = target.closest('.thread-scroll-container');
        scroll.scrollTo({ top: 0, behavior: 'instant' });
        window.nativeJumpObserved = false;
        window.nativeJumpObserver = new MutationObserver(() => {
          if (target.classList.contains('companion-stepwise-outline-target-flash'))
            window.nativeJumpObserved = true;
        });
        window.nativeJumpObserver.observe(target, { attributes: true, attributeFilter: ['class'] });
        return scroll.scrollTop;
      }, id);
      assert.equal(before, 0);
      const responseCount = responses.length;
      commands.push({ kind: 'jump', id });
      await waitFor(
        () =>
          responses.slice(responseCount).some((r) => r.request.command?.kind === 'outline-jump'),
        'native outline command missing',
      );
      const result = responses
        .slice(responseCount)
        .find((r) => r.request.command?.kind === 'outline-jump');
      assert.equal(result.status, 200);
      assert.deepEqual(result.result, { ok: true });
      await delay(1300);
      const navigation = await desktop.evaluate((id) => {
        const target = document.querySelector(
          '[data-companion-stepwise-outline-id="' + CSS.escape(id) + '"]',
        );
        const scroll = target.closest('.thread-scroll-container');
        const box = target.getBoundingClientRect(),
          viewport = scroll.getBoundingClientRect();
        window.nativeJumpObserver.disconnect();
        return {
          highlighted: window.nativeJumpObserved,
          scrollTop: scroll.scrollTop,
          visible: box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1,
        };
      }, id);
      assert.ok(navigation.highlighted && navigation.visible && navigation.scrollTop > before);
      assert.deepEqual(latest.errors, []);
      assert.ok(!latest.notice, latest.notice);
      commands.push({ kind: 'dock' });
      await waitFor(() => child.exitCode !== null, 'native return control did not close', 15000);
      assert.equal(child.exitCode, 0, log);
      await waitFor(
        () =>
          desktop
            .locator('[data-companion-stepwise-root]')
            .evaluate(
              (n) =>
                getComputedStyle(n).visibility !== 'hidden' &&
                window.__companionFloatingPanel.state.open,
            ),
        'host did not restore after native return',
      );
      const preferences = JSON.parse(readFileSync(join(dataDir, 'panel.json')));
      assert.equal(preferences.detached, false);
      checks.push({
        cycle: cycle + 1,
        nativeBounds: bounds,
        navigation,
        presented: true,
        nativeExitCode: child.exitCode,
        hostRestored: true,
      });
      record(`原生浮窗第 ${cycle + 1} 轮：弹出、真实大纲定位、收回并恢复宿主`);
    }
    writeFileSync(
      join(output, 'native-checks.json'),
      JSON.stringify({ checks, screenshots: false }, null, 2),
    );
  } catch (error) {
    writeFileSync(
      join(output, 'native-failure.json'),
      JSON.stringify({ error: String(error), latest, checks }, null, 2),
    );
    throw error;
  } finally {
    await stopWindow();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}
