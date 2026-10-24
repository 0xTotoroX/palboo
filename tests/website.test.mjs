/* [INPUT]: Production website build, local HTTP server and synthetic browser input.
 * [OUTPUT]: Feature/state, surface geometry, theme, motion and responsive acceptance.
 * [POS]: Isolated public-page tests; no host, model, real configuration or screenshots.
 * [PROTOCOL]: Keep tests/AGENTS.md and website/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

let server;
let browser;
let base;
test.before(async () => {
  await build({ configFile: 'ui/website/vite.config.ts', logLevel: 'error' });
  server = await preview({
    configFile: 'ui/website/vite.config.ts',
    logLevel: 'error',
    preview: { host: '127.0.0.1', port: 0 },
  });
  base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => {
  await browser?.close();
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.httpServer.close(resolve);
    server.httpServer.closeAllConnections();
  });
});

test('feature interactions preserve local drafts and never call application or external services', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  try {
    await page.goto(base);
    const choose = (name) => page.getByRole('tab', { name, exact: true }).click();
    await page.getByRole('button', { name: /01 完善实现方案/ }).click();
    assert.match(await page.getByLabel('接着聊', { exact: true }).inputValue(), /周末能完成/);
    await choose('大纲');
    await page
      .locator('.demo-outline')
      .getByRole('button', { name: /做完，再验证/ })
      .click();
    assert.match(await page.locator('.chat-paragraph.is-focused').innerText(), /做完，再验证/);
    await choose('任务看板');
    await page.getByRole('button', { name: '明确第一版范围，移到进行中' }).click();
    await page.getByRole('button', { name: '明确第一版范围，移到完成' }).click();
    assert.equal(await page.locator('.demo-board > div').nth(2).getByRole('button').count(), 1);
    await choose('模型切换');
    await page.getByRole('button', { name: '推理模型', exact: true }).click();
    assert.match(await page.locator('.model-readback').innerText(), /推理模型/);
    await choose('术语释义');
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    await page.getByRole('button', { name: '掌握了', exact: true }).click();
    await choose('Grok Bot');
    await page.getByRole('button', { name: '资料助手', exact: true }).click();
    assert.match(await page.getByLabel('接着聊', { exact: true }).inputValue(), /请问「资料助手」/);
    await choose('术语释义');
    assert.equal(
      await page.getByRole('button', { name: '已收藏', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page.getByRole('button', { name: '已掌握', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    await page.getByLabel('接着聊', { exact: true }).fill('我自己的演示草稿');
    await choose('下一步');
    assert.equal(await page.getByLabel('接着聊', { exact: true }).inputValue(), '我自己的演示草稿');
    await page.getByRole('button', { name: '重置功能演示' }).click();
    assert.equal(await page.getByLabel('接着聊', { exact: true }).inputValue(), '');
    assert.deepEqual(errors, []);
    assert.ok(
      requests.every((url) => url.startsWith(base)),
      'page requests only its own static assets',
    );
    assert.ok(
      requests.every((url) => !url.includes('/api/')),
      'no product API use',
    );
    assert.equal(
      await page.getByRole('link', { name: '查看发布版本' }).getAttribute('href'),
      'https://github.com/0xTotoroX/palboo/releases',
    );
    assert.equal(
      await page.locator('a[download]').count(),
      0,
      'no fabricated unpublished download',
    );
  } finally {
    await page.close();
  }
});

test('original opening runs once, pauses offscreen and respects reduced motion', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(base);
    const stage = page.locator('.original-opening');
    await page.getByRole('button', { name: '重播品牌动画' }).click();
    await page.waitForFunction(
      () => +document.querySelector('.original-opening').dataset.time > 0.1,
    );
    await page.getByRole('button', { name: '暂停品牌动画' }).click();
    assert.equal(await stage.getAttribute('data-playing'), 'false');
    const stopped = await stage.getAttribute('data-time');
    await page.getByRole('button', { name: '播放品牌动画' }).click();
    await page.getByRole('link', { name: '查看发布版本' }).scrollIntoViewIfNeeded();
    // One full second of frames offscreen must not advance the opening.
    const hiddenTimes = await stage.evaluate(async (el) => {
      const values = [];
      for (let i = 0; i < 70; i++) {
        values.push(el.dataset.time);
        await new Promise(requestAnimationFrame);
      }
      return values;
    });
    assert.equal(new Set(hiddenTimes.slice(10)).size, 1);
    await page.getByRole('button', { name: '重播品牌动画' }).scrollIntoViewIfNeeded();
    await page.waitForFunction(
      (t) => +document.querySelector('.original-opening').dataset.time > +t,
      stopped,
    );
    await page.waitForFunction(
      () => document.querySelector('.original-opening').dataset.time === '6.8000',
      null,
      { timeout: 12000 },
    );
    assert.equal(await stage.getAttribute('data-playing'), 'false');
    assert.equal(await page.locator('#cheeks').getAttribute('opacity'), '1');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('.original-opening')?.dataset.time === '6.8000',
    );
    assert.equal(await stage.getAttribute('data-playing'), 'false');
    assert.equal(
      await page
        .locator('header, nav, .eyebrow, .section-index, .feature-picker, .animated-wordmark')
        .count(),
      0,
    );
  } finally {
    await page.close();
  }
});

test('embedded SVG geometry and poses match the approved original at each phase', async () => {
  const original = await browser.newPage({ reducedMotion: 'reduce' });
  const embedded = await browser.newPage();
  try {
    const source = await readFile('ui/website/media/palboo-opening.source.html', 'utf8');
    await original.setContent(source);
    const svg = await readFile('ui/website/media/palboo-opening.svg', 'utf8');
    const script = await readFile('ui/website/brand-poses.js', 'utf8');
    await embedded.setContent(`<div id="stage">${svg}</div>`);
    await embedded.addScriptTag({
      content:
        script.replace(
          'export function createBrandPose',
          'window.createBrandPose = function createBrandPose',
        ) + ';window.pose = createBrandPose(document.querySelector("#stage"));',
    });
    const attributes = () =>
      [...document.querySelectorAll('#art [id]')].map((el) => [
        el.id,
        ...['d', 'transform', 'opacity', 'r', 'x'].map((a) => el.getAttribute(a)),
      ]);
    for (const time of [0, 0.7, 1.4, 1.8, 2.35, 3.2, 3.8, 4.77, 5.16, 5.6, 6.8]) {
      await original.evaluate((t) => window.palboo.seek(t), time);
      await embedded.evaluate((t) => window.pose.render(t), time);
      assert.deepEqual(
        await embedded.evaluate(attributes),
        await original.evaluate(attributes),
        `original pose at ${time}s`,
      );
    }
  } finally {
    await original.close();
    await embedded.close();
  }
});

test('settings device model hands off to the secondary screen and retains its draft', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(base);
    await page.getByLabel('窗口演示草稿', { exact: true }).fill('窗口之间保留草稿');
    await page.locator('#surface-desktop').click();
    const frames = await page.locator('.layout-demo-window').evaluate(async (el) => {
      const positions = [];
      for (let i = 0; i < 70; i++) {
        positions.push(el.x.baseVal.value);
        await new Promise(requestAnimationFrame);
      }
      return positions;
    });
    assert.ok(
      frames.some((x) => x > 470 && x < 730),
      'original intermediate handoff remains visible',
    );
    await page.waitForFunction(
      () => document.querySelector('.layout-demo-window').x.baseVal.value === 754,
    );
    await page.locator('#surface-sidebar').click();
    await page.locator('#surface-overlay').click();
    await page.waitForFunction(
      () => document.querySelector('.layout-demo-window').x.baseVal.value === 402,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const positions = [];
    for (const id of ['sidebar', 'overlay', 'desktop', 'edge']) {
      await page.locator(`#surface-${id}`).click();
      assert.equal(await page.locator('.surface-model').getAttribute('data-surface'), id);
      await page.waitForFunction(
        (x) => document.querySelector('.layout-demo-window').x.baseVal.value === x,
        { sidebar: 454, overlay: 402, desktop: 754, edge: 468 }[id],
      );
      positions.push(
        await page
          .locator('.layout-demo-window')
          .evaluate((el) => [el.x.baseVal.value, el.y.baseVal.value, el.width.baseVal.value]),
      );
    }
    assert.equal(new Set(positions.map((p) => p.join(','))).size, 4);
    assert.equal(
      await page.getByLabel('窗口演示草稿', { exact: true }).inputValue(),
      '窗口之间保留草稿',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#surface-sidebar').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#surface-overlay').getAttribute('aria-selected'), 'true');
    await page.waitForFunction(
      () => document.querySelector('.layout-demo-window').x.baseVal.value === 402,
      null,
      { timeout: 150 },
    );
    await page.keyboard.press('End');
    assert.equal(await page.locator('#surface-edge').getAttribute('aria-selected'), 'true');
    await page.locator('#feature-next').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#feature-outline').getAttribute('aria-selected'), 'true');
  } finally {
    await page.close();
  }
});

test('responsive light/dark layouts keep content and controls inside the viewport', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce', colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(base);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: '切换到深色' }).click();
      for (const width of [360, 550, 900, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const name of ['下一步', '任务看板', '术语释义']) {
          await page.getByRole('tab', { name, exact: true }).click();
          const geometry = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            overflow: [...document.querySelectorAll('body *')]
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return rect.width && rect.right > innerWidth + 1 && !node.closest('.surface-model');
              })
              .slice(0, 10)
              .map((node) => ({
                tag: node.tagName,
                className: node.getAttribute('class'),
                parent: node.parentElement?.className,
                name: node.getAttribute('aria-label') || node.textContent,
                right: node.getBoundingClientRect().right,
              })),
            stage: document.querySelector('.product-demo').getBoundingClientRect().toJSON(),
            buttons: [
              ...document.querySelectorAll('.surface-tabs button, .demo-feature-tabs button'),
            ].map((node) => node.getBoundingClientRect().toJSON()),
          }));
          assert.ok(
            geometry.scrollWidth <= geometry.width,
            `${theme} ${width} ${name}: horizontal overflow ${JSON.stringify(geometry.overflow)}`,
          );
          assert.ok(geometry.stage.x >= 0 && geometry.stage.right <= width);
          for (const box of geometry.buttons)
            assert.ok(box.width >= 28 && box.height >= 28 && box.left >= 0 && box.right <= width);
        }
      }
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-site-theme'), 'dark');
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('h1').count(), 1);
  } finally {
    await page.close();
  }
});
