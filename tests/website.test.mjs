/* [INPUT]: Production website build, local HTTP server and synthetic browser input.
 * [OUTPUT]: Feature/state, surface geometry, theme, motion and responsive acceptance.
 * [POS]: Isolated public-page tests; no host, model, real configuration or screenshots.
 * [PROTOCOL]: Keep tests/AGENTS.md and website/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';

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
    const choose = (name) =>
      page.locator('.feature-picker').getByRole('button', { name, exact: true }).click();
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

test('surface movement, keyboard selection, one-shot brand motion and reduced motion', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(base);
    await page.getByRole('button', { name: '重播品牌动画' }).click();
    const eyeFrames = await page
      .locator('.animated-wordmark [data-brand-eyes] rect')
      .first()
      .evaluate((eye) => {
        const animation = eye.getAnimations()[0];
        animation.pause();
        animation.currentTime = 0;
        const start = getComputedStyle(eye).fillOpacity;
        animation.currentTime = 2200;
        const finish = getComputedStyle(eye).fillOpacity;
        return { start, finish, iterations: animation.effect.getTiming().iterations };
      });
    assert.equal(eyeFrames.start, '0');
    assert.equal(eyeFrames.finish, '1');
    assert.equal(eyeFrames.iterations, 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page
        .locator('.animated-wordmark')
        .evaluate((node) => node.getAnimations({ subtree: true }).length),
      0,
    );
    const positions = [];
    for (const id of ['sidebar', 'overlay', 'desktop', 'edge']) {
      await page.locator(`#surface-${id}`).click();
      assert.equal(await page.locator('.surface-stage').getAttribute('data-surface'), id);
      positions.push(await page.locator('.surface-workbench').boundingBox());
    }
    assert.equal(new Set(positions.map(({ x, y, width }) => `${x},${y},${width}`)).size, 4);
    await page.locator('#surface-sidebar').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#surface-overlay').getAttribute('aria-selected'), 'true');
    assert.equal(
      await page.locator('#surface-overlay').evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press('End');
    assert.equal(await page.locator('#surface-edge').getAttribute('aria-selected'), 'true');
    await page.locator('#feature-next').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#feature-outline').getAttribute('aria-selected'), 'true');
    await page.getByText('安装时需要敲命令吗？', { exact: true }).click();
    assert.equal(await page.locator('.install-faq details').first().getAttribute('open'), '');
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
          await page.locator('.feature-picker').getByRole('button', { name, exact: true }).click();
          const geometry = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            overflow: [...document.querySelectorAll('body *')]
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return rect.width && rect.right > innerWidth + 1 && !node.closest('.surface-stage');
              })
              .slice(0, 10)
              .map((node) => ({
                tag: node.tagName,
                className: node.getAttribute('class'),
                parent: node.parentElement?.className,
                name: node.getAttribute('aria-label') || node.textContent,
                right: node.getBoundingClientRect().right,
              })),
            stage: document.querySelector('.showcase-stage').getBoundingClientRect().toJSON(),
            buttons: [
              ...document.querySelectorAll('.feature-picker button, .demo-feature-tabs button'),
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
