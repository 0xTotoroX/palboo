/* [INPUT]: Production website build, local HTTP server and synthetic browser input.
 * [OUTPUT]: Feature/state, surface geometry, theme, motion and responsive acceptance.
 * [POS]: Isolated public-page tests and synthetic browser captures; no host, model or real configuration.
 * [PROTOCOL]: Keep tests/AGENTS.md and website/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const reports = resolve('target/reports/site-features');
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

const ids = [
  'outline',
  'next',
  'prompts',
  'terms',
  'board',
  'model',
  'bots',
  'prompt',
  'compatibility',
];

test('the opening fits a complete display, retracts its stand and tours placements and materials', async () => {
  const page = await newPage({
    viewport: { width: 1609, height: 1079 },
    reducedMotion: 'no-preference',
  });
  try {
    await page.clock.install();
    await page.goto(`${base}/?lang=zh-CN`);
    await page.clock.runFor(7200);
    const monitor = page.locator('.studio-display-frame');
    const stand = monitor;
    await monitor.locator('canvas[data-ready=true]').waitFor();
    const device = await monitor.boundingBox();
    const copy = await page.locator('.opening-copy').boundingBox();
    assert.ok(device.y > copy.y + copy.height, 'centered copy stays above the complete monitor');
    assert.ok(
      device.y > 0 && device.y + device.height < 1079,
      'the stand is visible before scrolling',
    );
    assert.equal(await stand.getAttribute('data-progress'), '0');
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight < innerHeight * 9.5));
    await page.screenshot({ path: resolve(reports, 'monitor-opening.png') });
    const workspace = await page.locator('.layout-demo-window').elementHandle();
    await scrollScene(page, '.opening-story', 0.3 / 3.5);
    assert.ok(
      Number(await stand.getAttribute('data-progress')) > 0 &&
        Number(await stand.getAttribute('data-progress')) < 1,
    );
    for (const [distance, placement, material, variant] of [
      [0.8, 'sidebar', 'matte', 'regular'],
      [1.05, 'overlay', 'matte', 'regular'],
      [1.4, 'desktop', 'matte', 'regular'],
      [1.7, 'edge', 'matte', 'regular'],
      [2, 'edge', 'matte', 'regular'],
      [2.4, 'overlay', 'matte', 'regular'],
      [2.6, 'overlay', 'frosted', 'regular'],
      [2.85, 'overlay', 'native-glass', 'regular'],
      [3.1, 'overlay', 'native-glass', 'clear'],
      [3.35, 'overlay', 'black', 'regular'],
    ]) {
      await scrollScene(page, '.opening-story', distance / 3.5);
      await page.locator(`.layout-demo-canvas[data-demo-placement="${placement}"]`).waitFor();
      await page
        .locator(`.layout-demo-workspace[data-material="${material}"][data-variant="${variant}"]`)
        .waitFor();
      await page.clock.runFor(1100);
      assert.equal(
        await page.locator('.layout-demo-canvas').getAttribute('data-demo-placement'),
        placement,
      );
      assert.equal(
        await page.locator('.layout-demo-workspace').getAttribute('data-material'),
        material,
      );
      assert.equal(
        await page.locator('.layout-demo-workspace').getAttribute('data-variant'),
        variant,
      );
      assert.equal(await stand.getAttribute('data-progress'), '1');
      assert.equal(
        await workspace.evaluate((node) => node === document.querySelector('.layout-demo-window')),
        true,
      );
      if (distance === 2) {
        await page.waitForFunction(
          () => document.querySelector('[aria-label="贴边位置演示"]')?.value === 'top',
        );
        assert.equal(await page.getByLabel('贴边位置演示').inputValue(), 'top');
      }
      if ([0.8, 1.4, 2.85].includes(distance))
        await page.screenshot({
          path: resolve(reports, `monitor-stage-${placement}-${material}.png`),
        });
    }
    await scrollScene(page, '.opening-story', 1.05 / 3.5);
    await page.clock.runFor(1100);
    assert.equal(
      await page.locator('.layout-demo-canvas').getAttribute('data-demo-placement'),
      'overlay',
    );
    await scrollScene(page, '.opening-story', 0);
    await page.waitForFunction(
      () => document.querySelector('.studio-display-frame')?.getAttribute('data-progress') === '0',
    );
    assert.equal(await stand.getAttribute('data-progress'), '0');
    await page.locator('#install').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.install-details').count(), 0);
    await page.screenshot({ path: resolve(reports, 'monitor-footer.png') });
  } finally {
    await page.close();
  }
});

test('the monitor opening stays complete in a shorter desktop viewport and manual controls pause its tour', async () => {
  const page = await newPage({
    viewport: { width: 1063, height: 690 },
    reducedMotion: 'no-preference',
  });
  try {
    await page.goto(`${base}/?lang=en`);
    const device = await page.locator('.studio-display-frame').boundingBox();
    assert.ok(
      device.x >= 0 &&
        device.y >= 0 &&
        device.x + device.width <= 1063 &&
        device.y + device.height <= 690,
    );
    const copy = await page.locator('.opening-copy').boundingBox();
    assert.ok(
      device.y > copy.y + copy.height + 20,
      'short viewport keeps the monitor below the download link',
    );
    await scrollScene(page, '.opening-story', 2.6 / 3.5);
    await page.getByRole('button', { name: 'Matte', exact: true }).click();
    await frames(page);
    assert.equal(
      await page.locator('.layout-demo-workspace').getAttribute('data-material'),
      'matte',
    );
    const materialControls = await page.locator('.material-story').boundingBox();
    assert.ok(
      materialControls.y + materialControls.height <= 690,
      'material controls fit short desktop screens',
    );
    await page.mouse.wheel(0, 1);
    await scrollScene(page, '.opening-story', 3.1 / 3.5);
    await page.locator('.layout-demo-workspace[data-variant=clear]').waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.opening-story[data-static=true]').waitFor();
    await page.getByRole('button', { name: 'Matte', exact: true }).click();
    assert.equal(
      await page.locator('.layout-demo-workspace').getAttribute('data-material'),
      'matte',
    );
  } finally {
    await page.close();
  }
});
const names = [
  '大纲',
  '下一步',
  '常用语',
  '术语释义',
  '任务看板',
  '模型切换',
  'Grok Bot',
  '提示词优化',
  '兼容集成',
];
async function site(options = {}, language = 'zh-CN', clock = false) {
  const page = await newPage({
    locale: language,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    ...options,
  });
  if (clock) await page.clock.install();
  await page.goto(`${base}/?lang=${language}#features`);
  await page.locator('#feature-tab-outline[aria-selected=true]').waitFor();
  await frames(page);
  return page;
}
const panel = (page, id) => page.locator(`#feature-panel-${id}`);
async function select(page, id) {
  await page.locator(`#feature-tab-${id}`).click();
  await panel(page, id)
    .filter({ has: page.locator('h2') })
    .waitFor({ state: 'visible' });
  await frames(page);
  assert.equal(await page.locator(`#feature-tab-${id}`).getAttribute('aria-selected'), 'true');
}

test('one settings-based preview and the nine settings-ordered tabs replace the combined scenes', async () => {
  const page = await site();
  try {
    assert.deepEqual(
      (await page.locator('.feature-navigation [role=tab]').allTextContents()).map((name) =>
        name.trim(),
      ),
      names,
    );
    assert.equal(
      await page.locator('.reader-window,.writing-window,.coordination-window').count(),
      0,
    );
    assert.equal(await page.getByRole('tabpanel').count(), 1);
    assert.equal(await page.locator('[data-settings-feature]').count(), 6);
    assert.equal(await page.locator('.brand-opening').count(), 1);
    const bounds = await page.locator('.feature-pin').boundingBox();
    assert.ok(Math.abs(bounds.y) < 2, 'direct features link lands at the stage');
    for (const id of ids) {
      await select(page, id);
      assert.equal(await page.getByRole('tabpanel').count(), 1);
      assert.equal(await panel(page, id).getAttribute('inert'), null);
    }
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollHeight < 6000),
      'compact page budget',
    );
    assert.match(
      await page
        .getByRole('link', { name: '下载，前往 GitHub 发布页面' })
        .first()
        .getAttribute('href'),
      /github\.com\/0xTotoroX\/palboo\/releases/,
    );
  } finally {
    await page.close();
  }
});

test('native forward/reverse scrolling switches one page while the rail and frame remain fixed', async () => {
  const page = await site({ reducedMotion: 'no-preference' });
  try {
    const initial = await page.locator('.feature-navigation').boundingBox();
    for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 6, 4, 2, 0]) {
      await scrollScene(page, '#features', index / 8);
      await page.locator(`#feature-tab-${ids[index]}[aria-selected=true]`).waitFor();
      await page.getByRole('tabpanel').waitFor({ state: 'visible' });
      const current = await page.locator('.feature-navigation').boundingBox();
      assert.ok(Math.abs(current.y - initial.y) < 2 && Math.abs(current.x - initial.x) < 2);
      assert.equal(await page.getByRole('tabpanel').count(), 1);
    }
    await page.mouse.move(120, 400);
    await page.mouse.wheel(0, 300);
    await page.locator('#feature-tab-next[aria-selected=true]').waitFor();
    await page.mouse.wheel(0, -300);
    await page.locator('#feature-tab-outline[aria-selected=true]').waitFor();
    await scrollScene(page, '#features', 1);
    await page.mouse.wheel(0, 900);
    await page.locator('#install').scrollIntoViewIfNeeded();
    assert.ok(
      (await page.locator('#install').boundingBox()).y < 900,
      'normal exit reaches download',
    );
  } finally {
    await page.close();
  }
});

test('click and keyboard navigation share selection without exposing hidden controls', async () => {
  const page = await site();
  try {
    await select(page, 'next');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#feature-tab-prompts').getAttribute('aria-selected'), 'true');
    assert.equal(await focused(page.locator('#feature-tab-prompts')), true);
    await page.keyboard.press('End');
    assert.equal(
      await page.locator('#feature-tab-compatibility').getAttribute('aria-selected'),
      'true',
    );
    await page.keyboard.press('Home');
    await page.keyboard.press('Tab');
    assert.equal(await focused(panel(page, 'outline')), true);
    assert.equal(await page.locator('.feature-panel[inert]').count(), 8);
  } finally {
    await page.close();
  }
});

test('scrolling without wheel or keyboard input resumes after viewport resizing', async () => {
  const page = await site();
  try {
    await select(page, 'prompts');
    await page.setViewportSize({ width: 1063, height: 690 });
    await frames(page);
    await frames(page);
    assert.equal(await page.locator('#feature-tab-prompts').getAttribute('aria-selected'), 'true');
    // 原生滚动条只产生 scroll；不发送 wheel/touch/key 事件解除保护。
    await scrollScene(page, '#features', 5 / 8);
    await page.locator('#feature-tab-model[aria-selected=true]').waitFor();
    await scrollScene(page, '#features', 1 / 8);
    await page.locator('#feature-tab-next[aria-selected=true]').waitFor();
  } finally {
    await page.close();
  }
});

test('shared phrases expand, insert and keep an unfinished edit through navigation and language changes', async () => {
  const page = await site();
  try {
    await select(page, 'prompts');
    const phrases = panel(page, 'prompts');
    assert.equal(await phrases.locator('[data-quick-prompt]').count(), 7);
    await phrases.getByRole('button', { name: '展开全文', exact: true }).first().click();
    await phrases.getByRole('button', { name: '检查方案', exact: true }).click();
    await phrases.locator('.preview-draft').waitFor();
    assert.match(await phrases.locator('.preview-draft').innerText(), /保留已经确认的视觉风格/);
    await phrases.getByRole('button', { name: '仅显示名称', exact: true }).click();
    assert.equal(await phrases.locator('[data-names-only=true]').count(), 1);
    await phrases.getByRole('button', { name: '完整内容', exact: true }).click();
    await phrases.getByRole('button', { name: '添加快捷指令', exact: true }).click();
    const editor = phrases.getByLabel('快捷指令内容', { exact: true });
    await editor.fill('保留我没有保存的指令');
    await select(page, 'next');
    await select(page, 'prompts');
    assert.equal(await editor.inputValue(), '保留我没有保存的指令');
    await page.locator('.site-language').click();
    assert.equal(await phrases.locator('textarea').inputValue(), '保留我没有保存的指令');
    assert.equal(await phrases.locator('.preview-draft').count(), 1);
  } finally {
    await page.close();
  }
});

test('outline and next step run the settings preview commands in memory', async () => {
  const page = await site();
  try {
    const outline = panel(page, 'outline');
    assert.equal(await outline.locator('.csw-outline-row[data-outline-id]').count(), 9);
    const before = await page.evaluate(() => scrollY);
    await outline.locator('[data-outline-id="1:mobile"]').click();
    await outline
      .locator('.feature-answer [data-section="1:mobile"][data-selected=true]')
      .waitFor();
    assert.equal(
      await page.evaluate(() => scrollY),
      before,
      'source navigation stays inside the preview',
    );
    assert.equal(await outline.locator('.preview-draft').count(), 0);
    await select(page, 'next');
    const next = panel(page, 'next');
    await next.getByRole('button', { name: /^拆解第一版/ }).click();
    await next.locator('.preview-draft').waitFor();
    assert.match(await next.locator('.preview-draft').textContent(), /两天的任务清单/);
    await next.getByRole('button', { name: '重新生成建议', exact: true }).click();
    await next.getByRole('button', { name: /^比较展示方式/ }).waitFor();
    await select(page, 'outline');
    await outline
      .locator('.feature-answer [data-section="1:mobile"][data-selected=true]')
      .waitFor();
  } finally {
    await page.close();
  }
});

test('the real task board can edit and create tasks without leaving the shared frame', async () => {
  const page = await site();
  try {
    await select(page, 'board');
    const board = panel(page, 'board');
    assert.equal(await board.locator('.board-column').count(), 3);
    assert.equal(await board.locator('.task-card').count(), 9);
    await board.getByRole('button', { name: '任务详情：整理三个代表作品', exact: true }).click();
    await board.getByRole('textbox', { name: '标题', exact: true }).fill('整理作品与截图');
    await board.getByRole('button', { name: '保存', exact: true }).click();
    await board.getByRole('button', { name: '任务详情：整理作品与截图', exact: true }).waitFor();
    await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
    await board.getByLabel('新任务标题').fill('给作品配上介绍');
    await page.keyboard.press('Enter');
    await select(page, 'model');
    await select(page, 'board');
    await board.getByRole('button', { name: '任务详情：给作品配上介绍', exact: true }).waitFor();
    await page.screenshot({ path: resolve(reports, 'desktop-board.png') });
  } finally {
    await page.close();
  }
});

test('shared model choices, Bot messages and the isolated Agent menu remain interactive', async () => {
  const page = await site();
  try {
    await select(page, 'model');
    const model = panel(page, 'model');
    await model.locator('.token-meter-readout').waitFor();
    assert.match(await model.locator('.token-meter-readout').innerText(), /38.4/);
    const choice = model.locator('[data-model="example-c"][data-reasoning="high"]');
    await choice.click();
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    await model.getByRole('button', { name: 'Fast', exact: true }).click();
    assert.equal(
      await model.getByRole('button', { name: 'Fast', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    await page.screenshot({ path: resolve(reports, 'desktop-model.png') });
    await select(page, 'bots');
    const bots = panel(page, 'bots');
    await bots.getByRole('button', { name: '最近消息', exact: true }).click();
    await bots
      .getByText('三个项目各保留两张关键截图；记账应用还缺一段个人贡献说明。', { exact: true })
      .waitFor();
    await select(page, 'compatibility');
    const agent = panel(page, 'compatibility').getByRole('menuitemradio', {
      name: 'Claude Code',
      exact: true,
    });
    await agent.click();
    assert.equal(await agent.getAttribute('aria-checked'), 'true');
    const agents = panel(page, 'compatibility');
    assert.equal(await agents.locator('.compatibility-agent-row').count(), 18);
    assert.equal(await agents.locator('.compatibility-agent-add').count(), 14);
    await agents.locator('.compatibility-agent-add').first().click();
    assert.equal(await agents.locator('.compatibility-agent-add').count(), 13);
    await select(page, 'model');
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
  } finally {
    await page.close();
  }
});

test('prompt optimization restores text and keeps a manual draft while switching features', async () => {
  const page = await site();
  try {
    await select(page, 'prompt');
    const prompt = panel(page, 'prompt');
    const input = prompt.getByRole('textbox', { name: '提示词优化演示', exact: true });
    const before = await input.inputValue();
    await prompt.getByRole('button', { name: '优化提示词', exact: true }).click();
    await prompt.getByRole('button', { name: '恢复原提示词', exact: true }).waitFor();
    assert.notEqual(await input.inputValue(), before);
    await prompt.getByRole('button', { name: '恢复原提示词', exact: true }).click();
    assert.equal(await input.inputValue(), before);
    await input.fill('我的未发送草稿');
    await select(page, 'prompts');
    await select(page, 'prompt');
    assert.equal(await input.inputValue(), '我的未发送草稿');
  } finally {
    await page.close();
  }
});

test('language changes translate sample labels while preserving model selection, Fast and renamed presets', async () => {
  const page = await site();
  try {
    await select(page, 'model');
    const model = panel(page, 'model');
    const choice = model.locator('[data-model="example-c"][data-reasoning="high"]');
    const fast = model.getByRole('button', { name: 'Fast', exact: true });
    await choice.click();
    await fast.click();
    await model.getByRole('button', { name: '编辑预设', exact: true }).click();
    await model.locator('.model-preset-choice').first().click();
    await model.getByRole('textbox', { name: '预设名称', exact: true }).fill('我的保留预设');
    await model.getByRole('textbox', { name: '预设名称', exact: true }).press('Enter');
    await model.getByRole('button', { name: '编辑预设', exact: true }).click();
    await page.locator('.site-language').click();
    await select(page, 'model');
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    assert.equal(await fast.getAttribute('aria-pressed'), 'true');
    assert.match(await choice.getAttribute('aria-label'), /Example model C/i);
    assert.match(await model.locator('.model-preset-choice').first().innerText(), /我的保留预设/);
    assert.match(await model.locator('.model-preset-choice').nth(1).innerText(), /Deep analysis/);
    await page.locator('.site-language').click();
    await select(page, 'model');
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    assert.equal(await fast.getAttribute('aria-pressed'), 'true');
    assert.match(await model.locator('.model-preset-choice').nth(1).innerText(), /深入分析/);
  } finally {
    await page.close();
  }
});

test('term details close when scrolling to another feature and favorites survive', async () => {
  const page = await site();
  try {
    await select(page, 'terms');
    const terms = panel(page, 'terms');
    assert.equal(await terms.locator('.term-brick').count(), 12);
    await terms.getByRole('button', { name: '响应式布局', exact: true }).click();
    const popup = page.locator('.term-popover[data-open=true]');
    await popup.waitFor();
    await popup.getByRole('button', { name: '收藏术语', exact: true }).click();
    await scrollScene(page, '#features', 4 / 8);
    await page.locator('#feature-tab-board[aria-selected=true]').waitFor();
    await popup.waitFor({ state: 'hidden' });
    await select(page, 'terms');
    await terms.getByRole('button', { name: '收藏', exact: true }).click();
    await terms.getByRole('button', { name: '响应式布局', exact: true }).waitFor();
  } finally {
    await page.close();
  }
});

test('entry demonstration only runs in view and manual interaction cancels it', async () => {
  const page = await site({ reducedMotion: 'no-preference' }, 'zh-CN', true);
  try {
    await select(page, 'next');
    await page.clock.runFor(1700);
    await panel(page, 'next').locator('.preview-draft').waitFor();
    await select(page, 'prompts');
    const phrases = panel(page, 'prompts');
    await phrases.getByRole('button', { name: '添加快捷指令', exact: true }).click();
    await phrases.getByLabel('快捷指令内容').click();
    await phrases.getByLabel('快捷指令内容').fill('手动接管');
    assert.equal(await phrases.getByLabel('快捷指令内容').inputValue(), '手动接管');
    await page.clock.runFor(2200);
    assert.equal(await phrases.getByLabel('快捷指令内容').inputValue(), '手动接管');
    await select(page, 'model');
    await select(page, 'prompts');
    await page.clock.runFor(2200);
    assert.equal(await phrases.getByLabel('快捷指令内容').inputValue(), '手动接管');
  } finally {
    await page.close();
  }
});

for (const [width, height, language] of [
  [1609, 1079, 'zh-CN'],
  [1440, 900, 'zh-CN'],
  [1024, 720, 'en'],
  [1063, 690, 'zh-CN'],
  [390, 844, 'zh-CN'],
  [320, 568, 'en'],
  [1280, 540, 'en'],
]) {
  test(`real previews stay readable and contained at ${width}x${height} (${language})`, async () => {
    const page = await site({ viewport: { width, height } }, language);
    try {
      for (const id of ids) {
        await select(page, id);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          await page.evaluate(() =>
            [...document.querySelectorAll('body *')]
              .filter(
                (e) =>
                  e.getBoundingClientRect().right > innerWidth + 1 &&
                  getComputedStyle(e).visibility === 'visible',
              )
              .slice(0, 12)
              .map((e) => [e.className, e.getBoundingClientRect().right])
              .join('\n'),
          ),
        );
        const b = await panel(page, id).locator('.feature-preview').boundingBox();
        assert.ok(
          b.width > 0 && b.x >= 0 && b.x + b.width <= width + 1,
          `${id}: preview inside screen`,
        );
        assert.equal(
          await panel(page, id)
            .locator('.feature-preview')
            .evaluate((el) => getComputedStyle(el).fontSize),
          '14px',
        );
        if (width === 1609) await page.screenshot({ path: resolve(reports, `feature-${id}.png`) });
      }
      await select(page, 'prompts');
      if (width === 1440 || width === 390 || width === 1063)
        await page.screenshot({
          path: resolve(
            reports,
            width === 1440 ? 'desktop.png' : width === 1063 ? 'user-1063.png' : 'mobile.png',
          ),
        });
      await page.locator('.site-theme').click();
      assert.equal(await page.locator('html').getAttribute('data-site-theme'), 'dark');
      if (width === 1440) {
        await select(page, 'prompts');
        await page.screenshot({ path: resolve(reports, 'desktop-dark.png') });
      }
    } finally {
      await page.close();
    }
  });
}
