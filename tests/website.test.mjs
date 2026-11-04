/* [INPUT]: Production website build, local HTTP server and synthetic browser input.
 * [OUTPUT]: Feature/state, surface geometry, theme, motion and responsive acceptance.
 * [POS]: Isolated public-page tests and synthetic browser captures; no host, model or real configuration.
 * [PROTOCOL]: Keep tests/AGENTS.md and website/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  'sites',
  'prompt',
  'compatibility',
];
const lastFeatureIndex = ids.length - 1;

test('the mascot leaves the screen, joins the backdrop, follows features and returns as OO', async () => {
  const page = await newPage({
    viewport: { width: 1609, height: 1079 },
    reducedMotion: 'no-preference',
  });
  try {
    await page.clock.install();
    await page.goto(`${base}/?lang=zh-CN`);
    await page.clock.runFor(7200);
    const main = page.locator('#main');
    const mascot = page.locator('.brand-journey');
    const phase = () => main.getAttribute('data-brand-phase');
    const waitForPhase = (expected) =>
      main.and(page.locator(`[data-brand-phase="${expected}"]`)).waitFor();
    const position = () =>
      mascot.evaluate((node) => {
        const matrix = new DOMMatrix(getComputedStyle(node).transform);
        return { x: matrix.e, y: matrix.f };
      });
    await page.screenshot({ path: resolve(reports, 'journey-opening.png') });
    await scrollScene(page, '.opening-story', 2.04 / 3.5);
    await page.clock.runFor(100);
    await waitForPhase('opening');
    assert.equal(await phase(), 'opening');
    const route = [];
    for (const distance of [2.13, 2.2, 2.28, 2.4, 2.8, 3.4]) {
      const previous = await mascot.getAttribute('style');
      await scrollScene(page, '.opening-story', distance / 3.5);
      await page.clock.runFor(100);
      const expected = distance < 2.4 ? 'to-material' : 'material';
      await waitForPhase(expected);
      if (expected === 'to-material') {
        await page.waitForFunction(
          (style) => document.querySelector('.brand-journey')?.getAttribute('style') !== style,
          previous,
        );
      }
      route.push({ distance, ...(await position()), phase: await phase() });
      await page.screenshot({ path: resolve(reports, `journey-material-${distance}.png`) });
    }
    assert.equal(route[0].phase, 'to-material');
    assert.equal(route.at(-1).phase, 'material');
    assert.ok(route[2].x > route[0].x + 200, 'leaves the rail for the existing backdrop eyes');
    const deep = await page
      .locator('.layout-demo-material-backdrop svg')
      .evaluate((el) => Number(getComputedStyle(el).opacity));
    await scrollScene(page, '.opening-story', 2.4 / 3.5);
    await page.clock.runFor(100);
    await page.waitForFunction(
      (before) =>
        before -
          Number(
            getComputedStyle(document.querySelector('.layout-demo-material-backdrop svg')).opacity,
          ) >
        0.4,
      deep,
    );
    const light = await page
      .locator('.layout-demo-material-backdrop svg')
      .evaluate((el) => Number(getComputedStyle(el).opacity));
    assert.ok(deep - light > 0.4, 'backdrop deepens across the material tour');
    await scrollScene(page, '.opening-story', 2.2 / 3.5);
    await page.clock.runFor(100);
    await page.waitForFunction(({ x, y }) => {
      const matrix = new DOMMatrix(
        getComputedStyle(document.querySelector('.brand-journey')).transform,
      );
      return Math.abs(matrix.e - x) < 2 && Math.abs(matrix.f - y) < 2;
    }, route[1]);
    const reversed = await position();
    assert.ok(
      Math.abs(reversed.x - route[1].x) < 2 && Math.abs(reversed.y - route[1].y) < 2,
      'reverse scrolling retraces the same route',
    );
    await page.evaluate(() =>
      scrollTo(0, document.querySelector('#features').offsetTop - innerHeight * 0.5),
    );
    await frames(page);
    await page.clock.runFor(150);
    await page.waitForFunction(
      () => document.querySelector('#main').dataset.brandPhase === 'to-feature',
    );
    assert.equal(await phase(), 'to-feature');
    await page.screenshot({ path: resolve(reports, 'journey-to-features.png') });
    await scrollScene(page, '#features', 0);
    await page.clock.runFor(500);
    await waitForPhase('feature');
    assert.equal(await phase(), 'feature');
    await page.screenshot({ path: resolve(reports, 'journey-desktop.png') });
    // Sample the actual paint frames in one browser turn. Tool round trips and
    // screenshots can themselves outlast a short hop, so they are not a clock.
    const flight = await page.evaluate(
      (lastIndex) =>
        new Promise((resolve) => {
          const node = document.querySelector('.brand-journey');
          const box = document.querySelector('#features').getBoundingClientRect();
          const top = scrollY + box.top;
          const points = [];
          let start;
          let firstFrame;
          let interrupted = false;
          const target = document.querySelectorAll('#features [role="tab"]')[3]?.id;
          scrollTo(0, top + ((box.height - innerHeight) * 3) / lastIndex);
          function sample(now) {
            firstFrame ??= now;
            if (node.dataset.target === target) start ??= now;
            if (start === undefined) {
              if (now - firstFrame >= 3000) resolve(points);
              else requestAnimationFrame(sample);
              return;
            }
            const matrix = new DOMMatrix(getComputedStyle(node).transform);
            points.push({ time: now - start, x: matrix.e, y: matrix.f, interrupted });
            if (!interrupted && now - start >= 120) {
              interrupted = true;
              scrollTo(0, top + (box.height - innerHeight) / lastIndex);
            }
            if (now - start >= 700) resolve(points);
            else requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        }),
      lastFeatureIndex,
    );
    assert.ok(flight.length > 0, 'the mascot receives the new feature target');
    const firstY = flight[0].y;
    assert.ok(
      flight.some((p) => !p.interrupted && p.y > firstY + 2),
      'feature changes travel through intermediate positions',
    );
    for (let i = 1; i < flight.length; i++) {
      if (flight[i].time - flight[i - 1].time > 40) continue;
      assert.ok(
        Math.hypot(flight[i].x - flight[i - 1].x, flight[i].y - flight[i - 1].y) < 35,
        'retargeting preserves frame-to-frame continuity',
      );
    }
    await page.waitForFunction(() => {
      const face = document.querySelector('.brand-journey');
      const next = document.querySelector('#feature-tab-next').getBoundingClientRect();
      const matrix = new DOMMatrix(getComputedStyle(face).transform);
      return (
        face.dataset.target === 'feature-tab-next' &&
        Math.abs(matrix.f - (next.y + next.height / 2)) < 1
      );
    });
    const settled = await position();
    const next = await page.locator('#feature-tab-next').boundingBox();
    assert.ok(Math.abs(settled.y - (next.y + next.height / 2)) < 1);
    assert.ok(settled.x + 18 < next.x, 'mascot lands outside the feature label and icon');
    await page.getByRole('tab', { name: '模型切换', exact: true }).click();
    await page.clock.runFor(500);
    await mascot.and(page.locator('[data-target="feature-tab-model"]')).waitFor();
    assert.equal(await mascot.getAttribute('data-target'), 'feature-tab-model');
    await page.screenshot({ path: resolve(reports, 'journey-model.png') });
    // Capture the first footer frame in the page, before tool round trips can
    // consume the rest delay on a loaded runner.
    await page.evaluate(() => {
      const main = document.querySelector('#main');
      const observer = new MutationObserver(() => {
        if (main.dataset.brandPhase !== 'footer') return;
        window.firstFooterRest = document.querySelector('#install').dataset.brandRest;
        observer.disconnect();
      });
      observer.observe(main, { attributes: true, attributeFilter: ['data-brand-phase'] });
    });
    await page.locator('#install').scrollIntoViewIfNeeded();
    await frames(page);
    await page.waitForFunction(
      () => document.querySelector('#main').dataset.brandPhase === 'footer',
    );
    await page.clock.runFor(100);
    assert.equal(await phase(), 'footer');
    assert.equal(await page.evaluate(() => window.firstFooterRest), 'false');
    await page.screenshot({ path: resolve(reports, 'journey-footer-face.png') });
    await page.clock.runFor(3200);
    assert.equal(await page.locator('#install').getAttribute('data-brand-rest'), 'true');
    await page.waitForFunction(
      () =>
        new DOMMatrix(getComputedStyle(document.querySelector('.closing-counter')).transform).a >
        0.99,
    );
    const counter = await page
      .locator('.closing-counter')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    assert.ok(counter > 0.99, 'both O counters open after resting');
    await page.screenshot({ path: resolve(reports, 'journey-footer-name.png') });
    await scrollScene(page, '#features', 1);
    await page.clock.runFor(100);
    await page.locator('#install[data-brand-rest="false"]').waitFor();
    await waitForPhase('feature');
    assert.equal(await page.locator('#install').getAttribute('data-brand-rest'), 'false');
    assert.equal(await phase(), 'feature');
    const handoffs = [];
    for (const mode of ['footer', 'reverse']) {
      await scrollScene(page, '#features', mode === 'footer' ? 0 : 1);
      await page.clock.runFor(500);
      const origin = mode === 'footer' ? 'feature-tab-outline' : 'feature-tab-compatibility';
      await mascot.and(page.locator(`[data-target="${origin}"]`)).waitFor();
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 5000);
      await page.evaluate((mode) => {
        window.handoffFrames = new Promise((resolve) => {
          const node = document.querySelector('.brand-journey');
          const main = document.querySelector('#main');
          const points = [];
          let start;
          let firstFrame;
          let before;
          let crossedAt;
          const target = mode === 'footer' ? 'feature-tab-compatibility' : 'feature-tab-outline';
          document.getElementById(target).click();
          function record(now) {
            firstFrame ??= now;
            if (node.dataset.target === target) start ??= now;
            if (start === undefined) {
              if (now - firstFrame >= 3000) resolve({ mode, before, crossedAt, points });
              else requestAnimationFrame(record);
              return;
            }
            const matrix = new DOMMatrix(getComputedStyle(node).transform);
            const point = {
              time: now - start,
              x: matrix.e,
              y: matrix.f,
              opacity: Number(getComputedStyle(node).opacity),
              phase: main.dataset.brandPhase,
            };
            points.push(point);
            if (!before && now - start >= 96) {
              before = point;
              crossedAt = point.time;
              const section = document.querySelector('#features');
              scrollTo(
                0,
                mode === 'footer'
                  ? document.documentElement.scrollHeight
                  : scrollY + section.getBoundingClientRect().top - innerHeight * 0.5,
              );
              // Deliver the scroll notification before advancing the fake clock.
              dispatchEvent(new Event('scroll'));
            }
            if (now - start >= 800) resolve({ mode, before, crossedAt, points });
            else requestAnimationFrame(record);
          }
          requestAnimationFrame(record);
        });
      }, mode);
      await page.clock.runFor(4000);
      const sample = await page.evaluate(() => window.handoffFrames);
      await page.clock.resume();
      const outsideIndex = sample.points.findIndex(
        (p) => p.time > sample.crossedAt && p.phase !== 'feature',
      );
      assert.ok(outsideIndex > 0, 'the native scroll crosses the feature boundary');
      const firstOutside = sample.points[outsideIndex];
      const lastInside = sample.points[outsideIndex - 1];
      assert.ok(
        Math.hypot(firstOutside.x - lastInside.x, firstOutside.y - lastInside.y) < 35,
        `${mode}: crossing continues from the last painted position ${JSON.stringify({ lastInside, firstOutside })}`,
      );
      assert.ok(firstOutside.opacity > 0.5, `${mode}: the in-flight face remains visible`);
      assert.equal(sample.points.at(-1).phase, mode === 'footer' ? 'footer' : 'to-feature');
      handoffs.push(sample);
    }
    await writeFile(
      resolve(reports, 'journey-handoff-frames.json'),
      JSON.stringify(handoffs, null, 2),
    );
    await scrollScene(page, '#features', 1);
    await page.clock.runFor(500);
    await page.getByRole('tab', { name: '兼容集成', exact: true }).press('Home');
    await page.clock.runFor(500);
    await mascot.and(page.locator('[data-target="feature-tab-outline"]')).waitFor();
    assert.equal(await mascot.getAttribute('data-target'), 'feature-tab-outline');
    for (const width of [1063, 896]) {
      await page.setViewportSize({ width, height: width === 1063 ? 690 : 1079 });
      await frames(page);
      await scrollScene(page, '#features', 0);
      await page.clock.runFor(500);
      await page.waitForFunction(() => {
        const face = document.querySelector('.brand-journey svg').getBoundingClientRect();
        const tab = document.querySelector('#feature-tab-outline').getBoundingClientRect();
        return face.left >= 0 && face.right < tab.left - 6;
      });
      const face = await mascot.locator('svg').boundingBox();
      const icon = await page.locator('#feature-tab-outline svg').boundingBox();
      const tab = await page.locator('#feature-tab-outline').boundingBox();
      assert.ok(
        face.x >= 0 && face.x + face.width < icon.x,
        'narrow desktop landing stays visible and clears the functional icon',
      );
      assert.ok(
        face.x + face.width < tab.x - 6,
        'the mascot also clears the keyboard focus outline',
      );
      await page.screenshot({ path: resolve(reports, `journey-user-${width}.png`) });
    }
    await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    await page.clock.runFor(500);
    await page.screenshot({ path: resolve(reports, 'journey-dark.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(
      () => document.querySelector('#main').dataset.brandJourney === 'static',
    );
    assert.equal(await main.getAttribute('data-brand-journey'), 'static');
    assert.equal(await mascot.evaluate((el) => getComputedStyle(el).display), 'none');
  } finally {
    await page.close();
  }
});

test('compact pages keep normal flow and still finish the footer wordmark', async () => {
  const page = await newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  });
  try {
    await page.clock.install();
    await page.goto(`${base}/?lang=en`);
    await page.clock.runFor(7200);
    assert.equal(await page.locator('#main').getAttribute('data-brand-journey'), 'static');
    await page.screenshot({ path: resolve(reports, 'journey-mobile.png') });
    const footer = page.locator('#install');
    await footer.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await frames(page);
    await page.clock.runFor(3200);
    await page.locator('#install[data-brand-rest="true"]').waitFor();
    await page.waitForFunction(
      () =>
        new DOMMatrix(getComputedStyle(document.querySelector('.closing-counter')).transform).a >
        0.99,
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(reports, 'journey-mobile-footer.png') });
  } finally {
    await page.close();
  }
});

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
    await page.waitForFunction(() => {
      const progress = Number(document.querySelector('.studio-display-frame').dataset.progress);
      return progress > 0 && progress < 1;
    });
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
      await stand.and(page.locator('[data-progress="1"]')).waitFor();
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
    await scrollScene(page, '.opening-story', 0.8 / 3.5);
    await page.clock.runFor(1100);
    const hostComposer = page.locator('.layout-demo-host-composer');
    const hostInput = hostComposer.getByRole('textbox', { name: '聊天输入框', exact: true });
    const hostSend = hostComposer.getByRole('button', { name: '发送消息', exact: true });
    assert.equal(await hostSend.isDisabled(), true);
    await hostInput.fill('保留在显示器内的草稿');
    assert.equal(await hostInput.inputValue(), '保留在显示器内的草稿');
    await page.clock.runFor(500);
    assert.equal(await hostSend.isEnabled(), true);
    await page.screenshot({ path: resolve(reports, 'monitor-composer.png') });
    await hostSend.click();
    assert.equal(await hostInput.inputValue(), '');
    assert.equal(
      await hostComposer.locator('.preview-sent-message').innerText(),
      '保留在显示器内的草稿',
    );
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
  '阅读与网页',
  '提示词优化',
  '兼容集成',
];
test('shared menu controls preserve the tour and the tablet clips the same live workspace', async () => {
  const page = await newPage({
    viewport: { width: 924, height: 1079 },
    reducedMotion: 'no-preference',
  });
  try {
    await page.goto(`${base}/?lang=zh-CN`);
    await scrollScene(page, '.opening-story', 0.8 / 3.5);
    await page.getByRole('button', { name: '演示侧栏', exact: true }).click();
    const draft = page.locator('.layout-demo-host-composer textarea');
    await draft.fill('保留菜单操作前的草稿');
    const mode = page.getByLabel('演示字号模式', { exact: true });
    assert.equal(await mode.evaluate((el) => getComputedStyle(el).appearance), 'base-select');
    await mode.click();
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="演示字号模式"]')?.matches(':open'),
    );
    const menu = await mode.evaluate((el) => {
      const picker = getComputedStyle(el, '::picker(select)');
      return {
        background: picker.backgroundColor,
        width: parseFloat(picker.width),
        trigger: el.getBoundingClientRect().width,
        options: [...el.options].map((option) => ({
          height: option.getBoundingClientRect().height,
          width: option.getBoundingClientRect().width,
        })),
      };
    });
    assert.equal(menu.background, 'rgb(255, 255, 255)');
    assert.ok(Math.abs(menu.width - menu.trigger) < 1);
    assert.ok(
      menu.options.every((option) => option.height < 44),
      'short menu options stay on one line',
    );
    await page.screenshot({ path: resolve(reports, 'alignment-menu-924.png') });
    await page.keyboard.press('Escape');
    assert.equal(await mode.evaluate((el) => document.activeElement === el), true);
    await mode.click();
    await page.getByRole('option', { name: '自定字号', exact: true }).click();
    await page.getByLabel('演示自定字号').selectOption('18');
    assert.equal(await draft.inputValue(), '保留菜单操作前的草稿');
    assert.equal(
      await page.locator('.layout-demo-canvas').getAttribute('data-demo-placement'),
      'sidebar',
    );
    // A closed picker may keep focus; deliberate wheel input must release the tour.
    assert.equal(await mode.evaluate((el) => el.matches(':open')), false);
    await page.mouse.move(20, 600);
    await page.mouse.wheel(0, 1);
    await scrollScene(page, '.opening-story', 0.7);
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector('.surface-story').style.getPropertyValue('--material-progress'),
        ) > 0.5,
    );
    assert.equal(await page.getByLabel('演示自定字号').inputValue(), '18');
    await scrollScene(page, '.opening-story', 0.8 / 3.5);
    await page.getByRole('button', { name: '重置预览', exact: true }).click();
    await frames(page);
    await page.screenshot({ path: resolve(reports, 'alignment-sidebar-924.png') });
    const workspace = await page.locator('.layout-demo-window').elementHandle();
    await page.getByRole('button', { name: '演示移到副屏', exact: true }).click();
    await page.waitForFunction(
      () => Number(document.querySelector('.layout-demo-window').getAttribute('x')) === 754,
    );
    const corners = await page.locator('.layout-demo-window').evaluate((el) => {
      const clip = el.querySelector('[data-device-viewport]');
      const screen = document.querySelector('.demo-tablet-screen');
      const box = el.getBoundingClientRect();
      return {
        radius: clip.dataset.screenRadius,
        screenRadius: screen.getAttribute('rx'),
        corner: clip.contains(document.elementFromPoint(box.x + 1, box.y + 1)),
        center: clip.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        ),
        bounds: box.toJSON(),
        hit: document
          .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          ?.outerHTML.slice(0, 300),
      };
    });
    await page.screenshot({ path: resolve(reports, 'alignment-tablet-924.png') });
    await writeFile(resolve(reports, 'alignment-corners.json'), JSON.stringify(corners, null, 2));
    assert.equal(corners.radius, corners.screenRadius);
    assert.ok(Number(corners.radius) > 10);
    assert.equal(
      corners.corner,
      false,
      'square content cannot paint or receive input through a rounded corner',
    );
    assert.equal(corners.center, true, 'the clipped live workspace remains interactive');
    await page
      .locator('.layout-demo-window')
      .getByRole('button', { name: '拆解第一版', exact: true })
      .click();
    assert.ok((await page.locator('.layout-demo-window textarea').inputValue()).includes('作品集'));
    assert.equal(
      await workspace.evaluate((el) => el === document.querySelector('.layout-demo-window')),
      true,
    );
    assert.equal(await draft.inputValue(), '保留菜单操作前的草稿');
    await page.screenshot({ path: resolve(reports, 'alignment-tablet-924.png') });
    await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    await page.screenshot({ path: resolve(reports, 'alignment-tablet-dark.png') });
    await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
    await page.getByRole('button', { name: 'Preview sidebar', exact: true }).click();
    await frames(page);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.settings-segment-indicator')].every((el) =>
        el.getAnimations().every((animation) => animation.playState !== 'running'),
      ),
    );
    await page.screenshot({ path: resolve(reports, 'alignment-sidebar-en.png') });
    const englishMode = page.getByLabel('Demo font sizing', { exact: true });
    await englishMode.click();
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="Demo font sizing"]')?.matches(':open'),
    );
    await page.screenshot({ path: resolve(reports, 'alignment-menu-en.png') });
    assert.ok(
      await englishMode.evaluate((el) =>
        [...el.options].every((option) => option.getBoundingClientRect().height < 44),
      ),
      'English menu options also stay on one line',
    );
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await scrollScene(page, '.opening-story', 0.8 / 3.5);
    await page.locator('.workspace-placement-select select').selectOption('sidebar');
    await englishMode.click();
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="Demo font sizing"]')?.matches(':open'),
    );
    await page.screenshot({ path: resolve(reports, 'alignment-menu-mobile.png') });
    const menuBounds = await englishMode.evaluate((el) =>
      [...el.options].map((option) => option.getBoundingClientRect().toJSON()),
    );
    assert.ok(
      menuBounds.every((box) => box.left >= 0 && box.right <= 390),
      'the mobile picker stays in the viewport',
    );
  } finally {
    await page.close();
  }
});
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

test('one settings-based preview and the settings-ordered tabs replace the combined scenes', async () => {
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
    assert.equal(await page.locator('.feature-panel:not([aria-hidden="true"])').count(), 1);
    assert.equal(await page.locator('[data-settings-feature]').count(), 6);
    assert.equal(await page.locator('.brand-opening').count(), 1);
    const bounds = await page.locator('.feature-pin').boundingBox();
    assert.ok(Math.abs(bounds.y) < 2, 'direct features link lands at the stage');
    for (const id of ids) {
      await select(page, id);
      assert.equal(await page.locator('.feature-panel:not([aria-hidden="true"])').count(), 1);
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
    for (const index of [1, 2, 3, 4, 5, 6, 7, 8, lastFeatureIndex, 6, 4, 2, 0]) {
      await scrollScene(page, '#features', index / lastFeatureIndex);
      await page.locator(`#feature-tab-${ids[index]}[aria-selected=true]`).waitFor();
      await page.locator('.feature-panel[data-active=true]').waitFor({ state: 'visible' });
      const current = await page.locator('.feature-navigation').boundingBox();
      assert.ok(Math.abs(current.y - initial.y) < 2 && Math.abs(current.x - initial.x) < 2);
      assert.equal(await page.locator('.feature-panel:not([aria-hidden="true"])').count(), 1);
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
    assert.equal(await page.locator('.feature-panel[inert]').count(), lastFeatureIndex);
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
    await scrollScene(page, '#features', 5 / lastFeatureIndex);
    await page.locator('#feature-tab-model[aria-selected=true]').waitFor();
    await scrollScene(page, '#features', 1 / lastFeatureIndex);
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
    await page.waitForFunction(() =>
      document
        .querySelector('#feature-panel-prompts .preview-composer textarea')
        ?.value.includes('保留已经确认的视觉风格'),
    );
    assert.match(
      await phrases.locator('.preview-composer textarea').inputValue(),
      /保留已经确认的视觉风格/,
    );
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
    assert.equal(
      await phrases.locator('.preview-palboo textarea').inputValue(),
      '保留我没有保存的指令',
    );
    assert.equal(await phrases.locator('.preview-composer textarea').count(), 1);
  } finally {
    await page.close();
  }
});

test('outline and next step run the settings preview commands in memory', async () => {
  const page = await site();
  try {
    const outline = panel(page, 'outline');
    assert.equal(await outline.locator('.csw-outline-row[data-outline-id]').count(), 9);
    assert.equal(await outline.getByRole('listitem').getByRole('button').count(), 9);
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
    assert.equal(await outline.locator('.preview-composer textarea').inputValue(), '');
    await select(page, 'next');
    const next = panel(page, 'next');
    await next.getByRole('button', { name: /^拆解第一版/ }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('#feature-panel-next .preview-composer textarea')
        ?.value.includes('两天的任务清单'),
    );
    assert.match(await next.locator('.preview-composer textarea').inputValue(), /两天的任务清单/);
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
    const groups = await board
      .locator('.board-column')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
    assert.ok(
      groups.slice(1).every((g, i) => g.top >= groups[i].bottom),
      'stacked groups cannot overlap',
    );
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
    assert.equal(await model.locator('.model-row').count(), 12);
    for (const level of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
      assert.ok(await model.locator(`[data-reasoning="${level}"]`).count(), level);
    assert.doesNotMatch(await model.innerText(), /示例模型|均为示例|上次测速/);
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
    const promoted = agents.getByRole('menuitemradio', { name: 'Antigravity CLI', exact: true });
    assert.equal(await promoted.getAttribute('aria-checked'), 'true');
    assert.equal(
      await promoted.evaluate((n) => !!n.closest('[role=group]')),
      false,
      'available Agent moves above More',
    );
    await agents.locator('[role=menuitemradio][aria-checked=true]:focus').waitFor();
    assert.equal(await focused(promoted), true);
    await select(page, 'model');
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
  } finally {
    await page.close();
  }
});

test('the reader preview opens linked notes, edits a draft and switches sheets without requests', async () => {
  const page = await site({ viewport: { width: 1032, height: 1079 } });
  try {
    await select(page, 'sites');
    const library = panel(page, 'sites');
    await library.getByRole('heading', { name: '作品集计划', exact: true }).waitFor();
    assert.equal(await library.locator('.reader-tree li > button').count(), 5);
    assert.equal(await library.locator('.reader-properties .reader-tag').count(), 2);
    assert.equal(
      await library.locator('details[data-callout=tip]').evaluate((node) => node.open),
      true,
    );
    const resize = library.getByRole('separator');
    await resize.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await resize.getAttribute('aria-valuenow'), '244');
    const search = library.getByRole('searchbox', { name: '搜索笔记' });
    await search.fill('不存在的笔记');
    await library.getByRole('status').filter({ hasText: '没有匹配的笔记' }).waitFor();
    await search.fill('');
    const linked = library.getByRole('link', { name: '阅读工具', exact: true });
    await linked.hover();
    const preview = library.getByRole('dialog', { name: '链接预览', exact: true });
    await preview.getByRole('button', { name: '打开笔记', exact: true }).waitFor();
    await preview.getByRole('button', { name: '打开笔记', exact: true }).click();
    await library.getByRole('heading', { name: '阅读工具', exact: true }).waitFor();
    await library.locator('.reader-diagram').scrollIntoViewIfNeeded();
    await library.locator('.reader-diagram[data-state=ready]').waitFor();
    await library.locator('.reader-math-display').scrollIntoViewIfNeeded();
    await library.locator('.reader-math-display[data-state=ready]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('16px KaTeX_Main')), true);
    await library.getByRole('tab', { name: '最近', exact: true }).click();
    assert.equal(await library.locator('.reader-sidebar-recent button').count(), 2);
    await library.getByRole('tab', { name: '文件', exact: true }).click();
    await library.getByRole('button', { name: '后退', exact: true }).click();
    await library.getByRole('heading', { name: '作品集计划', exact: true }).waitFor();
    await library.getByRole('button', { name: '前进', exact: true }).click();
    await library.getByRole('button', { name: '阅读信息', exact: true }).click();
    const info = library.getByRole('dialog', { name: '阅读信息', exact: true });
    await info.getByRole('tab', { name: '反向链接' }).click();
    assert.ok((await info.locator('.reader-backlinks button').count()) > 0);
    await page.keyboard.press('Escape');

    await library.getByRole('heading', { name: '阅读工具', exact: true }).waitFor();
    await library.getByRole('button', { name: '编辑笔记' }).click();
    const input = library.locator('.reader-editor textarea');
    const draft = '# 我的案例草稿\n\n保留这段修改。\n\n![图片说明](http://127.0.0.1:9/private.png)';
    await input.fill(draft);
    await library.getByRole('tab', { name: '设计参考' }).click();
    await library.getByRole('heading', { name: '让作品自己说话' }).waitFor();
    assert.equal(await input.isVisible(), false);
    await library.getByRole('tab', { name: '本地笔记' }).click();
    await select(page, 'outline');
    await select(page, 'sites');
    assert.equal(await input.inputValue(), draft);
    await page.locator('.site-language').click();
    assert.equal(await input.inputValue(), draft);
    await select(page, 'sites');
    await library.getByRole('button', { name: 'Done editing' }).click();
    await library.getByRole('heading', { name: '我的案例草稿' }).waitFor();
    await library.getByText('图片说明', { exact: true }).waitFor();
    await page.locator('.site-language').click();
    await select(page, 'sites');
    await library.getByRole('button', { name: '素材清单', exact: true }).click();
    await library.getByRole('heading', { name: '素材清单.xlsx' }).waitFor();
    assert.equal(await library.locator('.reader-sheet-scroll tbody tr').count(), 7);
    await library.getByRole('combobox', { name: '工作表' }).selectOption('文字');
    await library.getByRole('cell', { name: '个人贡献', exact: true }).waitFor();
    assert.equal(await library.locator('.reader-sheet-scroll tbody tr').count(), 4);
    await page.screenshot({ path: resolve(reports, 'library-workbook.png') });
    await library.getByRole('button', { name: '阅读工具', exact: true }).click();
    await library.getByRole('heading', { name: '我的案例草稿' }).waitFor();
    await library.getByRole('button', { name: '作品集计划', exact: true }).click();
    await library.getByRole('heading', { name: '作品集计划', exact: true }).waitFor();
    await page.screenshot({ path: resolve(reports, 'library-user-1032.png') });
    const nav = page.locator('#feature-tab-sites span').last();
    assert.ok((await nav.boundingBox()).height < 25, 'short navigation label stays on one line');
  } finally {
    await page.close();
  }
});

test('the narrow reader keeps navigation, editing and tab keyboard controls reachable', async () => {
  const page = await site({ viewport: { width: 390, height: 844 } });
  try {
    await select(page, 'sites');
    const library = panel(page, 'sites');
    await library.getByRole('heading', { name: '作品集计划' }).waitFor();
    assert.equal(await library.getByRole('searchbox').isVisible(), false);
    await library.getByRole('button', { name: '目录与搜索', exact: true }).click();
    await library.getByRole('searchbox').waitFor();
    await library.getByRole('button', { name: '阅读工具', exact: true }).press('Enter');
    await library.getByRole('heading', { name: '阅读工具', exact: true }).waitFor();
    assert.equal(await library.getByRole('searchbox').isVisible(), false);
    assert.equal(await focused(library.locator('.reader-main').first()), true);
    await library.getByRole('button', { name: '编辑笔记' }).click();
    await library
      .getByRole('textbox', { name: '编辑 Markdown' })
      .fill('# 手机草稿\n\n在窄屏里继续编辑。');
    await library.getByRole('button', { name: '完成编辑' }).click();
    await library.getByRole('heading', { name: '手机草稿' }).waitFor();
    const notes = library.getByRole('tab', { name: '本地笔记' });
    await notes.focus();
    await page.keyboard.press('ArrowRight');
    const reference = library.getByRole('tab', { name: '设计参考' });
    assert.equal(await reference.getAttribute('aria-selected'), 'true');
    assert.equal(await focused(reference), true);
    await library.getByRole('heading', { name: '让作品自己说话' }).waitFor();
    await page.screenshot({ path: resolve(reports, 'library-web-mobile.png') });
    await page.keyboard.press('Home');
    await library.getByRole('heading', { name: '手机草稿' }).waitFor();
    await page.locator('.site-theme').click();
    await select(page, 'sites');
    await page.screenshot({ path: resolve(reports, 'library-mobile-dark.png') });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
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
    await model.locator('.model-preset-tag .model-preset-choice').first().click();
    await model.getByRole('textbox', { name: '预设名称', exact: true }).fill('我的保留预设');
    await model.getByRole('textbox', { name: '预设名称', exact: true }).press('Enter');
    await model.getByRole('button', { name: '编辑预设', exact: true }).click();
    await page.locator('.site-language').click();
    await select(page, 'model');
    assert.match(
      await model.locator('.model-preset-tag .model-preset-choice').first().innerText(),
      /我的保留预设/,
    );
    assert.match(
      await model.locator('.model-preset-tag .model-preset-choice').nth(1).innerText(),
      /Deep analysis/,
    );
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    assert.equal(await fast.getAttribute('aria-pressed'), 'true');
    assert.match(await choice.getAttribute('aria-label'), /Model C/i);
    await page.locator('.site-language').click();
    await select(page, 'model');
    assert.match(
      await model.locator('.model-preset-tag .model-preset-choice').nth(1).innerText(),
      /深入分析/,
    );
  } finally {
    await page.close();
  }
});

test('chat previews keep Palboo on the right and expose editable input with local sending', async () => {
  const page = await site();
  try {
    for (const id of ['outline', 'next', 'prompts', 'terms', 'board', 'bots']) {
      await select(page, id);
      const scene = panel(page, id);
      const chat = await scene.locator('.preview-chat').boundingBox();
      const palboo = await scene.locator('.preview-palboo').boundingBox();
      assert.ok(chat.x + chat.width < palboo.x, `${id}: chat left, Palboo right`);
      assert.ok((await scene.locator('.preview-chat-answer ol li').count()) >= 3);
      const input = scene.getByRole('textbox', { name: '聊天输入框', exact: true });
      const send = scene.getByRole('button', { name: '发送消息', exact: true });
      assert.equal(await send.isDisabled(), true);
      await input.fill('这是保留的草稿');
      await select(page, id === 'outline' ? 'next' : 'outline');
      await select(page, id);
      assert.equal(await input.inputValue(), '这是保留的草稿');
      await send.click();
      assert.equal(await input.inputValue(), '');
      assert.equal(await scene.locator('.preview-sent-message').innerText(), '这是保留的草稿');
    }
    const backgrounds = await page.evaluate(() => [
      getComputedStyle(document.querySelector('#install')).backgroundColor,
      getComputedStyle(document.documentElement).backgroundColor,
    ]);
    assert.equal(backgrounds[0], backgrounds[1]);
  } finally {
    await page.close();
  }
});

test('terms mark the conversation and open the real hover card without taking over the host controller', async () => {
  const page = await site();
  try {
    await page.evaluate(() => {
      window.__palbooTerminology = {
        sentinel: true,
        destroy() {
          throw Error('real host controller must survive');
        },
      };
    });
    await select(page, 'terms');
    await page.waitForFunction(() =>
      [...CSS.highlights].some(
        ([name, ranges]) => name.startsWith('palboo-preview-terms-') && ranges.size,
      ),
    );
    const point = await page.evaluate(() => {
      for (const [name, ranges] of CSS.highlights) {
        if (!/^palboo-preview-terms-\d+$/.test(name)) continue;
        for (const range of ranges)
          if (range.toString() === '响应式布局') {
            const rect = range.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
      }
    });
    assert.ok(point, 'real text range is highlighted');
    await page.mouse.move(point.x, point.y);
    const popup = page.locator('.term-popover[data-open=true]');
    await popup.waitFor();
    assert.match(await popup.innerText(), /Responsive layout/);
    await page.screenshot({ path: resolve(reports, 'desktop-terms-hover.png') });
    await select(page, 'next');
    assert.equal(
      await page.evaluate(() =>
        [...CSS.highlights.keys()].some((key) => key.startsWith('palboo-preview-terms-')),
      ),
      false,
    );
    assert.equal(await page.evaluate(() => window.__palbooTerminology.sentinel), true);
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
    await scrollScene(page, '#features', 4 / lastFeatureIndex);
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
    await panel(page, 'next').locator('.preview-composer textarea').waitFor();
    await select(page, 'prompts');
    const phrases = panel(page, 'prompts');
    await phrases.evaluate((node) =>
      Promise.all(node.getAnimations().map((animation) => animation.finished)),
    );
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
  [1032, 1079, 'zh-CN'],
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
        if (id === 'sites') {
          const library = panel(page, id);
          const heading = await library.locator('.reader-markdown h1').first().boundingBox();
          assert.ok(
            heading && heading.x >= b.x && heading.x + heading.width <= b.x + b.width,
            'reader title fits inside the actual preview',
          );
          await page.screenshot({ path: resolve(reports, `library-${width}-${language}.png`) });
        }
        if (width === 1609) await page.screenshot({ path: resolve(reports, `feature-${id}.png`) });
      }
      await select(page, 'prompts');
      if (width <= 420) {
        const answer = await panel(page, 'prompts').locator('.preview-chat-answer').boundingBox();
        const thirdPoint = await panel(page, 'prompts')
          .locator('.preview-chat-answer ol li')
          .nth(2)
          .boundingBox();
        assert.ok(
          thirdPoint.y + thirdPoint.height <= answer.y + answer.height,
          `mobile initially shows a complete numbered answer ${JSON.stringify({ answer, thirdPoint })}`,
        );
      }
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

test('narrow model previews label each reasoning choice beside its model', async () => {
  const page = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  try {
    await page.goto(`${base}/?lang=zh-CN`);
    await page.getByRole('tab', { name: '模型切换', exact: true }).click();
    const panel = page.locator('#feature-panel-model');
    const high = panel.getByRole('button', { name: '模型 A · High', exact: true });
    await high.focus();
    await frames(page);
    assert.equal(await high.evaluate((el) => getComputedStyle(el, '::after').content), '"High"');
    const name = await panel.locator('.model-name').first().boundingBox();
    assert.ok(name.x >= 0 && name.x + name.width <= 390, 'model names remain beside their choices');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await high.press('Enter');
    assert.equal(await high.getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: resolve(reports, 'review-model-mobile.png') });
  } finally {
    await page.close();
  }
});
