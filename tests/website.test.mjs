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
  browser = await chromium.launch({ channel: 'chromium', headless: true });
});
test.after(async () => {
  await browser?.close();
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.httpServer.close(resolve);
    server.httpServer.closeAllConnections();
  });
});

async function scrollScene(page, selector, progress) {
  await page.locator(selector).evaluate((element, value) => {
    const box = element.getBoundingClientRect();
    scrollTo(0, scrollY + box.top + (box.height - innerHeight) * value);
  }, progress);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('portfolio demos preserve drafts, preferences and undo without service requests', async () => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [],
    requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  try {
    await page.goto(base);
    const demo = page.locator('.product-demo').first();
    const choose = (name) => demo.getByRole('tab', { name, exact: true }).click();
    await demo.getByLabel('接着聊', { exact: true }).fill('我的草稿');
    await demo.getByRole('button', { name: /拆解第一版/ }).click();
    assert.match(
      await demo.getByLabel('接着聊', { exact: true }).inputValue(),
      /^我的草稿\n请把作品集第一版/,
    );
    await demo.getByLabel('演示建议方向').selectOption('探索拓展');
    await demo.getByRole('button', { name: /比较展示方式/ }).click();
    await choose('大纲');
    await demo
      .locator('.demo-outline')
      .getByRole('button', { name: /上线前检查/ })
      .click();
    assert.match(await demo.locator('.chat-paragraph.is-focused').innerText(), /上线前检查/);
    assert.ok(await demo.locator('.demo-chat article').evaluate((node) => node.scrollTop > 0));
    await choose('模型切换');
    await demo.getByRole('button', { name: '推理模型', exact: true }).click();
    assert.match(await demo.locator('.model-readback').innerText(), /推理模型/);
    await choose('术语释义');
    await demo.getByRole('button', { name: '收藏', exact: true }).click();
    await demo.getByRole('button', { name: '掌握了', exact: true }).click();
    await choose('Grok Bot');
    await demo.getByRole('button', { name: '资料助手', exact: true }).click();
    assert.match(
      await demo.getByLabel('接着聊', { exact: true }).inputValue(),
      /我的草稿[\s\S]*请问「资料助手」/,
    );
    await choose('术语释义');
    assert.equal(
      await demo.getByRole('button', { name: '已收藏', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await demo.getByRole('button', { name: '已掌握', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    await demo.getByRole('button', { name: '重置功能演示' }).click();
    assert.equal(await demo.getByLabel('接着聊', { exact: true }).inputValue(), '');
    await choose('下一步');
    await demo.getByRole('tab', { name: '下一步', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await demo.getByRole('tab', { name: '大纲', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    const prompt = page.getByLabel('提示词优化演示', { exact: true });
    const original = await prompt.inputValue();
    await page.getByRole('button', { name: '优化提示词', exact: true }).click();
    assert.match(await prompt.inputValue(), /交付内容与检查方法/);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await prompt.inputValue(), original);
    assert.deepEqual(errors, []);
    assert.ok(requests.every((url) => url.startsWith(base) && !url.includes('/api/')));
    assert.equal(
      await page.getByRole('link', { name: '查看发布版本' }).getAttribute('href'),
      'https://github.com/0xTotoroX/palboo/releases',
    );
    assert.equal(await page.locator('a[download]').count(), 0);
  } finally {
    await page.close();
  }
});

test(
  'scroll reverses original O morph and lands the eyes in the left entry; copy remains readable',
  { timeout: 60000 },
  async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await page.goto(base);
      page.setDefaultTimeout(15000);
      const stage = page.locator('.original-opening');
      await scrollScene(page, '.opening-story', 0.3);
      const forward = +(await stage.getAttribute('data-time'));
      assert.ok(forward > 2 && forward < 4.4);
      await scrollScene(page, '.opening-story', 0.15);
      assert.ok(+(await stage.getAttribute('data-time')) < forward);
      await scrollScene(page, '.opening-story', 1);
      await page.waitForFunction(
        () => document.querySelector('.original-opening').dataset.time === '6.8000',
      );
      const landing = await page.evaluate(() => {
        const svg = document.querySelector('.original-opening svg');
        const point = new DOMPoint(600, 307).matrixTransform(svg.getScreenCTM());
        const target = document.querySelector('.intro-entry').getBoundingClientRect();
        return {
          dx: point.x - target.x - target.width / 2,
          dy: point.y - target.y - target.height / 2,
          entry: getComputedStyle(document.querySelector('.intro-entry > span')).opacity,
        };
      });
      assert.ok(Math.abs(landing.dx) < 2 && Math.abs(landing.dy) < 2, JSON.stringify(landing));
      assert.equal(landing.entry, '1');
      await scrollScene(page, '.reading-story', 0.1);
      const demo = page.locator('.product-demo:visible');
      assert.equal(await demo.getAttribute('data-feature'), 'next');
      await demo.getByLabel('接着聊', { exact: true }).fill('滚动时保留的草稿');
      await demo.getByLabel('接着聊', { exact: true }).blur();

      await scrollScene(page, '.reading-story', 0.48);
      assert.equal(await demo.getAttribute('data-feature'), 'outline');
      await scrollScene(page, '.reading-story', 0.9);
      assert.equal(await demo.getAttribute('data-feature'), 'terms');
      await scrollScene(page, '.reading-story', 0.1);
      assert.equal(
        await demo.getByLabel('接着聊', { exact: true }).inputValue(),
        '滚动时保留的草稿',
      );
      const box = await demo.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 1000, JSON.stringify(box));
      assert.equal(
        await page.locator('header, nav, .eyebrow, .section-index, .feature-picker').count(),
        0,
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        () => document.querySelector('.opening-story').dataset.static === 'true',
      );
      assert.equal(
        await page.locator('.opening-pin').evaluate((node) => getComputedStyle(node).position),
        'relative',
      );
      assert.equal(await page.locator('.static-chapter').count(), 3);
    } finally {
      await page.close();
    }
  },
);

test('active editing and local state survive chapter changes, responsive modes and reduced motion', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(base);
    await scrollScene(page, '.reading-story', 0.1);
    const demo = page.locator('.product-demo').first();
    await demo.getByLabel('接着聊', { exact: true }).fill('窗口变化后保留');
    await demo.getByRole('tab', { name: '术语释义', exact: true }).click();
    await demo.getByRole('button', { name: '收藏', exact: true }).click();
    await demo.getByRole('tab', { name: '任务看板', exact: true }).click();
    await demo.getByRole('button', { name: '在待办中新建任务' }).click();
    const input = demo.getByLabel('待办任务名称');
    await input.fill('仍在编辑的任务');
    await scrollScene(page, '.reading-story', 0.8);
    assert.equal(await demo.getAttribute('data-feature'), 'board');
    assert.equal(await input.evaluate((el) => el === document.activeElement), true);
    for (const viewport of [
      { width: 550, height: 1000 },
      { width: 1280, height: 600 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      assert.equal(await input.inputValue(), '仍在编辑的任务');
      assert.equal(await input.evaluate((el) => el === document.activeElement), true);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await input.inputValue(), '仍在编辑的任务');
    await page.keyboard.press('Enter');
    assert.match(await demo.innerText(), /仍在编辑的任务/);
    assert.equal(await demo.getByLabel('接着聊', { exact: true }).inputValue(), '窗口变化后保留');
    await demo.getByRole('tab', { name: '术语释义', exact: true }).click();
    assert.equal(
      await demo.getByRole('button', { name: '已收藏', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    // A static chapter that has focus becomes the persistent animated stage on return.
    const third = page.locator('.product-demo').nth(2);
    await third.getByLabel('接着聊', { exact: true }).fill('术语章节草稿');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await third.isVisible(), true);
    assert.equal(await third.getByLabel('接着聊', { exact: true }).inputValue(), '术语章节草稿');
    assert.equal(
      await third
        .getByLabel('接着聊', { exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await third.getByLabel('接着聊', { exact: true }).blur();
    await scrollScene(page, '.reading-story', 0.48);
    assert.equal(await third.getAttribute('data-feature'), 'outline');
  } finally {
    await page.close();
  }
});

test('board supports real pointer drag, keyboard actions and creating a local task', async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(base);
    const board = page.locator('.board-stage');
    const lanes = board.locator('.board-lane');
    const card = board.locator('.demo-task').filter({ hasText: '整理三个代表作品' });
    await card.dragTo(lanes.nth(1));
    assert.equal(await lanes.nth(1).locator('.demo-task').count(), 2);
    await board.getByRole('button', { name: '整理三个代表作品，移到完成' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await lanes.nth(2).locator('.demo-task').count(), 2);
    assert.equal(
      await board
        .getByRole('button', { name: '整理三个代表作品，移到待办' })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await board.getByRole('button', { name: '在待办中新建任务' }).click();
    await board.getByLabel('待办任务名称').fill('给作品配上介绍');
    await page.keyboard.press('Enter');
    assert.match(await lanes.nth(0).innerText(), /给作品配上介绍/);
    assert.equal(
      await board
        .getByRole('button', { name: '在待办中新建任务' })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await board.getByRole('button', { name: '在待办中新建任务' }).click();
    await page.keyboard.press('Escape');
    assert.equal(await board.getByLabel('待办任务名称').count(), 0);
    assert.equal(
      await board
        .getByRole('button', { name: '在待办中新建任务' })
        .evaluate((el) => el === document.activeElement),
      true,
    );
  } finally {
    await page.close();
  }
});

test('shared device geometry follows scroll in both directions, and manual/keyboard switching keeps the draft', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  try {
    await page.goto(base);
    const window = page.locator('.layout-demo-window');
    const x = () => window.evaluate((el) => el.x.baseVal.value);
    await scrollScene(page, '.surface-story', 0);
    assert.equal(await x(), 454);
    await page.getByLabel('窗口演示草稿').fill('保留窗口草稿');
    await scrollScene(page, '.surface-story', 0.62);
    assert.ok((await x()) > 414 && (await x()) < 754);
    const interruptedX = await x();
    await page.evaluate(() => {
      window.journeySamples = [];
      const sample = () => {
        window.journeySamples.push(document.querySelector('.layout-demo-window').x.baseVal.value);
        if (window.journeySamples.length < 45) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator('#surface-overlay').click();
    await page.waitForFunction(
      () => document.querySelector('.layout-demo-window').x.baseVal.value === 402,
    );
    assert.ok(
      await page.evaluate((limit) => Math.max(...window.journeySamples) <= limit + 2, interruptedX),
      'manual handoff must begin at the visible intermediate frame',
    );
    await scrollScene(page, '.surface-story', 0.35);
    await scrollScene(page, '.surface-story', 0.75);
    assert.equal(await x(), 754);
    await scrollScene(page, '.surface-story', 0.35);
    assert.equal(await x(), 402);
    await scrollScene(page, '.surface-story', 1);
    assert.equal(await x(), 468);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(
      () => document.querySelector('.surface-story').dataset.static === 'true',
    );
    for (const id of ['sidebar', 'overlay', 'desktop', 'edge']) {
      await page.locator(`#surface-${id}`).click();
      await page.waitForFunction(
        (value) => document.querySelector('.layout-demo-window').x.baseVal.value === value,
        { sidebar: 454, overlay: 402, desktop: 754, edge: 468 }[id],
      );
    }
    assert.equal(await page.getByLabel('窗口演示草稿').inputValue(), '保留窗口草稿');
    await page.locator('#surface-sidebar').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#surface-overlay').getAttribute('aria-selected'), 'true');
    assert.equal(await x(), 402);
  } finally {
    await page.close();
  }
});

test('light/dark responsive and short screens preserve readable controls without overflow or duplicate ids', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce', colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(base);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: '切换到深色' }).click();
      for (const width of [360, 550, 900, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('body *')]
            .filter((node) => {
              const r = node.getBoundingClientRect();
              return r.width && r.right > innerWidth + 1 && !node.closest('.surface-model');
            })
            .slice(0, 8)
            .map((node) => node.className),
          buttons: [...document.querySelectorAll('.surface-tabs button,.demo-feature-tabs button')]
            .filter((node) => node.getBoundingClientRect().width)
            .map((node) => node.getBoundingClientRect().toJSON()),
          ids: [...document.querySelectorAll('[id]')].map((node) => node.id),
        }));
        assert.ok(
          geometry.scrollWidth <= width,
          `${theme} ${width}: ${JSON.stringify(geometry.overflow)}`,
        );
        assert.equal(new Set(geometry.ids).size, geometry.ids.length);
        for (const box of geometry.buttons)
          assert.ok(
            box.width >= 28 && box.height >= 28 && box.left >= 0 && box.right <= width,
            JSON.stringify(box),
          );
        assert.equal(await page.locator('.static-chapter').count(), 3);
      }
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-site-theme'), 'dark');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.waitForFunction(
      () => document.querySelector('.opening-story').dataset.static === 'true',
    );
    assert.equal(await page.locator('h1').count(), 1);
    assert.deepEqual(errors, []);
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
