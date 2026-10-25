/* [INPUT]: Production website build, local HTTP server and synthetic browser input.
 * [OUTPUT]: Feature/state, surface geometry, theme, motion and responsive acceptance.
 * [POS]: Isolated public-page tests and synthetic browser captures; no host, model or real configuration.
 * [PROTOCOL]: Keep tests/AGENTS.md and website/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { emulateMedia } from './browser-motion.mjs';

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

// The original brand approach keeps its 180svh distance before the guided tour.
async function scrollOpening(page, progress) {
  await page.locator('.opening-story').evaluate((element, value) => {
    scrollTo(0, scrollY + element.getBoundingClientRect().top + innerHeight * 1.8 * value);
  }, progress);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('portfolio demos preserve drafts, preferences and undo without service requests', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
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
    await demo.getByLabel('演示建议方向').selectOption('explore');
    await demo.getByRole('button', { name: /比较展示方式/ }).click();
    await choose('大纲');
    await demo
      .locator('.demo-outline')
      .getByRole('button', { name: /上线前检查/ })
      .click();
    assert.match(await demo.locator('.chat-paragraph.is-focused').innerText(), /上线前检查/);
    assert.ok(await demo.locator('.demo-chat article').evaluate((node) => node.scrollTop > 0));
    await choose('模型切换');
    await demo.getByRole('button', { name: 'GPT-6-Astra · High', exact: true }).click();
    assert.equal(
      await demo
        .getByRole('button', { name: 'GPT-6-Astra · High', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
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
      await page.getByRole('link', { name: '下载，前往 GitHub 发布页面' }).getAttribute('href'),
      'https://github.com/0xTotoroX/palboo/releases',
    );
    assert.equal(await page.locator('a[download]').count(), 0);
  } finally {
    await page.close();
  }
});

test('footer returns to the opening with keyboard focus and keeps demonstration drafts', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 847, height: 988 },
  });
  try {
    await page.goto(base);
    const draft = page.getByLabel('提示词优化演示', { exact: true });
    await draft.fill('保留我的示例草稿');
    const back = page.getByRole('link', { name: '回到顶部', exact: true });
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      await back.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => scrollY > innerHeight));
      if (reducedMotion === 'reduce') {
        await back.focus();
        await page.keyboard.press('Enter');
      } else {
        await back.click();
      }
      await page.waitForFunction(() => scrollY < 1);
      await page.waitForFunction(() => {
        const copy = document.querySelector('.opening-copy');
        return (
          getComputedStyle(copy).visibility === 'visible' && +getComputedStyle(copy).opacity === 1
        );
      });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
      assert.equal(await page.evaluate(() => location.hash), '#main');
      assert.ok(
        await page.getByRole('heading', { level: 1, name: /让对话，\s*多一维度/ }).isVisible(),
      );
      assert.equal(await draft.inputValue(), '保留我的示例草稿');
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(':focus').getAttribute('aria-label'), '重播品牌开场');
    }
  } finally {
    await page.close();
  }
});

test(
  'full original playback includes typing before the eyes land in the left entry',
  { timeout: 60000 },
  async () => {
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 1000 },
    });
    try {
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'));
      await page.goto(base);
      page.setDefaultTimeout(15000);
      const stage = page.locator('.original-opening');
      // Advance the actual animation frames instead of racing a 200ms CI window.
      await page.clock.runFor(560);
      const typing = await stage.evaluate((element) => ({
        time: +element.dataset.time,
        letters: ['p', 'a', 'l'].map((letter) =>
          element.querySelector(`#letter-${letter}`).getAttribute('opacity'),
        ),
      }));
      assert.ok(typing.time > 0.45 && typing.time < 0.65, JSON.stringify(typing));
      assert.deepEqual(typing.letters, ['1', '1', '0']);
      await page.clock.resume();
      await page.getByRole('button', { name: '重播品牌开场' }).click();
      assert.ok(+(await stage.getAttribute('data-time')) < 0.3);
      await page.waitForFunction(
        () => document.querySelector('.original-opening').dataset.time === '6.8000',
      );
      await scrollOpening(page, 1);
      await page.waitForFunction(
        () => document.querySelector('.original-opening').dataset.time === '6.8000',
      );
      const landing = await page.evaluate(() => {
        const svg = document.querySelector('.original-opening svg');
        const point = new DOMPoint(600, 307).matrixTransform(svg.getScreenCTM());
        const target = document.querySelector('.opening-story .demo-entry').getBoundingClientRect();
        return {
          dx: point.x - target.x - target.width / 2,
          dy: point.y - target.y - target.height / 2,
          entry: getComputedStyle(document.querySelector('.opening-story .demo-entry')).opacity,
          artwork: getComputedStyle(document.querySelector('.brand-flight')).opacity,
        };
      });
      assert.ok(Math.abs(landing.dx) < 2 && Math.abs(landing.dy) < 2, JSON.stringify(landing));
      assert.equal(landing.entry, '0');
      assert.equal(landing.artwork, '1', 'the original eyes stay present at the destination');
      await scrollScene(page, '.reading-story', 0.1);
      const demo = page.locator('.product-demo:visible');
      assert.equal(await demo.getAttribute('data-feature'), 'next');
      await demo.getByLabel('接着聊', { exact: true }).fill('滚动时保留的草稿');
      await demo.getByLabel('接着聊', { exact: true }).blur();

      await scrollScene(page, '.reading-story', 0.48);
      await page.locator('.product-demo:visible[data-feature="outline"]').waitFor();
      assert.equal(await demo.getAttribute('data-feature'), 'outline');
      await scrollScene(page, '.reading-story', 0.9);
      await page.locator('.product-demo:visible[data-feature="terms"]').waitFor();
      assert.equal(await demo.getAttribute('data-feature'), 'terms');
      await scrollScene(page, '.reading-story', 0.1);
      await page.locator('.product-demo:visible[data-feature="next"]').waitFor();
      assert.equal(
        await demo.getByLabel('接着聊', { exact: true }).inputValue(),
        '滚动时保留的草稿',
      );
      const box = await demo.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 1000, JSON.stringify(box));
      assert.equal(
        await page
          .locator('main > header, main > nav, .eyebrow, .section-index, .feature-picker')
          .count(),
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

test('the first wheel movement carries the face and clicking it replays from the top', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
  });
  const face = () =>
    page.evaluate(() => {
      const svg = document.querySelector('.original-opening svg');
      const point = new DOMPoint(600, 307).matrixTransform(svg.getScreenCTM());
      return { x: point.x, y: point.y, scroll: scrollY };
    });
  try {
    await page.goto(base);
    const origin = await face();
    await page.mouse.move(1300, 500);
    await page.mouse.wheel(0, 80);
    await page.waitForFunction((x) => {
      const svg = document.querySelector('.original-opening svg');
      return new DOMPoint(600, 307).matrixTransform(svg.getScreenCTM()).x < x - 5;
    }, origin.x);
    const moving = await face();
    assert.ok(moving.scroll > 0 && moving.scroll <= 100, JSON.stringify(moving));
    assert.ok(moving.y > origin.y, 'the face starts descending during the first wheel movement');
    assert.equal(await page.locator('.original-opening').getAttribute('data-time'), '6.8000');
    await page.waitForTimeout(160);
    assert.deepEqual(await face(), moving, 'stopping the wheel holds the face in place');
    await page.mouse.wheel(0, -80);
    await page.waitForFunction(() => scrollY === 0);
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('.brand-flight')).transform ===
        'matrix(1, 0, 0, 1, 0, 0)',
    );
    assert.deepEqual(await face(), origin, 'reverse scrolling returns along the same path');

    for (const input of ['pointer', 'keyboard']) {
      await scrollOpening(page, input === 'pointer' ? 0.9 : 0.4);
      const replay = page.getByRole('button', { name: '重播品牌开场' });
      const box = await replay.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
      if (input === 'pointer') await replay.click();
      else await replay.press('Space');
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.ok(+(await page.locator('.original-opening').getAttribute('data-time')) < 0.3);
    }
    assert.equal(await page.locator('.opening-copy button').count(), 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(
      () => document.querySelector('.original-opening').dataset.time === '6.8000',
    );
    await page.getByRole('button', { name: '重播品牌开场' }).press('Enter');
    assert.equal(await page.locator('.original-opening').getAttribute('data-time'), '6.8000');
  } finally {
    await page.close();
  }
});

test('active editing and local state survive chapter changes, responsive modes and reduced motion', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
  });
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
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(await input.inputValue(), '仍在编辑的任务');
      assert.equal(await input.evaluate((el) => el === document.activeElement), true);
      const box = await input.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, JSON.stringify(box));
    }
    await emulateMedia(page, { reducedMotion: 'reduce' });
    await page.locator('.reading-story[data-static="true"]').waitFor();
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
    await emulateMedia(page, { reducedMotion: 'no-preference' });
    await page.locator('.reading-story[data-static="false"]').waitFor();
    assert.equal(await third.isVisible(), true);
    assert.equal(await third.getByLabel('接着聊', { exact: true }).inputValue(), '术语章节草稿');
    assert.equal(
      await third
        .getByLabel('接着聊', { exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await third.getByLabel('接着聊', { exact: true }).blur();
    await page.locator('.story-copy[data-chapter="outline"] h2').evaluate((heading) => {
      scrollTo({
        top: scrollY + heading.getBoundingClientRect().top - innerHeight * 0.5,
        behavior: 'instant',
      });
    });
    await third.locator('[role="tab"][aria-label="大纲"][aria-selected="true"]').waitFor();
    assert.equal(await third.getAttribute('data-feature'), 'outline');
  } finally {
    await page.close();
  }
});

test('board supports real pointer drag, keyboard actions and creating a local task', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
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

test('original settings journey, layout controls and drafts are reused on the website', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
  });
  try {
    await page.goto(base);
    await scrollOpening(page, 1);
    const demo = page.locator('.surface-story');
    const window = demo.locator('.layout-demo-window');
    const x = () => window.evaluate((el) => el.x.baseVal.value);
    await demo.getByLabel('下一步示例草稿').fill('保留窗口草稿');
    await demo.getByLabel('下一步示例草稿').blur();
    await demo.getByRole('button', { name: '演示移到副屏' }).click();
    const samples = await window.evaluate(async (el) => {
      const result = [];
      for (let i = 0; i < 70; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        result.push(el.x.baseVal.value);
      }
      return result;
    });
    assert.ok(
      samples.some((x) => Math.abs(x - 414) < 2),
      'passes through the original popped position',
    );
    assert.ok(
      samples.some((x) => x > 430 && x < 740),
      'moves continuously to secondary display',
    );
    await page.waitForFunction(
      () => document.querySelector('.surface-story .layout-demo-window').x.baseVal.value === 754,
    );
    assert.equal(await demo.getByLabel('下一步示例草稿').inputValue(), '保留窗口草稿');
    await demo.getByRole('button', { name: '演示页面浮层' }).click();
    await page.waitForFunction(
      () => document.querySelector('.surface-story .layout-demo-window').x.baseVal.value === 402,
    );
    await demo.getByRole('button', { name: '左右', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('.surface-story .layout-demo-window').width.baseVal.value === 400,
    );
    assert.equal(await demo.locator('.csw-feature-panes').getAttribute('data-axis'), 'horizontal');
    await demo.getByRole('button', { name: '标签', exact: true }).click();
    assert.equal(await demo.locator('.csw-workbench-pane').count(), 1);
    await demo.getByRole('tab', { name: '术语', exact: true }).click();
    assert.equal(await demo.getByLabel('术语示例草稿').isVisible(), true);
    await demo.getByRole('tab', { name: '下一步', exact: true }).click();
    assert.equal(await demo.getByLabel('下一步示例草稿').inputValue(), '保留窗口草稿');
    await demo.getByRole('button', { name: '上下', exact: true }).click();
    assert.equal(await demo.locator('.csw-feature-panes').getAttribute('data-axis'), 'vertical');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await demo.getByRole('button', { name: '贴边 / 刘海', exact: true }).click();
    await demo.getByLabel('贴边位置演示').selectOption('top');
    await page.waitForFunction(
      () => document.querySelector('.surface-story .layout-demo-window').y.baseVal.value === 48,
    );
    assert.equal(await window.getAttribute('y'), '48');
    await demo.getByRole('button', { name: '重置预览', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.surface-story .layout-demo-window').x.baseVal.value === 454,
    );
    assert.equal(await x(), 454);
  } finally {
    await page.close();
  }
});

for (const locale of ['zh-CN', 'en-US'])
  test(`opening stays within short desktop viewports and the original eyes clear the copy throughout the flight (${locale})`, async () => {
    const page = await browser.newPage({ locale });
    try {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 900, height: 700 },
        { width: 1280, height: 651 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(base);
        for (const progress of [
          0, 0.03, 0.08, 0.12, 0.14, 0.155, 0.16, 0.25, 0.45, 0.6, 0.8, 0.9, 1, 0.4, 0.08,
        ]) {
          await scrollOpening(page, progress);
          const geometry = await page.evaluate(() => {
            const rect = (selector) =>
              document.querySelector(selector).getBoundingClientRect().toJSON();
            return {
              entry: rect('.opening-story .demo-entry'),
              preview: rect('.intro-preview'),
              device: rect('.opening-story .demo-device'),
              copy: rect('.opening-copy'),
              eyes: [rect('#ring-0'), rect('#ring-1')],
              text: [rect('h1'), rect('.opening-copy p')],
            };
          });
          assert.ok(
            progress < 0.6 ||
              (geometry.preview.bottom <= viewport.height &&
                geometry.entry.bottom <= viewport.height),
            JSON.stringify({ viewport, progress, geometry }),
          );
          assert.ok(
            progress > 0 || geometry.copy.bottom + 8 <= geometry.device.top,
            JSON.stringify({ viewport, geometry }),
          );
          if (progress > 0 && (await page.locator('.opening-copy').isVisible())) {
            for (const eye of geometry.eyes)
              for (const text of geometry.text) {
                assert.ok(
                  eye.right <= text.left ||
                    eye.left >= text.right ||
                    eye.bottom <= text.top ||
                    eye.top >= text.bottom,
                  JSON.stringify({ viewport, progress, eye, text }),
                );
              }
          }
        }
      }
    } finally {
      await page.close();
    }
  });

test('reading changes with the visible heading, releases pointer actions and restores static chapter correspondence', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 720 },
  });
  try {
    await page.goto(base);
    const demo = page.locator('.product-demo:visible');
    for (const feature of ['next', 'outline', 'terms', 'next']) {
      await page.mouse.wheel(0, 1);
      await page
        .locator(`[data-chapter="${feature}"] h2`)
        .evaluate((node) => node.scrollIntoView({ block: 'center' }));
      await page.waitForFunction(
        (value) =>
          document.querySelector('.reading-stage:not([hidden]) .product-demo').dataset.feature ===
          value,
        feature,
      );
      if (feature === 'next') await demo.getByRole('button', { name: /拆解第一版/ }).click();
    }
    await page.mouse.wheel(0, 1);
    await page
      .locator('[data-chapter="terms"] h2')
      .evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await page.waitForFunction(
      () =>
        document.querySelector('.reading-stage:not([hidden]) .product-demo').dataset.feature ===
        'terms',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector('.reading-story').dataset.static === 'true',
    );
    assert.deepEqual(
      await page
        .locator('.static-chapter .product-demo')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.feature)),
      ['next', 'outline', 'terms'],
    );
    const first = page.locator('.product-demo').first();
    await first.getByLabel('接着聊', { exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.notEqual(
      await first
        .getByRole('button', { name: '重置功能演示' })
        .evaluate((node) => node === document.activeElement),
      true,
    );
  } finally {
    await page.close();
  }
});

test('model matrix, quota, presets, material samples and speed states use real product views', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(base);
    const model = page.locator('.tools-section .demo-models');
    await model.getByRole('button', { name: 'GPT-6-Astra · High', exact: true }).click();
    assert.equal(
      await model
        .getByRole('button', { name: 'GPT-6-Astra · High', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await model.getByRole('button', { name: 'Fast', exact: true }).click();
    assert.equal(
      await model.getByRole('button', { name: 'Fast', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    await model.getByRole('button', { name: '添加预设', exact: true }).click();
    assert.match(await model.locator('.model-presets').innerText(), /GPT-6-Astra/);
    assert.match(await model.locator('.model-usage').innerText(), /72/);
    await model.getByRole('button', { name: '所有模型', exact: true }).click();
    assert.equal(await model.locator('.model-picker').isVisible(), true);
    const material = page.locator('.material-story');
    const sample = page.locator('.surface-story [data-material]');
    const backgrounds = new Set();
    for (const [name, id] of [
      ['哑光', 'matte'],
      ['磨砂', 'frosted'],
      ['液态', 'native-glass'],
    ]) {
      await material.getByRole('button', { name, exact: true }).click();
      assert.equal(await sample.getAttribute('data-material'), id);
      backgrounds.add(await sample.evaluate((node) => getComputedStyle(node).backgroundColor));
    }
    assert.equal(backgrounds.size, 3);
    await material.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await sample.getAttribute('data-variant'), 'clear');
    await page.locator('.speed-demo').getByRole('button', { name: '思考中', exact: true }).click();
    assert.match(await page.locator('.speed-readout').innerText(), /思考中/);
    await page.locator('.speed-demo').getByRole('button', { name: '已完成', exact: true }).click();
    assert.match(await page.locator('.token-meter-readout').getAttribute('title'), /官方本轮累计/);
  } finally {
    await page.close();
  }
});

test('pointer takeover releases keyboard chapter lock; static resizing and manual window editing retain focus', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  });
  try {
    await page.goto(base);
    await scrollScene(page, '.reading-story', 0.1);
    const demo = page.locator('.product-demo').first();
    const suggestion = demo.getByRole('button', { name: /拆解第一版/ });
    await suggestion.focus();
    await page.keyboard.press('Enter');
    await suggestion.click();
    await page.mouse.wheel(0, 1);
    await page.locator('.story-copy[data-chapter="terms"] h2').evaluate((heading) => {
      scrollTo(0, scrollY + heading.getBoundingClientRect().top - innerHeight * 0.5);
    });
    await demo
      .getByRole('tab', { name: '术语释义', exact: true })
      .and(page.locator('[aria-selected="true"]'))
      .waitFor();
    assert.equal(await demo.getAttribute('data-feature'), 'terms');
    await demo.getByRole('button', { name: '收藏', exact: true }).click();
    const favorite = demo.getByRole('button', { name: '已收藏', exact: true });
    // Focus/reflow scrolling alone must not replace the control being used.
    await page.locator('.story-copy[data-chapter="outline"] h2').evaluate((heading) => {
      scrollTo(0, scrollY + heading.getBoundingClientRect().top - innerHeight * 0.5);
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await demo.getAttribute('data-feature'), 'terms');
    assert.equal(await favorite.evaluate((el) => el === document.activeElement), true);
    await page.setViewportSize({ width: 550, height: 900 });
    await page.waitForFunction(
      () => document.querySelector('.reading-story').dataset.static === 'true',
    );
    assert.equal(await demo.getAttribute('data-feature'), 'terms');
    assert.equal(await favorite.evaluate((el) => el === document.activeElement), true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(
      () => document.querySelector('.reading-story').dataset.static === 'false',
    );
    assert.equal(await favorite.evaluate((el) => el === document.activeElement), true);
    await page.mouse.wheel(0, 1);
    await page.locator('.story-copy[data-chapter="outline"] h2').evaluate((heading) => {
      scrollTo(0, scrollY + heading.getBoundingClientRect().top - innerHeight * 0.5);
    });
    await demo
      .getByRole('tab', { name: '大纲', exact: true })
      .and(page.locator('[aria-selected="true"]'))
      .waitFor();
    await scrollOpening(page, 1);
    const surface = page.locator('.surface-story');
    await surface.getByRole('button', { name: '演示移到副屏' }).click();
    await surface.getByLabel('下一步示例草稿').fill('继续保留');
    await page.waitForFunction(
      () => document.querySelector('.surface-story .layout-demo-window').x.baseVal.value === 754,
    );
    await surface.getByRole('button', { name: '演示侧栏' }).click();
    assert.equal(await surface.getByLabel('下一步示例草稿').inputValue(), '继续保留');
  } finally {
    await page.close();
  }
});

test('responsive reflow preserves the focused feature before a delayed media-query notification', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  });
  try {
    await page.addInitScript(() => {
      const match = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const media = match(query);
        if (!query.includes('max-width: 760px')) return media;
        const add = media.addEventListener.bind(media);
        const remove = media.removeEventListener.bind(media);
        const listeners = new Map();
        media.addEventListener = (kind, listener, options) => {
          if (kind !== 'change') return add(kind, listener, options);
          const delayed = (event) => setTimeout(() => listener.call(media, event), 120);
          listeners.set(listener, delayed);
          add(kind, delayed, options);
        };
        media.removeEventListener = (kind, listener, options) => {
          remove(kind, listeners.get(listener) || listener, options);
          listeners.delete(listener);
        };
        return media;
      };
    });
    await page.goto(base);
    const demo = page.locator('.product-demo').first();
    await demo.getByRole('tab', { name: '术语释义', exact: true }).click();
    await demo.getByRole('button', { name: '收藏', exact: true }).click();
    const favorite = demo.getByRole('button', { name: '已收藏', exact: true });
    // A responsive reflow can move another chapter into the reading band before
    // matchMedia notifies React. Exercise that event order explicitly.
    await page.evaluate(() => {
      addEventListener(
        'resize',
        () => {
          const heading = document.querySelector('.story-copy[data-chapter="outline"] h2');
          scrollTo(0, scrollY + heading.getBoundingClientRect().top - innerHeight * 0.5);
        },
        { once: true },
      );
    });
    await page.setViewportSize({ width: 550, height: 900 });
    await page.waitForFunction(
      () => document.querySelector('.reading-story').dataset.static === 'true',
    );
    assert.equal(await demo.getAttribute('data-feature'), 'terms');
    assert.equal(await favorite.evaluate((element) => element === document.activeElement), true);
  } finally {
    await page.close();
  }
});

test('light/dark responsive and short screens preserve readable controls without overflow or duplicate ids', async () => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    colorScheme: 'light',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(base);
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-site-theme')) !== theme)
        await page.locator('.site-theme').click();
      await page.waitForFunction(
        (value) => document.documentElement.dataset.siteTheme === value,
        theme,
      );
      for (const width of [360, 550, 900, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          opening: document.querySelector('.intro-preview').getBoundingClientRect().toJSON(),
          openingContents: ['.opening-story .layout-demo-canvas', '.workspace-type-controls'].map(
            (selector) => document.querySelector(selector).getBoundingClientRect().toJSON(),
          ),
          overflow: [...document.querySelectorAll('body *')]
            .filter((node) => {
              const r = node.getBoundingClientRect();
              return r.width && r.right > innerWidth + 1 && !node.closest('.surface-model');
            })
            .slice(0, 8)
            .map((node) => node.className),
          buttons: [
            ...document.querySelectorAll(
              '.preview-selector button,.choice-row button,.demo-feature-tabs button',
            ),
          ]
            .filter((node) => node.getBoundingClientRect().width)
            .map((node) => node.getBoundingClientRect().toJSON()),
          ids: [...document.querySelectorAll('[id]')].map((node) => node.id),
        }));
        assert.ok(
          geometry.scrollWidth <= width,
          `${theme} ${width}: ${JSON.stringify(geometry.overflow)}`,
        );
        assert.equal(new Set(geometry.ids).size, geometry.ids.length);
        for (const box of geometry.openingContents)
          assert.ok(
            box.bottom <= geometry.opening.bottom + 1 &&
              box.right <= geometry.opening.right + 1 &&
              box.left >= geometry.opening.left - 1,
            `${theme} ${width}: opening content clipped ${JSON.stringify({ box, opening: geometry.opening })}`,
          );
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
  const original = await browser.newPage({
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  });
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

test('English website retains demo drafts and choices through language switching and reload', async () => {
  const page = await browser.newPage({
    locale: 'en-US',
    viewport: { width: 1280, height: 960 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(base);
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.match(
      await page.locator('h1').innerText(),
      /Give your conversations\s+another dimension/,
    );
    const demo = page.locator('.product-demo').first();
    await demo.locator('textarea').fill('保留我的输入 / keep my draft');
    const direction = demo.locator('.next-demo-actions select');
    await direction.selectOption('explore');
    await demo.getByRole('button', { name: /Compare presentation/ }).waitFor();
    const draft = await demo.locator('textarea').inputValue();
    for (const locale of ['zh-CN', 'en']) {
      await page.locator('.site-language').click();
      await page.waitForFunction((expected) => document.documentElement.lang === expected, locale);
      assert.equal(await demo.locator('textarea').inputValue(), draft);
      assert.equal(await direction.inputValue(), 'explore');
    }
    for (const width of [390, 742, 1280]) {
      await page.setViewportSize({ width, height: 960 });
      await page.locator('h1').scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: `target/reports/localization/site-opening-en-${width}.png` });
      await page.locator('#install').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `target/reports/localization/site-install-en-${width}.png` });
    }
    await page.reload();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('opening approaches one shared model and reveals working controls without losing local state', async () => {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 828, height: 988 } });
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  try {
    await page.goto(`${base}/?lang=zh-CN`);
    const demo = page.locator('.surface-story');
    const scene = demo.locator('.layout-demo-scene');
    const device = demo.locator('.demo-device').first();
    assert.equal(await page.locator('.surface-story').count(), 1);
    assert.equal(await page.locator('.opening-story .surface-story').count(), 1);
    assert.equal(await demo.evaluate((el) => el.inert), true);
    const overview = await device.boundingBox();
    await scrollOpening(page, 0.4);
    const approaching = await device.boundingBox();
    assert.ok(approaching.width > overview.width);
    await scrollOpening(page, 1);
    const close = await device.boundingBox();
    assert.ok(close.width > overview.width * 1.4);
    assert.equal(await demo.evaluate((el) => el.inert), false);
    const windowNode = await demo.locator('.layout-demo-workspace').elementHandle();
    const draft = demo.getByLabel('下一步示例草稿');
    await draft.fill('Keep this draft / 保留这份草稿');
    const originalFont = await windowNode.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    await demo.getByLabel('演示字号比例').selectOption('125');
    assert.equal(
      await windowNode.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      originalFont * 1.25,
    );
    await demo.getByLabel('演示字号模式').selectOption('custom');
    await demo.getByLabel('演示自定字号').selectOption('24');
    assert.equal(await windowNode.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 24);
    await demo.getByRole('button', { name: '标签', exact: true }).click();
    await demo.getByRole('tab', { name: '下一步', exact: true }).click();
    await page.mouse.move(10, 400);
    await page.mouse.wheel(0, -1600);
    await page.waitForFunction(() => document.querySelector('.surface-story').inert);
    assert.equal(await demo.evaluate((el) => el.inert), true);
    await scrollOpening(page, 1);
    assert.equal(await draft.inputValue(), 'Keep this draft / 保留这份草稿');
    assert.equal(await windowNode.evaluate((el) => el.isConnected), true);
    assert.equal(await demo.locator('.csw-workbench-pane').count(), 1);
    await page.locator('.site-language').click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.match(
      await demo.locator('.layout-demo-content:visible ol').innerText(),
      /Prepare three featured projects/,
    );
    assert.doesNotMatch(await demo.locator('.layout-demo-content:visible ol').innerText(), /整理/);
    assert.equal(
      await demo.getByLabel('Next steps example draft').inputValue(),
      'Keep this draft / 保留这份草稿',
    );
    await page.setViewportSize({ width: 390, height: 988 });
    await scene.scrollIntoViewIfNeeded();
    await demo
      .getByRole('combobox', { name: 'Preview position', exact: true })
      .selectOption('overlay');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const frame = await demo.locator('.layout-demo-window').boundingBox();
    assert.ok(frame.x >= 0 && frame.x + frame.width <= 390, JSON.stringify(frame));
    assert.equal(
      await demo.getByLabel('Next steps example draft').inputValue(),
      'Keep this draft / 保留这份草稿',
    );
    await demo.getByRole('button', { name: 'Reset preview', exact: true }).click();
    assert.equal(await demo.getByLabel('Demo font sizing').inputValue(), 'follow');
    assert.equal(await demo.getByLabel('Demo font scale').inputValue(), '100');
    for (const viewport of [
      { width: 1280, height: 700 },
      { width: 900, height: 651 },
    ]) {
      await page.setViewportSize(viewport);
      await scrollOpening(page, 1);
      await demo.getByRole('button', { name: 'Edge / notch', exact: true }).click();
      const bounds = await page.locator('.intro-preview').boundingBox();
      assert.ok(
        bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
        JSON.stringify({ viewport, bounds }),
      );
    }
    assert.ok(requests.every((url) => url.startsWith(base) && !url.includes('/api/')));
  } finally {
    await page.close();
  }
});

test('website theme toggles directly and remembers the choice without following system changes', async () => {
  const context = await browser.newContext({
    locale: 'zh-CN',
    colorScheme: 'light',
    viewport: { width: 828, height: 988 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const expectTheme = (page, theme) =>
    page.waitForFunction(
      (value) =>
        document.documentElement.dataset.siteTheme === value &&
        document.documentElement.style.colorScheme === value,
      theme,
    );
  try {
    await page.goto(`${base}/?lang=zh-CN`);
    const toggle = page.locator('.site-theme');
    assert.equal(await toggle.getAttribute('aria-label'), '切换为深色');
    await expectTheme(page, 'light');
    await scrollOpening(page, 1);
    const draft = page.locator('.surface-story').getByLabel('下一步示例草稿');
    await draft.fill('主题切换保留草稿');
    await draft.blur();
    await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    await expectTheme(page, 'dark');
    assert.equal(await draft.inputValue(), '主题切换保留草稿');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'dark');
    await page.reload();
    await expectTheme(page, 'dark');
    await page.getByRole('button', { name: '切换为浅色', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'light');
    const other = await context.newPage();
    await other.goto(`${base}/?lang=en`);
    await expectTheme(other, 'light');
    const otherToggle = other.getByRole('button', { name: 'Switch to dark mode', exact: true });
    assert.equal(await otherToggle.isVisible(), true);
    await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    await expectTheme(other, 'dark');
    assert.equal(
      await other.getByRole('button', { name: 'Switch to light mode', exact: true }).isVisible(),
      true,
    );
    await other.close();
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('Storage unavailable');
      };
      Storage.prototype.setItem = () => {
        throw new Error('Storage unavailable');
      };
    });
    await page.reload();
    await expectTheme(page, 'light');
    await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    await expectTheme(page, 'dark');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('layout flows into materials through one reversible workspace and keeps edits and focus', async () => {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const errors = [],
    requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  try {
    await page.goto(base);
    await scrollOpening(page, 1);
    const demo = page.locator('.surface-story');
    const workspace = await demo.locator('.layout-demo-workspace').elementHandle();
    const draft = demo.getByLabel('下一步示例草稿');
    const input = await draft.elementHandle();
    await demo.getByRole('button', { name: '标签', exact: true }).click();
    await demo.getByRole('tab', { name: '下一步', exact: true }).click();
    await draft.fill('同一份草稿 / One workspace');
    await draft.blur();
    const frame = demo.locator('.layout-demo-window');
    const original = await frame.boundingBox();
    const widths = [];
    for (const progress of [0.64, 0.66, 0.68, 0.7, 0.75]) {
      await scrollScene(page, '.opening-story', progress);
      widths.push((await frame.boundingBox()).width);
      assert.equal(await demo.locator('.layout-demo-workspace').count(), 1);
      assert.equal(
        await workspace.evaluate(
          (el) => el === document.querySelector('.surface-story .layout-demo-workspace'),
        ),
        true,
      );
      assert.equal(await input.evaluate((el) => el.isConnected), true);
      assert.equal(await draft.inputValue(), '同一份草稿 / One workspace');
      assert.equal(await demo.locator('.csw-workbench-pane').count(), 1);
    }
    assert.ok(widths.at(-1) > original.width * 1.5, JSON.stringify(widths));
    assert.ok(widths.every((width, index) => !index || width >= widths[index - 1] - 1));
    const materials = demo.locator('.material-story');
    assert.equal(await materials.evaluate((el) => getComputedStyle(el).opacity), '1');
    await materials.getByRole('button', { name: '磨砂', exact: true }).click();
    assert.equal(await workspace.getAttribute('data-material'), 'frosted');
    await materials.getByRole('button', { name: '液态', exact: true }).click();
    await materials.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await workspace.getAttribute('data-variant'), 'clear');
    await page.evaluate(() => document.activeElement.blur());
    await scrollOpening(page, 1);
    const returned = await frame.boundingBox();
    assert.ok(
      Math.abs(original.x - returned.x) < 1 && Math.abs(original.width - returned.width) < 1,
    );
    assert.equal(await draft.inputValue(), '同一份草稿 / One workspace');
    await demo.getByLabel('演示字号比例').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '哑光');
    assert.equal(await materials.evaluate((el) => getComputedStyle(el).opacity), '1');
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
      '演示字号比例',
    );
    assert.equal(
      await demo.locator('.workspace-controls').evaluate((el) => getComputedStyle(el).opacity),
      '1',
    );
    await page.evaluate(() => document.activeElement.blur());
    await page.locator('.site-language').click();
    for (const viewport of [
      { width: 900, height: 651 },
      { width: 1280, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await scrollScene(page, '.opening-story', 0.9);
      const box = await page.locator('.intro-preview').boundingBox();
      assert.ok(
        box.y >= 0 && box.y + box.height <= viewport.height + 1,
        JSON.stringify({ viewport, box }),
      );
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector('.opening-story').dataset.static === 'true',
    );
    await materials.getByRole('button', { name: 'Frosted', exact: true }).click();
    assert.equal(await demo.locator('.layout-demo-workspace').count(), 1);
    assert.equal(await input.evaluate((el) => el.isConnected), true);
    assert.equal(
      await demo.getByLabel('Next steps example draft').inputValue(),
      '同一份草稿 / One workspace',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
    assert.ok(requests.every((url) => url.startsWith(base) && !url.includes('/api/')));
  } finally {
    await page.close();
  }
});

test('native scrolling visits every feature, arrangement, placement and material in one workspace', async () => {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const errors = [],
    requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  try {
    await page.goto(base);
    const workspace = await page.locator('.surface-story .layout-demo-workspace').elementHandle();
    const visited = {
      placements: new Set(),
      arrangements: new Set(),
      features: new Set(),
      edges: new Set(),
      materials: new Set(),
    };
    for (let progress = 0.14; progress < 1; progress += 0.02) {
      await scrollScene(page, '.opening-story', progress);
      const state = await page.locator('.surface-story').evaluate((el) => {
        const workspace = el.querySelector('.layout-demo-workspace');
        return {
          placement: el.querySelector('[data-demo-placement]').dataset.demoPlacement,
          arrangement: el.querySelector('[aria-label="演示排列"] [aria-pressed="true"]')
            .textContent,
          features: [...el.querySelectorAll('[role="tab"][aria-selected="true"]')].map((tab) =>
            tab.getAttribute('aria-label'),
          ),
          edge: el.querySelector('.workspace-edge-select')?.value,
          material:
            el.dataset.materialStage === 'true'
              ? `${workspace.dataset.material}/${workspace.dataset.variant}`
              : null,
        };
      });
      visited.placements.add(state.placement);
      visited.arrangements.add(state.arrangement);
      state.features.forEach((name) => visited.features.add(name));
      if (state.edge) visited.edges.add(state.edge);
      if (state.material) visited.materials.add(state.material);
      assert.equal(
        await workspace.evaluate(
          (node) => node === document.querySelector('.surface-story .layout-demo-workspace'),
        ),
        true,
      );
    }
    assert.deepEqual(visited.placements, new Set(['sidebar', 'overlay', 'desktop', 'edge']));
    assert.deepEqual(visited.arrangements, new Set(['上下', '左右', '标签']));
    assert.deepEqual(
      visited.features,
      new Set(['下一步', '大纲', '术语', 'Grok Bot', '模型切换', '看板']),
    );
    assert.deepEqual(visited.edges, new Set(['right', 'left', 'top', 'bottom']));
    assert.deepEqual(
      visited.materials,
      new Set([
        'matte/regular',
        'frosted/regular',
        'native-glass/regular',
        'native-glass/clear',
        'black/regular',
      ]),
    );
    await scrollScene(page, '.opening-story', 0.22);
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="演示排列"] [aria-pressed="true"]').textContent ===
        '左右',
    );
    assert.equal(await page.locator('.surface-story').getAttribute('data-material-stage'), 'false');
    assert.equal(await page.locator('.surface-story .csw-workbench-pane').count(), 2);
    assert.equal(await page.locator('html').getAttribute('data-site-theme'), 'light');
    assert.deepEqual(errors, []);
    assert.ok(requests.every((url) => url.startsWith(base) && !url.includes('/api/')));
  } finally {
    await page.close();
  }
});

test('scroll-led tool demonstrations show task progress, models, speed, optimization and Bot consultation', async () => {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(base);
    for (const [index, progress] of [0.05, 0.4, 0.85].entries()) {
      await scrollScene(page, '.board-story', progress);
      await page.waitForFunction(
        (index) =>
          document
            .querySelectorAll('.board-story .board-lane')
            [index].textContent.includes('整理三个代表作品'),
        index,
      );
    }
    const model = page.locator('.model-tour');
    for (const [progress, name, fast] of [
      [0.05, 'GPT-6.1-Sol · Low', false],
      [0.4, 'GPT-6-Astra · High', false],
      [0.85, 'GPT-6-Astra · High', true],
    ]) {
      await scrollScene(page, '.model-tour', progress);
      await page.waitForFunction(
        ({ name, fast }) => {
          const el = document.querySelector('.model-tour');
          return (
            el.querySelector(`button[aria-label="${name}"]`)?.getAttribute('aria-pressed') ===
              'true' &&
            el.querySelector('.model-fast')?.getAttribute('aria-pressed') === String(fast)
          );
        },
        { name, fast },
      );
    }
    assert.match(await model.innerText(), /72%/);
    for (const [progress, name] of [
      [0.05, '等待输出'],
      [0.35, '思考中'],
      [0.6, '生成中'],
      [0.9, '已完成'],
    ]) {
      await scrollScene(page, '.speed-tour', progress);
      await page.waitForFunction(
        (name) => document.querySelector('.speed-tour [aria-pressed="true"]').textContent === name,
        name,
      );
    }
    const prompt = page.getByLabel('提示词优化演示', { exact: true });
    await scrollScene(page, '.prompt-tour', 0.05);
    assert.equal(await prompt.inputValue(), '帮我把这个作品集方案安排一下');
    await scrollScene(page, '.prompt-tour', 0.85);
    await page.waitForFunction(() =>
      document.querySelector('.prompt-tour textarea').value.includes('交付内容与检查方法'),
    );
    assert.equal(
      await page
        .locator('.prompt-tour')
        .getByRole('button', { name: '撤销', exact: true })
        .isVisible(),
      true,
    );
    for (const [progress, name] of [
      [0.05, '工程主管'],
      [0.4, '资料助手'],
      [0.85, '随口一问'],
    ]) {
      await scrollScene(page, '.bot-tour', progress);
      await page.waitForFunction(
        (name) =>
          document.querySelector('.bot-tour [aria-pressed="true"]').textContent.trim() === name,
        name,
      );
      assert.match(await page.getByLabel('Bot 咨询草稿').inputValue(), new RegExp(name));
    }
    await scrollScene(page, '.model-tour', 0.05);
    assert.equal(
      await model
        .getByRole('button', { name: 'GPT-6.1-Sol · Low', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
  } finally {
    await page.close();
  }
});

test('scroll tours yield to editing and manual choices, preserve drafts and release short screens', async () => {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(base);
    await scrollOpening(page, 1);
    const demo = page.locator('.surface-story');
    const draft = demo.getByLabel('下一步示例草稿');
    await draft.fill('保留这份布局草稿');
    await page.mouse.wheel(0, 400);
    await scrollScene(page, '.opening-story', 0.45);
    assert.equal(
      await demo.locator('[data-demo-placement]').getAttribute('data-demo-placement'),
      'sidebar',
    );
    assert.equal(await draft.inputValue(), '保留这份布局草稿');
    assert.equal(await draft.evaluate((el) => el === document.activeElement), true);
    await draft.blur();
    await page.mouse.move(20, 20);
    await page.mouse.wheel(0, 1);
    await page.waitForFunction(
      () =>
        document.querySelector('.surface-story [data-demo-placement]').dataset.demoPlacement ===
        'edge',
    );
    await scrollOpening(page, 1);
    assert.equal(await draft.inputValue(), '保留这份布局草稿');

    const speed = page.locator('.speed-tour');
    await scrollScene(page, '.speed-tour', 0.05);
    await speed.getByRole('button', { name: '思考中', exact: true }).click();
    await scrollScene(page, '.speed-tour', 0.9);
    assert.equal(await speed.locator('[aria-pressed="true"]').innerText(), '思考中');
    await page.mouse.move(20, 20);
    await page.mouse.wheel(0, 1);
    await page.waitForFunction(
      () => document.querySelector('.speed-tour [aria-pressed="true"]').textContent === '已完成',
    );

    await scrollScene(page, '.bot-tour', 0.4);
    const botDraft = page.getByLabel('Bot 咨询草稿');
    const original = await botDraft.inputValue();
    await botDraft.focus();
    assert.equal(await botDraft.inputValue(), original);
    await botDraft.fill('我自己的咨询');
    await scrollScene(page, '.bot-tour', 0.85);
    assert.equal(await botDraft.inputValue(), '我自己的咨询');
    await botDraft.blur();
    await page.mouse.move(20, 20);
    await page.mouse.wheel(0, 1);
    await page.waitForFunction(
      () =>
        document.querySelector('.bot-tour [aria-pressed="true"]').textContent.trim() === '随口一问',
    );
    assert.equal(await botDraft.inputValue(), '我自己的咨询');

    for (const viewport of [
      { width: 780, height: 620 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator('.board-story').scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => document.querySelector('.board-story').dataset.static === 'true',
      );
      assert.equal(
        await page
          .locator('.board-story .scroll-demo-pin')
          .evaluate((el) => getComputedStyle(el).position),
        'static',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.scroll-demo')].every((el) => el.dataset.static === 'true'),
    );
    await speed.getByRole('button', { name: '生成中', exact: true }).click();
    await page.mouse.wheel(0, 300);
    assert.equal(await speed.locator('[aria-pressed="true"]').innerText(), '生成中');
    assert.equal(await botDraft.inputValue(), '我自己的咨询');
  } finally {
    await page.close();
  }
});
