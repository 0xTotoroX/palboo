/* [INPUT]: Real settings preview, host styles, isolated revisioned API and Chromium.
 * [OUTPUT]: Persistence, no-popup modes, drag/keyboard, language, geometry and playback acceptance.
 * [POS]: Synthetic preview only; never connects to the user's apps or takes screenshots. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

// This component is mounted inside the same General settings card/hidden page boundary.
test(
  'lifecycle preview saves choices, keeps dragged placement, and never runs real lifecycle actions',
  { timeout: 90000 },
  async (t) => {
    const bundle = await build({
      stdin: {
        contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {LifecyclePreviewSettings} from './ui/settings/lifecycle-preview';
    import {setLocale} from './ui/shared/i18n.js';
    const lang = new URLSearchParams(location.search).get('lang') || 'zh-CN'; setLocale(lang);
    fetch('/api/appearance').then(r=>r.json()).then(value => createRoot(document.getElementById('app')).render(<div data-settings-page="general"><LifecyclePreviewSettings value={value} live={true}/></div>));
  `,
        resolveDir: process.cwd(),
        loader: 'tsx',
      },
      bundle: true,
      format: 'iife',
      write: false,
      outfile: 'app.js',
      jsx: 'automatic',
    });
    const js = bundle.outputFiles.find((f) => f.path.endsWith('.js')).text;
    const builtHtml = await readFile('target/web/index.html', 'utf8');
    const css = (
      await Promise.all(
        [...builtHtml.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map(([, href]) =>
          readFile(`target/web${href}`, 'utf8'),
        ),
      )
    ).join('\n');

    let prefs = {
      revision: 2,
      webRevision: 2,
      ui: {},
      detached: false,
      alwaysOnTop: true,
      position: null,
    };
    const writes = [];
    let reject = false;
    const server = createServer(async (req, res) => {
      if (req.url === '/api/appearance') {
        if (req.method === 'POST') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const patch = JSON.parse(Buffer.concat(chunks));
          writes.push(patch);
          if (reject || patch.expectedRevision !== prefs.revision) {
            reject = false;
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: 'fixture conflict' }));
            return;
          }
          assert.deepEqual(Object.keys(patch).sort(), ['expectedRevision', 'lifecyclePreview']);
          prefs = {
            ...prefs,
            lifecyclePreview: patch.lifecyclePreview,
            revision: prefs.revision + 1,
          };
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(prefs));
        return;
      }
      if (req.url === '/app.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(js);
        return;
      }
      if (req.url === '/style.css') {
        res.setHeader('Content-Type', 'text/css');
        res.end(css);
        return;
      }
      if (req.url.startsWith('/api/')) {
        assert.fail(`Unexpected product request ${req.url}`);
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<html><head><link rel="stylesheet" href="/style.css"><style>body{margin:0;font:16px system-ui;background:var(--buddy-page);color:var(--buddy-text)}#app{padding:16px;max-width:660px;margin:auto}button,select{font:inherit}button{cursor:pointer}button svg{width:18px;height:18px}*{box-sizing:border-box}</style></head><body><main id="app"></main><script src="/app.js"></script></body></html>',
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      server.closeAllConnections();
      server.close();
    });
    const page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.locator('#lifecycle-display').waitFor();
    const choose = async (id, value) => {
      await page.locator(id).selectOption(value);
      await page.waitForFunction(() => !document.querySelector('#lifecycle-display').disabled);
    };
    assert.equal(await page.locator('.lifecycle-notification header time').count(), 0);
    assert.equal(
      await page.locator('.lifecycle-notification li time').count(),
      await page.locator('.lifecycle-notification li').count(),
    );
    assert.equal(await page.locator('.lifecycle-styles').count(), 0);
    assert.equal(await page.locator('#lifecycle-placement').inputValue(), 'host-center');
    const centered = await page.evaluate(() => {
      const n = document.querySelector('.lifecycle-notification').getBoundingClientRect();
      const s = document.querySelector('.lifecycle-scene').getBoundingClientRect();
      const menu = document.querySelector('.lifecycle-menubar').getBoundingClientRect();
      return {
        dx: (n.left + n.right - s.left - s.right) / 2,
        dy: (n.top + n.bottom - menu.bottom - (s.bottom - 1)) / 2,
      };
    });
    assert(Math.abs(centered.dx) <= 1 && Math.abs(centered.dy) <= 1, JSON.stringify(centered));
    assert.equal(
      await page.locator('.lifecycle-notification .lifecycle-bar').getAttribute('data-style'),
      'energy',
    );
    await choose('#lifecycle-material', 'matte');
    assert.equal(prefs.lifecyclePreview.progress, 'energy');
    assert.equal(prefs.lifecyclePreview.placement, 'host-center');
    // Older saved menu placement resolves to the new centered choice without a migration write.
    prefs.lifecyclePreview.placement = 'menu';
    await page.reload();
    await page.locator('#lifecycle-display').waitFor();
    assert.equal(await page.locator('#lifecycle-placement').inputValue(), 'host-center');
    assert.equal(await page.locator('#lifecycle-material').inputValue(), 'matte');
    const header = page.locator('.lifecycle-notification header');
    const before = await header.boundingBox();
    await page.mouse.move(before.x + 100, before.y + 18);
    await page.mouse.down();
    await page.mouse.move(before.x + 30, before.y + 55, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('#lifecycle-display').disabled);
    assert.equal(prefs.lifecyclePreview.placement, 'remember');
    const moved = await header.boundingBox();
    assert(moved.x < before.x - 20);
    await page.evaluate(() => {
      window.cellSamples = [];
      window.cellObserver = new MutationObserver(() =>
        window.cellSamples.push(
          document.querySelectorAll('.lifecycle-notification .lifecycle-bar [data-filled="true"]')
            .length,
        ),
      );
      window.cellObserver.observe(
        document.querySelector('.lifecycle-notification .lifecycle-bar'),
        { attributes: true, subtree: true },
      );
    });
    await page.getByRole('button', { name: '播放启动', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('.lifecycle-notification li').length === 2,
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.lifecycle-notification .lifecycle-bar [data-filled="true"]')
          .length === 4,
    );
    const cells = await page.evaluate(() => {
      window.cellObserver.disconnect();
      return window.cellSamples;
    });
    for (const count of [1, 2, 3, 4])
      assert(cells.includes(count), `Missing cell ${count}: ${cells}`);
    assert(
      cells.every((n, i) => i === 0 || n - cells[i - 1] <= 1),
      `Progress jumped: ${cells}`,
    );
    const during = await header.boundingBox();
    assert(Math.abs(during.x - moved.x) < 1 && Math.abs(during.y - moved.y) < 1);
    await page.getByRole('button', { name: '播放退出', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('.lifecycle-notification strong').textContent ===
        'Palboo 已完全退出',
    );
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '4');
    await page.locator('.lifecycle-notification').waitFor({ state: 'hidden' });
    await choose('#lifecycle-display', 'menu');
    await page.getByRole('button', { name: '播放启动', exact: true }).click();
    assert.equal(await page.locator('.lifecycle-notification').count(), 0);
    await page.getByRole('button', { name: '展开或收起提示', exact: true }).click();
    await header.waitFor();
    await choose('#lifecycle-display', 'hidden');
    await page.getByRole('button', { name: '模拟卡住', exact: true }).click();
    assert.equal(await page.locator('.lifecycle-notification').count(), 0);
    assert.equal(await page.locator('.lifecycle-menubar button').count(), 0);
    await choose('#lifecycle-display', 'popup');
    await page.getByRole('button', { name: '模拟卡住', exact: true }).click();
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '2');
    await header.focus();
    await header.press('ArrowLeft');
    await page.waitForFunction(() => !document.querySelector('#lifecycle-display').disabled);
    assert(prefs.lifecyclePreview.position.x < 0.8);
    reject = true;
    await choose('#lifecycle-material', 'frosted');
    await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
    assert.equal(await page.locator('#lifecycle-material').inputValue(), 'frosted');
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#lifecycle-display').disabled);
    assert.equal(prefs.lifecyclePreview.material, 'frosted');
    for (const lang of ['zh-CN', 'en'])
      for (const width of [375, 800])
        for (const colorScheme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 1050 });
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
          await page.goto(`${url}/?lang=${lang}`);
          await header.waitFor();
          const geometry = await page.evaluate(() => {
            const n = document.querySelector('.lifecycle-notification').getBoundingClientRect(),
              s = document.querySelector('.lifecycle-scene').getBoundingClientRect();
            return {
              inside: n.left >= s.left && n.right <= s.right + 1 && n.bottom <= s.bottom + 1,
              overflow: document.documentElement.scrollWidth > innerWidth,
              offenders: [...document.querySelectorAll('body *')]
                .filter((n) => n.getBoundingClientRect().right > innerWidth + 1)
                .map((n) => [
                  n.tagName,
                  n.className,
                  n.getBoundingClientRect().width,
                  n.getBoundingClientRect().right,
                ]),
              animation: getComputedStyle(document.querySelector('.lifecycle-notification li'))
                .animationName,
            };
          });
          assert(geometry.inside, JSON.stringify({ lang, width, colorScheme, geometry }));
          assert(!geometry.overflow, JSON.stringify({ lang, width, geometry }));
          assert.equal(geometry.animation, 'none');
          assert.equal(await page.locator('.lifecycle-notification header time').count(), 0);
          assert.equal(
            await page.locator('.lifecycle-notification li time').count(),
            await page.locator('.lifecycle-notification li').count(),
          );
        }
    assert.equal(await page.locator('h2').textContent(), 'Startup and exit feedback');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert(writes.length >= 8);
  },
);
