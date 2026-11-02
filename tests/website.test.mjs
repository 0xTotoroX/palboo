/* [INPUT]: Production website build, local HTTP server and synthetic browser input.
 * [OUTPUT]: Feature/state, surface geometry, theme, motion and responsive acceptance.
 * [POS]: Isolated public-page tests and synthetic browser captures; no host, model or real configuration.
 * [PROTOCOL]: Keep tests/AGENTS.md and website/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { emulateMedia } from './browser-motion.mjs';
import { resolve } from 'node:path';

const reports = resolve('target/reports/site-combined');
const output = resolve(reports, 'test-site');
const pageChecks = [];
let server;
let browser;
let base;
test.before(async () => {
  await mkdir(reports, { recursive: true });
  await build({
    configFile: 'ui/website/vite.config.ts',
    logLevel: 'error',
    build: { outDir: output },
  });
  server = await preview({
    configFile: 'ui/website/vite.config.ts',
    logLevel: 'error',
    build: { outDir: output },
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

// 保留原品牌靠近阶段的180svh距离；后续只手动操作布局和材质。
async function scrollOpening(page, progress) {
  await page.locator('.opening-story').evaluate((element, value) => {
    scrollTo(0, scrollY + element.getBoundingClientRect().top + innerHeight * 1.8 * value);
  }, progress);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

// 所有页面只允许本次构建的静态资源；错误或越界请求不能随页面关闭丢失。
async function checkedPage(page) {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  const check = { errors: [], requests: [] };
  pageChecks.push(check);
  page.on('pageerror', (error) => check.errors.push(error.message));
  page.on('websocket', (socket) => check.requests.push(socket.url()));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (
      (url.startsWith(`${base}/`) &&
        !new URL(url).pathname.startsWith('/api/') &&
        !['fetch', 'xhr', 'eventsource', 'websocket'].includes(route.request().resourceType())) ||
      url.startsWith('data:')
    )
      return route.continue();
    check.requests.push(url);
    return route.abort();
  });
  return page;
}
async function newPage(options = {}) {
  return checkedPage(await browser.newPage(options));
}
test.afterEach(() => {
  const checks = pageChecks.splice(0);
  assert.deepEqual(
    checks.flatMap((check) => check.errors),
    [],
    'no browser errors',
  );
  assert.deepEqual(
    checks.flatMap((check) => check.requests),
    [],
    'no host, API or external requests',
  );
});
async function frames(page) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}
async function waitValue(locator, value) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if ((await locator.inputValue()) === value) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.equal(await locator.inputValue(), value);
}
async function focused(locator) {
  return locator.evaluate((node) => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active === node;
  });
}
const sceneSelectors = ['.reader-window', '.writing-window', '.coordination-window'];
async function enterScene(page, selector) {
  await page
    .locator(selector)
    .evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
}
async function frozenPage(options = {}) {
  const page = await newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'));
  await page.goto(base);
  await page.clock.runFor(80);
  return page;
}

test('reading workspace combines suggestions, outline and terms while preserving its local draft', async () => {
  const page = await newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(base);
    const reader = page.locator('.reader-window');
    const draft = reader.getByLabel('阅读示例草稿', { exact: true });
    await draft.fill('我的草稿');
    await reader.getByRole('button', { name: /拆解第一版/ }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('.reader-window textarea')
        .value.startsWith('我的草稿\n请把作品集第一版'),
    );
    const filled = await draft.inputValue();
    await reader
      .locator('.scene-feature-next .scene-feature-head')
      .getByRole('button', { name: '重新生成建议', exact: true })
      .click();
    await reader.getByRole('button', { name: /比较展示方式/ }).click();
    await page.waitForFunction(
      (value) => document.querySelector('.reader-window textarea').value.startsWith(value + '\n'),
      filled,
    );
    assert.ok((await draft.inputValue()).startsWith(filled + '\n'));
    await reader.locator('.csw-outline-row').filter({ hasText: '上线前检查' }).click();
    await page.waitForFunction(() =>
      document.querySelector('.reader-article .is-current')?.textContent.includes('上线前检查'),
    );
    assert.match(await reader.locator('.reader-article .is-current').innerText(), /上线前检查/);
    await reader.getByRole('button', { name: '定位到本轮开头', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.reader-article .is-current')?.textContent.includes('确定作品集内容'),
    );
    await reader.getByRole('button', { name: '定位到本轮结尾', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.querySelector('.reader-article .is-current')?.textContent.includes('上线前检查'),
    );
    await reader
      .locator('.scene-feature-outline .scene-feature-head')
      .getByRole('button', { name: '刷新大纲', exact: true })
      .click();
    await page.waitForFunction(() => document.querySelector('.reader-article').scrollTop > 0);
    const terms = reader.locator('.term-brick');
    await terms.first().click();
    await page.getByRole('button', { name: '收藏术语', exact: true }).click();
    await page.getByRole('button', { name: '已掌握，不再提示', exact: true }).click();
    await page.keyboard.press('Escape');
    await terms.first().click();
    assert.equal(
      await page
        .getByRole('button', { name: '取消收藏', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page
        .getByRole('button', { name: '恢复提示', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.ok((await draft.inputValue()).startsWith(filled));
    assert.equal(await reader.locator('[data-real-feature="next"]').count(), 1);
    assert.equal(await reader.locator('[data-real-feature="outline"]').count(), 1);
    assert.equal(await reader.locator('[data-real-feature="terms"]').count(), 1);
  } finally {
    await page.close();
  }
});
test('footer returns to the opening with keyboard focus and keeps demonstration drafts', async () => {
  const page = await newPage({
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
    const page = await newPage({
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
      // Scroll events and React commits can follow the animation frame on a busy runner.
      await page.waitForFunction(() => {
        const svg = document.querySelector('.original-opening svg');
        const point = new DOMPoint(600, 307).matrixTransform(svg.getScreenCTM());
        const target = document.querySelector('.opening-story .demo-entry').getBoundingClientRect();
        return (
          Math.abs(point.x - target.x - target.width / 2) < 2 &&
          Math.abs(point.y - target.y - target.height / 2) < 2
        );
      });
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
      assert.equal(await page.locator('.combined-scene').count(), 3);
    } finally {
      await page.close();
    }
  },
);
test('the first wheel movement carries the face and clicking it replays from the top', async () => {
  const page = await newPage({
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

test('board supports real pointer drag, keyboard actions and creating a local task', async () => {
  const page = await newPage({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(base);
    const board = page.locator('.coordination-window .scene-feature-board');
    const lanes = board.locator('.board-column');
    const card = board.locator('.task-card').filter({ hasText: '整理三个代表作品' });
    await card.dragTo(lanes.nth(1));
    assert.equal(await lanes.nth(1).locator('.task-card').count(), 3);
    await board.getByRole('button', { name: '任务详情：整理三个代表作品', exact: true }).focus();
    await page.keyboard.press('Enter');
    await board.getByRole('textbox', { name: '标题', exact: true }).fill('整理三个代表作品与截图');
    await board.getByRole('button', { name: '保存', exact: true }).click();
    await board
      .getByRole('button', { name: '任务详情：整理三个代表作品与截图', exact: true })
      .waitFor();
    await lanes.nth(0).getByRole('button', { name: '新建任务', exact: true }).click();
    await board.getByLabel('新任务标题').fill('给作品配上介绍');
    await page.keyboard.press('Enter');
    await lanes
      .nth(0)
      .getByRole('button', { name: '任务详情：给作品配上介绍', exact: true })
      .waitFor();
    await lanes.nth(0).getByRole('button', { name: '新建任务', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await board.getByLabel('新任务标题').count(), 0);
    const remove = board.getByRole('button', { name: '删除任务：给作品配上介绍', exact: true });
    await board.locator('.task-card').filter({ hasText: '给作品配上介绍' }).hover();
    await remove.click();
    await page.waitForFunction(() => {
      const root = document.querySelector(
        '.coordination-window [data-real-feature="board"]',
      ).shadowRoot;
      return !root.textContent.includes('给作品配上介绍');
    });
  } finally {
    await page.close();
  }
});
test('original settings journey, layout controls and drafts are reused on the website', async () => {
  const page = await newPage({
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
    assert.equal(await demo.locator('.term-brick').first().isVisible(), true);
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
    const page = await newPage({ locale });
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

test('writing workspace uses real model choices, presets, quota and inline speed; materials remain manual', async () => {
  const page = await newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(base);
    const model = page.locator('.writing-window .scene-feature-model');
    await model
      .locator('.model-matrix')
      .getByRole('button', { name: 'GPT-6-Astra · High', exact: true })
      .click();
    assert.equal(
      await model
        .locator('.model-matrix')
        .getByRole('button', { name: 'GPT-6-Astra · High', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await model.getByRole('button', { name: 'Fast', exact: true }).click();
    assert.equal(
      await model.getByRole('button', { name: 'Fast', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    await model
      .locator('.model-matrix')
      .getByRole('button', { name: 'GPT-6-Astra · Medium', exact: true })
      .click();
    assert.equal(
      await model.getByRole('button', { name: 'Fast', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await model
        .locator('.model-presets')
        .getByRole('button', { name: /^GPT-6-Astra · High(?: · Fast)?$/ })
        .count(),
      2,
    );
    await model.getByRole('button', { name: '添加预设', exact: true }).click();
    assert.match(await model.locator('.model-presets').innerText(), /GPT-6-Astra/);
    assert.match(await model.locator('.model-usage').innerText(), /72/);
    await model.getByRole('button', { name: '所有模型', exact: true }).click();
    assert.equal(await model.locator('.model-picker').isVisible(), true);
    assert.equal(await model.locator('.model-tile').count(), 9);
    assert.equal(await model.locator('.model-group').count(), 5);
    await model.getByRole('button', { name: '关闭所有模型', exact: true }).click();
    assert.match(
      await model.locator('.token-meter-readout').innerText(),
      /38\.4 tok\/s[\s\S]*上次测速/,
    );
    await model.getByRole('button', { name: 'Qwen3 Coder Plus · 选择', exact: true }).click();
    assert.equal(await model.getByRole('button', { name: 'Fast', exact: true }).isEnabled(), false);
    assert.equal(await page.getByRole('group', { name: '模型示例范围' }).count(), 0);
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
    assert.equal(await page.locator('.speed-tour').count(), 0);
  } finally {
    await page.close();
  }
});
test('light/dark responsive and short screens preserve readable controls without overflow or duplicate ids', async () => {
  const page = await newPage({
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
        // Responsive scene state is applied on the next animation frame after resize.
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const geometry = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          reader: [...document.querySelectorAll('.reader-article')].map((node) => ({
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
          })),
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
            .map((node) => `${node.tagName}.${node.getAttribute('class') || ''}`),
          buttons: [
            ...document.querySelectorAll(
              '.preview-selector button,.choice-row button,.scene-feature-head button',
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
        assert.equal(geometry.reader.length, 1);
        for (const reader of geometry.reader)
          assert.ok(
            reader.scrollWidth <= reader.clientWidth + 1,
            `${theme} ${width}: reader article horizontal overflow ${JSON.stringify(reader)}`,
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
        assert.equal(await page.locator('.combined-scene').count(), 3);
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
  const original = await newPage({
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  });
  const embedded = await newPage();
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

test('opening approaches one shared model and reveals working controls without losing local state', async () => {
  const page = await newPage({ locale: 'zh-CN', viewport: { width: 828, height: 988 } });
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
      await demo.locator('.layout-demo-content:visible .csw-list').innerText(),
      /Break down the first version/,
    );
    assert.doesNotMatch(
      await demo.locator('.layout-demo-content:visible .csw-list').innerText(),
      /整理/,
    );
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
  const page = await checkedPage(await context.newPage());
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
    const other = await checkedPage(await context.newPage());
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
  const page = await newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
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
    for (const progress of [0.72, 0.78, 0.84, 0.9, 0.95]) {
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

test('completed brand follows the mouse without changing poses, replay or scroll handoff', async () => {
  const page = await newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(base);
    const stage = page.locator('.original-opening');
    await page.mouse.move(1300, 400);
    assert.equal(await stage.getAttribute('data-gaze'), null);
    await page.waitForFunction(
      () => document.querySelector('.original-opening').dataset.time === '6.8000',
    );
    const authoredEyes = () =>
      stage
        .locator('#eyes > *')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform')));
    const poses = await authoredEyes();
    await page.mouse.move(1400, 950);
    await page.waitForFunction(() => {
      const gaze = document.querySelector('.original-opening').dataset.gaze?.split(',').map(Number);
      return gaze?.[0] > 20 && gaze?.[1] > 10;
    });
    await page.mouse.move(10, 10);
    await page.waitForFunction(
      () => Number(document.querySelector('.original-opening').dataset.gaze?.split(',')[0]) < -20,
    );
    const gaze = (await stage.getAttribute('data-gaze')).split(',').map(Number);
    assert.ok(Math.abs(gaze[0]) <= 28 && Math.abs(gaze[1]) <= 18);
    assert.deepEqual(await authoredEyes(), poses);
    await page.getByRole('button', { name: '重播品牌开场' }).click();
    assert.equal(await stage.getAttribute('data-gaze'), null);
    assert.ok(Number(await stage.getAttribute('data-time')) < 0.3);
    await page.mouse.move(1400, 950);
    assert.equal(await stage.getAttribute('data-gaze'), null);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(
      () => scrollY > 0 && document.querySelector('.original-opening').dataset.time === '6.8000',
    );
    await page.mouse.move(5, 5);
    assert.equal(await stage.getAttribute('data-gaze'), null);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '重播品牌开场' }).click();
    await page.mouse.move(1400, 950);
    assert.equal(await stage.getAttribute('data-gaze'), null);
    assert.equal(await stage.getAttribute('data-time'), '6.8000');
  } finally {
    await page.close();
  }
});

for (const locale of ['zh-CN', 'en']) {
  test(`writing shares one draft across phrases, optimization, restore and model choices (${locale})`, async () => {
    const page = await newPage({
      locale,
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    try {
      await page.goto(`${base}/?lang=${locale}`);
      const writing = page.locator('.writing-window');
      const phrases = writing.locator('.scene-feature-prompts');
      const draft = writing.getByRole('textbox');
      const label = locale === 'en' ? 'Review the plan' : '检查方案';
      const phrase = phrases.getByRole('button', { name: label, exact: true });
      const full = await phrase.locator('.csw-quick-text').textContent();
      const optimize = () =>
        writing.getByRole('button', {
          name: locale === 'en' ? 'Refine prompt' : '优化提示词',
          exact: true,
        });
      const restore = () =>
        writing.getByRole('button', {
          name: locale === 'en' ? 'Restore original prompt' : '恢复原提示词',
          exact: true,
        });
      await draft.fill('Existing draft / 我的草稿');
      await phrases
        .getByRole('button', { name: locale === 'en' ? 'Show full text' : '展开全文', exact: true })
        .click();
      assert.equal(
        await draft.inputValue(),
        'Existing draft / 我的草稿',
        'expanding is not insertion',
      );
      await phrase.click();
      const combined = 'Existing draft / 我的草稿\n' + full;
      await waitValue(draft, combined);
      const names = phrases.getByRole('button', {
        name: locale === 'en' ? 'Show names only' : '仅显示名称',
        exact: true,
      });
      await names.click();
      assert.equal(await phrase.textContent(), label);
      assert.equal(await draft.inputValue(), combined);
      await optimize().click();
      await restore().waitFor();
      const optimized = await draft.inputValue();
      assert.ok(optimized.startsWith(combined));
      assert.notEqual(optimized, combined);
      await writing
        .locator('.model-matrix')
        .getByRole('button', { name: 'GPT-6-Astra · High', exact: true })
        .click();
      assert.equal(
        await draft.inputValue(),
        optimized,
        'model change preserves the optimized shared draft',
      );
      await restore().click();
      await waitValue(draft, combined);
      await draft.fill('');
      await phrase.click();
      await waitValue(draft, full);
      await names.click();
      assert.equal(await phrase.locator('.csw-quick-text').textContent(), full);
      await page.locator('.site-language').click();
      assert.equal(
        await draft.inputValue(),
        full,
        'translated samples must not translate visitor content',
      );
      await page.setViewportSize({ width: 360, height: 760 });
      await frames(page);
      assert.equal(await writing.getByRole('textbox').count(), 1);
      assert.equal(await draft.inputValue(), full);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    } finally {
      await page.close();
    }
  });
}

test('cancelled or superseded prompt optimization never replaces the shared visitor draft', async () => {
  const page = await frozenPage({ reducedMotion: 'reduce' });
  try {
    const writing = page.locator('.writing-window');
    const draft = writing.getByRole('textbox');
    const optimize = writing.getByRole('button', { name: '优化提示词', exact: true });
    await draft.fill('开始优化的草稿');
    await optimize.click();
    await writing.getByRole('button', { name: '取消优化', exact: true }).click();
    await page.clock.runFor(600);
    assert.equal(await draft.inputValue(), '开始优化的草稿');
    await optimize.click();
    await draft.fill('请求期间新写的内容');
    await page.clock.runFor(600);
    assert.equal(await draft.inputValue(), '请求期间新写的内容');
    assert.equal(
      await writing.getByRole('button', { name: '恢复原提示词', exact: true }).count(),
      0,
    );
    await writing
      .locator('.scene-feature-prompts')
      .getByRole('button', { name: '继续', exact: true })
      .click();
    await page.clock.runFor(500);
    await waitValue(draft, '请求期间新写的内容\n继续完成剩余步骤。');
  } finally {
    await page.close();
  }
});

test('compact collaboration keeps real Bot actions and recent messages in its shared header', async () => {
  const page = await newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(base);
    const scene = page.locator('.coordination-window');
    const bots = scene.locator('.scene-feature-bots');
    const draft = scene.getByLabel('Bot 咨询草稿');
    await draft.fill('我的协作草稿');
    assert.equal(await bots.locator('.palboo-bot-avatar').count(), 3);
    assert.equal(await bots.getByRole('group', { name: '工程主管', exact: true }).count(), 1);
    assert.equal(await bots.getByRole('group', { name: '资料助手', exact: true }).count(), 1);
    assert.equal(await bots.getByRole('group', { name: '随口一问', exact: true }).count(), 1);
    assert.equal(
      await bots
        .locator('.palboo-bot-avatar')
        .evaluateAll((nodes) =>
          nodes.every((node) => node.querySelectorAll('.palboo-bot-badge').length <= 1),
        ),
      true,
    );
    const lead = bots.getByRole('group', { name: '工程主管', exact: true });
    await lead.scrollIntoViewIfNeeded();
    await page.mouse.move(5, 5);
    assert.equal(
      await lead.getByRole('button', { name: '查看进度', exact: true }).isVisible(),
      false,
    );
    await lead.hover();
    await lead.getByRole('button', { name: '查看进度', exact: true }).click();
    assert.match(await draft.inputValue(), /^我的协作草稿\n查看「工程主管」的进度/);
    const before = await draft.inputValue();
    const header = bots.locator('.scene-feature-head');
    await header.getByRole('button', { name: '最近消息', exact: true }).click();
    assert.match(await bots.locator('.palboo-bot-messages').innerText(), /三个代表作品/);
    await header.getByRole('button', { name: '返回 Bot 列表', exact: true }).click();
    assert.equal(await bots.locator('.palboo-bot-messages').count(), 0);
    assert.equal(await draft.inputValue(), before);
    await bots.getByRole('button', { name: '资料助手', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.match(await draft.inputValue(), /请问「资料助手」/);
    assert.equal(await page.locator('.reader-window textarea').inputValue(), '');
    assert.equal(await bots.getByRole('group', { name: 'Bot 排布演示' }).count(), 0);
  } finally {
    await page.close();
  }
});

for (const width of [1440, 390]) {
  for (const selector of sceneSelectors) {
    test(`combined scene plays once on entry and does not restart on return (${selector}, ${width}px)`, async () => {
      const page = await newPage({ locale: 'zh-CN', viewport: { width, height: 1000 } });
      try {
        await page.goto(base);
        const scene = page.locator(selector);
        await enterScene(page, selector);
        await page.waitForFunction(
          (selector) => document.querySelector(selector).dataset.step === '0',
          selector,
          { polling: 25 },
        );
        assert.equal(await scene.getAttribute('data-step'), '0');
        await page.waitForFunction(
          (selector) => document.querySelector(selector).dataset.step === '1',
          selector,
          { polling: 25 },
        );
        assert.equal(await scene.getAttribute('data-step'), '1');
        if (selector === '.reader-window')
          assert.match(
            await scene.locator('.reader-article .is-current').innerText(),
            /安排页面与布局/,
          );
        if (selector === '.writing-window') {
          await page.waitForFunction(() =>
            document.querySelector('.writing-window textarea').value.includes('检查这份作品集方案'),
          );
          assert.match(
            await scene.getByRole('textbox').inputValue(),
            /^帮我把这个作品集方案安排一下\n检查这份作品集方案/,
          );
        }
        if (selector === '.coordination-window')
          assert.match(await scene.locator('.board-column').nth(1).innerText(), /整理三个代表作品/);
        if (selector === '.coordination-window') {
          const eyes = scene
            .getByRole('group', { name: '工程主管', exact: true })
            .locator('.palboo-bot-eye');
          const motions = await eyes.evaluateAll((nodes) =>
            nodes.map((node) => ({
              name: getComputedStyle(node).animationName,
              start: node.getAnimations()[0]?.startTime,
              duration: node.getAnimations()[0]?.effect.getTiming().duration,
            })),
          );
          assert.equal(motions.length, 2);
          assert.equal(motions[0].name, 'palboo-bot-think');
          assert.deepEqual(motions[0], motions[1]);
        }
        await page.waitForFunction(
          (selector) => document.querySelector(selector).dataset.step === '2',
          selector,
          { polling: 25 },
        );
        assert.equal(await scene.getAttribute('data-step'), '2');
        if (selector === '.reader-window')
          await page.waitForFunction(() =>
            document.querySelector('.reader-window textarea').value.startsWith('请把作品集第一版'),
          );
        if (selector === '.writing-window')
          await page.waitForFunction(() =>
            document
              .querySelector('.writing-window textarea')
              .value.includes('请按目标、步骤和检查方法组织回答'),
          );
        await page.locator('.phrase-flight').waitFor({ state: 'detached' });
        const textbox = scene.getByRole('textbox').last();
        if (selector === '.reader-window')
          assert.match(await textbox.inputValue(), /^请把作品集第一版/);
        if (selector === '.writing-window') {
          assert.match(await textbox.inputValue(), /请按目标、步骤和检查方法组织回答/);
          assert.equal(
            await scene
              .getByRole('button', { name: 'Fast', exact: true })
              .getAttribute('aria-pressed'),
            'true',
          );
          assert.match(await scene.locator('.token-meter-readout').innerText(), /38\.4 tok\/s/);
        }
        if (selector === '.coordination-window') {
          assert.match(await scene.locator('.board-column').nth(2).innerText(), /整理三个代表作品/);
          assert.equal(
            await scene
              .getByRole('group', { name: '工程主管', exact: true })
              .locator('.palboo-bot-avatar')
              .getAttribute('data-activity'),
            'finished',
          );
          assert.equal(await scene.locator('.scene-bot-reply').isVisible(), true);
        }
        const finalDraft = await textbox.inputValue();
        await page.locator('h1').evaluate((node) => node.scrollIntoView({ behavior: 'instant' }));
        await frames(page);
        await enterScene(page, selector);
        await page.waitForTimeout(3200);
        assert.equal(await scene.getAttribute('data-step'), '2');
        assert.equal(await textbox.inputValue(), finalDraft);
        await page.screenshot({
          path: resolve(reports, `playback-${selector.slice(1)}-${width}.png`),
        });
      } finally {
        await page.close();
      }
    });
  }
}

for (const action of ['pointer', 'focus', 'keyboard']) {
  test(`manual ${action} permanently takes over every combined scene across scrolling and resize`, async () => {
    const page = await frozenPage();
    try {
      for (const selector of sceneSelectors) {
        const scene = page.locator(selector);
        await enterScene(page, selector);
        await page.clock.runFor(100);
        const draft = scene.getByRole('textbox').last();
        if (action === 'pointer') await scene.locator('.scene-feature-head h3').first().click();
        if (action === 'focus') await draft.focus();
        // 单独验证键盘捕获，不用先聚焦输入框掩盖它是否工作。
        if (action === 'keyboard')
          await scene.dispatchEvent('keydown', { key: 'Escape', bubbles: true });
        await page.clock.runFor(50);
        assert.equal(await scene.getAttribute('data-step'), '', action);
        const unchanged = await draft.inputValue();
        await page.clock.runFor(3500);
        assert.equal(await draft.inputValue(), unchanged);
        await draft.fill(`${action}: 我的草稿 / keep this`);
        await draft.blur();
        await page.mouse.move(3, 3);
        await page.mouse.wheel(0, 1200);
        await page.clock.runFor(80);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.clock.runFor(80);
        await enterScene(page, selector);
        await page.clock.runFor(3500);
        assert.equal(await scene.getAttribute('data-step'), '');
        assert.equal(await draft.inputValue(), `${action}: 我的草稿 / keep this`);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.clock.runFor(80);
      }
    } finally {
      await page.close();
    }
  });
}

test('taking over a reading insertion cancels the in-flight text and never restores stale suggestions', async () => {
  const page = await frozenPage();
  try {
    const scene = page.locator('.reader-window');
    await enterScene(page, '.reader-window');
    await page.clock.runFor(80);
    await page.clock.runFor(2800);
    const flight = page.locator('.phrase-flight');
    await flight.waitFor();
    await flight.evaluate((node) => node.getAnimations().forEach((animation) => animation.pause()));
    const draft = scene.getByLabel('阅读示例草稿');
    await draft.fill('飞行中输入的新草稿');
    await scene.getByRole('button', { name: '重新生成建议', exact: true }).click();
    await scene.getByRole('button', { name: /比较展示方式/ }).waitFor();
    await page.clock.runFor(4000);
    assert.equal(await flight.count(), 0);
    assert.equal(await draft.inputValue(), '飞行中输入的新草稿');
    await page.mouse.wheel(0, -800);
    await enterScene(page, '.reader-window');
    await page.clock.runFor(3500);
    assert.equal(await draft.inputValue(), '飞行中输入的新草稿');
  } finally {
    await page.close();
  }
});

test('reduced motion leaves all combined workspaces readable and interactive without automatic playback', async () => {
  const page = await frozenPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  try {
    for (const selector of sceneSelectors) {
      await enterScene(page, selector);
      await page.clock.runFor(4000);
      const scene = page.locator(selector);
      assert.equal(await scene.getAttribute('data-step'), '');
      assert.equal(await scene.getByRole('textbox').last().isVisible(), true);
    }
    assert.equal(await page.locator('.phrase-flight').count(), 0);
    assert.equal(await page.locator('.reader-window textarea').inputValue(), '');
    assert.equal(await page.locator('.coordination-window textarea').inputValue(), '');
    assert.match(
      await page.locator('.writing-window textarea').inputValue(),
      /^帮我把这个作品集方案安排一下$/,
    );
    const eye = page.locator('.coordination-window .palboo-bot-eye').first();
    assert.equal(await eye.evaluate((node) => getComputedStyle(node).animationName), 'none');
    await page.locator('.writing-window textarea').fill('减少动态效果仍能编辑');
    await page
      .locator('.writing-window')
      .getByRole('button', { name: '继续', exact: true })
      .click();
    await page.clock.runFor(500);
    await waitValue(
      page.locator('.writing-window textarea'),
      '减少动态效果仍能编辑\n继续完成剩余步骤。',
    );
  } finally {
    await page.close();
  }
});

test('scene drafts, edited tasks and open term focus survive responsive and motion changes', async () => {
  const page = await newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(base);
    for (const [i, selector] of sceneSelectors.entries())
      await page.locator(selector).getByRole('textbox').last().fill(`场景 ${i} 的草稿`);
    const reader = page.locator('.reader-window');
    await reader.locator('.term-brick').first().click();
    await page.getByRole('button', { name: '收藏术语', exact: true }).click();
    const favorite = page.getByRole('button', { name: '取消收藏', exact: true });
    await favorite.focus();
    for (const viewport of [
      { width: 550, height: 900 },
      { width: 1280, height: 600 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await frames(page);
      assert.equal(await focused(favorite), true);
      assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
    }
    await page.keyboard.press('Escape');
    const board = page.locator('.coordination-window .scene-feature-board');
    await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
    const title = board.getByLabel('新任务标题');
    await title.fill('保持未保存任务');
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 600 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await frames(page);
      assert.equal(await title.inputValue(), '保持未保存任务');
      assert.equal(await focused(title), true);
    }
    await emulateMedia(page, { reducedMotion: 'no-preference' });
    assert.equal(await focused(title), true);
    await page.keyboard.press('Enter');
    await board.getByRole('button', { name: '任务详情：保持未保存任务', exact: true }).waitFor();
    for (const [i, selector] of sceneSelectors.entries())
      assert.equal(
        await page.locator(selector).getByRole('textbox').last().inputValue(),
        `场景 ${i} 的草稿`,
      );
  } finally {
    await page.close();
  }
});

test('English scene labels and product choices translate while visitor drafts survive language switches and reload preserves language', async () => {
  const page = await newPage({
    locale: 'en-US',
    viewport: { width: 1280, height: 960 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(base);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.match(
      await page.locator('h1').innerText(),
      /Give your conversations\s+another dimension/,
    );
    for (const [i, selector] of sceneSelectors.entries())
      await page.locator(selector).getByRole('textbox').last().fill(`Keep draft ${i} / 不翻译`);
    const reader = page.locator('.reader-window');
    await reader.getByRole('button', { name: 'Regenerate suggestions', exact: true }).click();
    await reader.getByRole('button', { name: /Compare presentation/ }).waitFor();
    const models = page.locator('.writing-window .model-matrix');
    await models.getByRole('button', { name: 'GPT-6-Astra · High', exact: true }).click();
    for (const locale of ['zh-CN', 'en']) {
      await page.locator('.site-language').click();
      await page.waitForFunction((value) => document.documentElement.lang === value, locale);
      for (const [i, selector] of sceneSelectors.entries())
        assert.equal(
          await page.locator(selector).getByRole('textbox').last().inputValue(),
          `Keep draft ${i} / 不翻译`,
        );
      assert.equal(
        await models
          .getByRole('button', { name: 'GPT-6-Astra · High', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      await reader
        .getByRole('button', { name: locale === 'en' ? /Compare presentation/ : /比较展示方式/ })
        .waitFor();
    }
    assert.equal(
      await page.getByRole('region', { name: 'Reading workspace demo', exact: true }).count(),
      1,
    );
    assert.equal(
      await page.getByRole('region', { name: 'Writing workspace demo', exact: true }).count(),
      1,
    );
    assert.equal(
      await page.getByRole('region', { name: 'Tasks and collaboration demo', exact: true }).count(),
      1,
    );
    for (const width of [390, 742, 1280]) {
      await page.setViewportSize({ width, height: 960 });
      await frames(page);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await enterScene(page, '.writing-window');
      await page.screenshot({ path: resolve(reports, `writing-en-${width}.png`) });
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  } finally {
    await page.close();
  }
});

test('short page keeps three stable combined scenes, accessible header actions and genuine installation links', async () => {
  const page = await newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(base);
    assert.equal(await page.locator('.combined-scene').count(), 3);
    assert.equal(
      await page.locator('.reading-story, .scroll-demo, .static-chapter, .tools-section').count(),
      0,
    );
    const initial = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      viewport: innerHeight,
    }));
    assert.ok(
      initial.height < initial.viewport * 9,
      `compact page budget: ${JSON.stringify(initial)}`,
    );
    for (const selector of sceneSelectors) {
      const scene = page.locator(selector);
      await scene.getByRole('textbox').last().fill('稳定组件');
      await enterScene(page, selector);
      const actions = scene.locator('.scene-feature-head button');
      for (const action of await actions.all()) {
        if (!(await action.isVisible())) continue;
        const box = await action.boundingBox();
        assert.ok(box.width >= 28 && box.height >= 28, JSON.stringify(box));
        assert.ok(
          (await action.getAttribute('aria-label')) || (await action.innerText()).trim(),
          'header action must have an accessible name',
        );
      }
      assert.equal(await scene.getByRole('textbox').last().inputValue(), '稳定组件');
    }
    const download = page.getByRole('link', {
      name: '下载，前往 GitHub 发布页面',
      includeHidden: true,
    });
    assert.equal(await download.count(), 2);
    for (const link of await download.all())
      assert.equal(await link.getAttribute('href'), 'https://github.com/0xTotoroX/palboo/releases');
    assert.equal(await page.locator('a[download]').count(), 0);
    const details = page.locator('.install-details');
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await details.evaluate((node) => node.open), true);
    assert.match(await details.innerText(), /macOS 15\+[\s\S]*macOS 26/);
    assert.match(await details.innerText(), /无需 Node 或 Rust/);
    assert.match(await details.innerText(), /本机连接[\s\S]*不修改官方应用/);
    await page.keyboard.press('Enter');
    assert.equal(await details.evaluate((node) => node.open), false);
  } finally {
    await page.close();
  }
});

test('scrolling the short opening never enumerates or overwrites manual layouts and materials', async () => {
  const page = await newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(base);
    await scrollOpening(page, 1);
    const scene = page.locator('.surface-story');
    const state = () =>
      scene.evaluate((node) => ({
        placement: node.querySelector('[data-demo-placement]').dataset.demoPlacement,
        arrangement: node.querySelector('[aria-label="演示排列"] [aria-pressed="true"]')
          .textContent,
        material: node.querySelector('.layout-demo-workspace').dataset.material,
        variant: node.querySelector('.layout-demo-workspace').dataset.variant,
      }));
    const initial = await state();
    for (const progress of [0.7, 0.8, 0.95, 1, 0.5, 0.2]) {
      await scrollScene(page, '.opening-story', progress);
      assert.deepEqual(await state(), initial);
    }
    await scrollOpening(page, 1);
    await scene.getByRole('button', { name: '左右', exact: true }).click();
    await page.evaluate(() => document.activeElement.blur());
    await page.mouse.move(5, 5);
    await page.mouse.wheel(0, 1);
    await scrollScene(page, '.opening-story', 0.98);
    await scene
      .locator('.material-story')
      .getByRole('button', { name: '磨砂', exact: true })
      .click();
    const manual = await state();
    assert.equal(manual.arrangement, '左右');
    assert.equal(manual.material, 'frosted');
    await page.evaluate(() => document.activeElement.blur());
    for (const progress of [0.4, 0.8, 0.95, 0.65]) {
      await page.mouse.wheel(0, 1);
      await scrollScene(page, '.opening-story', progress);
      assert.deepEqual(await state(), manual);
    }
  } finally {
    await page.close();
  }
});

test('synthetic compatibility menu supports selection and keyboard navigation without polling or losing the reading draft', async () => {
  const page = await frozenPage({ reducedMotion: 'reduce' });
  const businessRequests = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr', 'eventsource'].includes(request.resourceType()))
      businessRequests.push(request.url());
  });
  try {
    const reader = page.locator('.reader-window');
    const draft = reader.getByLabel('阅读示例草稿', { exact: true });
    await draft.fill('切换示例 Agent 仍保留 / keep my draft');
    const inputNode = await draft.elementHandle();
    const trigger = reader.getByRole('button', { name: '兼容集成', exact: true });
    const menu = reader.locator('.scene-agent-menu');
    const menuNode = await menu.elementHandle();
    assert.equal(await menu.count(), 1);
    assert.equal(await menu.isVisible(), false);
    assert.equal(await trigger.innerText(), 'Codex');
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(
      (await menu.getByRole('menuitemradio').allTextContents()).map((text) => text.trim()),
      ['Codex', 'Claude Code', 'OpenCode'],
    );
    assert.equal(
      await menu
        .getByRole('menuitemradio', { name: 'Codex', exact: true })
        .getAttribute('aria-checked'),
      'true',
    );
    // 超过真实预览的两个轮询周期，并触发重新聚焦；合成example不应进入服务读取分支。
    await page.clock.runFor(11000);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(100);
    await menu.getByRole('menuitemradio', { name: 'Claude Code', exact: true }).click();
    assert.equal(await trigger.innerText(), 'Claude Code');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await focused(trigger), true);
    assert.equal(await menu.isVisible(), false);
    await page.keyboard.press('Enter');
    assert.equal(
      await menu
        .getByRole('menuitemradio', { name: 'Claude Code', exact: true })
        .getAttribute('aria-checked'),
      'true',
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await focused(menu.getByRole('menuitemradio', { name: 'Codex', exact: true })),
      true,
    );
    await page.keyboard.press('End');
    assert.equal(
      await focused(menu.getByRole('menuitemradio', { name: 'OpenCode', exact: true })),
      true,
    );
    await page.keyboard.press('ArrowUp');
    assert.equal(
      await focused(menu.getByRole('menuitemradio', { name: 'Claude Code', exact: true })),
      true,
    );
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await trigger.innerText(), 'OpenCode');
    assert.equal(await focused(trigger), true);
    assert.equal(await menu.isVisible(), false);
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false);
    assert.equal(await focused(trigger), true);
    assert.equal(await trigger.innerText(), 'OpenCode');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.runFor(100);
    await trigger.click();
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, JSON.stringify(bounds));
    await page.screenshot({ path: resolve(reports, 'compatibility-menu-mobile.png') });
    await menu.getByRole('menuitemradio', { name: 'Codex', exact: true }).click();
    assert.equal(await trigger.innerText(), 'Codex');
    await page.clock.runFor(6000);
    assert.equal(await draft.inputValue(), '切换示例 Agent 仍保留 / keep my draft');
    assert.equal(await inputNode.evaluate((node) => node.isConnected), true);
    assert.equal(
      await menuNode.evaluate(
        (node) => node === document.querySelector('.reader-window .scene-agent-menu'),
      ),
      true,
    );
    assert.equal(await page.locator('.combined-scene').count(), 3);
    assert.deepEqual(businessRequests, []);
    const licenses = await readFile(resolve(output, 'LICENSES.txt'), 'utf8');
    for (const name of ['NOTICE.md', 'LICENSE', 'COPYING-GPL-3.0']) {
      const original = await readFile(`ui/settings/codex-host-assets/${name}`, 'utf8');
      assert.ok(licenses.includes(original.trim()), `${name} must be distributed verbatim`);
    }
  } finally {
    await page.close();
  }
});

test('writing playback keeps the inserted phrase when the decorative flight is suspended', async () => {
  const page = await newPage({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  try {
    await page.goto(base);
    await enterScene(page, '.writing-window');
    await page.waitForFunction(
      () => document.querySelector('.writing-window').dataset.step === '1',
    );
    await page.evaluate(() => {
      document
        .querySelectorAll('.phrase-flight')
        .forEach((node) => node.getAnimations().forEach((animation) => animation.pause()));
    });
    const draft = page.locator('.writing-window textarea');
    assert.match(await draft.inputValue(), /帮我把这个作品集方案安排一下\n检查这份作品集方案：/);
    await page
      .locator('.writing-window')
      .getByRole('button', { name: '恢复原提示词', exact: true })
      .waitFor();
    assert.match(
      await draft.inputValue(),
      /检查这份作品集方案：[\s\S]*请按目标、步骤和检查方法组织回答。$/,
    );
  } finally {
    await page.close();
  }
});
