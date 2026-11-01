/* [INPUT]: Built native entry, real desktop/edge shells and synthetic authenticated font/state APIs.
 * [OUTPUT]: Effective per-window families/sizes reach header and Shadow DOM; polling, notch geometry, reload and cleanup preserve font ownership.
 * [POS]: Isolated browser documents; no real settings, host contents or proprietary font bytes.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const defaults = { fontFamily: '', mode: 'follow', source: 'body', scale: 100, customSize: 16 };
const raw = {
  fontFamily: '"OpenAI Sans", sans-serif',
  fontSize: 18,
  fontWeight: '400',
  lineHeight: 27,
  titleFamily: '"OpenAI Sans", sans-serif',
  titleSize: 18,
  titleWeight: '600',
  letterSpacing: 'normal',
  zoom: 1,
  source: 'body',
};
raw.sources = {
  body: { ...raw },
  composer: { ...raw, fontFamily: '"OpenAI Serif", serif', fontSize: 20, lineHeight: 30 },
};
const catalog = [
  { id: 'openai-sans-regular', family: 'OpenAI Sans', weight: 400, style: 'normal' },
  { id: 'openai-sans-semibold', family: 'OpenAI Sans', weight: 600, style: 'normal' },
  { id: 'openai-serif-light', family: 'OpenAI Serif', weight: 300, style: 'normal' },
];

test(
  'native documents load the effective window fonts without remounting content or resetting preferences',
  { timeout: 60000 },
  async (t) => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const windows = {};
    for (const placement of ['desktop', 'edge']) {
      const page = await browser.newPage({ viewport: { width: 920, height: 780 } });
      page.setDefaultTimeout(10000);
      const preferences = { ...defaults },
        calls = [],
        errors = [],
        writes = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const appearance = () => ({
        typography: raw,
        // Main-window preferences may differ from the standalone edge window.
        typographyPreferences:
          placement === 'desktop' ? preferences : { ...defaults, mode: 'custom', customSize: 29 },
        edgeTypographyPreferences: preferences,
        themes: { desktop: { theme: 'matte' }, edge: { theme: 'matte' } },
        theme: 'light',
        language: 'zh-CN',
        colors: { text: '#1f2328', 'surface-opaque': '#fff' },
      });
      await page.route('http://native-fonts.test/**', async (route) => {
        const req = route.request(),
          path = new URL(req.url()).pathname;
        if (path === '/api/host-fonts' || path.startsWith('/api/host-fonts/')) {
          calls.push({ path, auth: req.headers().authorization, url: req.url() });
          return path === '/api/host-fonts'
            ? route.fulfill({ json: { fonts: catalog } })
            : route.fulfill({ contentType: 'font/woff2', body: Buffer.alloc(64) });
        }
        if (path === '/api/features') {
          const input = req.postDataJSON();
          if (input.op === 'main-window')
            return route.fulfill({ json: { valid: true, alwaysOnTop: true } });
          if (input.op === 'main-anchor') return route.fulfill({ json: { anchor: null } });
          if (input.op === 'read')
            return route.fulfill({
              json: {
                entries: [],
                preferences: { favorites: [], mastered: [] },
                involved: [],
                appearance: { ...appearance(), typographyPreferences: preferences },
              },
            });
          if (input.op === 'state')
            return route.fulfill({
              json: {
                appearance: appearance(),
                mainPlacement: placement,
                mainWindow: { size: [840, 620] },
                features: [
                  {
                    id: 'terms',
                    placement,
                    owner: 'fixture',
                    open: true,
                    pending: null,
                    size: [400, 500],
                    view: {},
                    reveal: 0,
                  },
                ],
                edgeTabs: { order: ['terms'], selected: 'terms' },
                edgeTabsRevision: 1,
              },
            });
          writes.push(input);
          return route.fulfill({ json: {} });
        }
        if (path === '/feature.html' || path.startsWith('/assets/')) {
          return route.fulfill({
            contentType: path.endsWith('.html')
              ? 'text/html'
              : path.endsWith('.css')
                ? 'text/css'
                : 'text/javascript',
            body: await readFile(`target/web${path}`),
          });
        }
        return route.fulfill({ status: 404, body: '' });
      });
      await page.addInitScript(() => {
        window.fontFaces = new Set();
        Object.defineProperty(document, 'fonts', {
          value: {
            add: (face) => window.fontFaces.add(face),
            delete: (face) => window.fontFaces.delete(face),
          },
        });
        window.FontFace = class {
          constructor(family, source, descriptors) {
            Object.assign(this, { family, source, ...descriptors });
          }
          async load() {
            this.status = 'loaded';
            return this;
          }
        };
      });
      await page.goto(
        `http://native-fonts.test/feature.html?${placement === 'edge' ? 'surface=edge' : 'feature=main'}&lease=fixture#token=native-font-fixture`,
      );
      await page.locator('.feature-view').waitFor({ state: 'attached' });
      if (placement === 'edge')
        await page.evaluate(() => {
          window.edgeGeometry = (notch, expanded = true) =>
            window.dispatchEvent(
              new CustomEvent('edge-native', {
                detail: {
                  expanded,
                  unfold: expanded ? 1 : 0,
                  sceneRevision: notch ? 2 : 1,
                  notch,
                  layoutX: 0,
                  layoutY: 0,
                  layoutWidth: 560,
                  layoutHeight: 620,
                  compactWidth: notch ? 180 : 16,
                  compactHeight: 32,
                  theme: 'matte',
                  appearance: { hostTheme: { theme: 'light' } },
                },
              }),
            );
          window.edgeGeometry(false);
        });
      await page.waitForFunction(() => window.fontFaces.size === 2);
      await page
        .locator('.feature-view')
        .evaluate((node) => (node.dataset.fontIdentity = 'retained'));
      const header = page.locator(placement === 'desktop' ? '#root' : '#edge-panel');
      assert.equal(await header.evaluate((node) => getComputedStyle(node).fontSize), '18px');
      assert.equal(
        await page.locator('.feature-view').evaluate((node) => getComputedStyle(node).fontSize),
        '18px',
      );
      assert.equal(calls.length, 3);
      assert.ok(
        calls.every(
          (call) => call.auth === 'Bearer native-font-fixture' && !call.url.includes('token'),
        ),
      );
      windows[placement] = { page, preferences, calls, errors, writes, header };
    }
    const desktop = windows.desktop,
      edge = windows.edge;
    Object.assign(desktop.preferences, {
      fontFamily: '"Codex selected ArialMT", Arial',
      mode: 'custom',
      customSize: 24,
    });
    Object.assign(edge.preferences, { source: 'composer', scale: 110 });
    for (const [window, size, family] of [
      [desktop, '24px', 'Arial'],
      [edge, '22px', 'OpenAI Serif'],
    ]) {
      await window.page.waitForFunction(
        ({ size, family }) => {
          const node = [...document.querySelectorAll('*')]
            .map((n) => n.shadowRoot?.querySelector('.feature-view'))
            .find(Boolean);
          return (
            node &&
            getComputedStyle(node).fontSize === size &&
            getComputedStyle(node).fontFamily.includes(family)
          );
        },
        { size, family },
      );
      assert.equal(await window.header.evaluate((node) => getComputedStyle(node).fontSize), size);
      assert.equal(
        await window.page.locator('.feature-view').getAttribute('data-font-identity'),
        'retained',
      );
    }
    await edge.page.waitForFunction(() =>
      [...window.fontFaces].some((face) => face.family === 'OpenAI Serif'),
    );
    assert.equal(
      desktop.calls.length,
      3,
      'custom local aliases do not refetch an unchanged packaged fallback',
    );
    assert.equal(edge.calls.length, 5, 'selected composer source loads Serif only');
    await edge.page.evaluate(() => {
      window.edgeGeometry(true, false);
      window.edgeGeometry(true);
    });
    assert.equal(
      await edge.header.evaluate((node) => getComputedStyle(node).fontSize),
      '22px',
      'notch geometry does not overwrite typography',
    );
    await edge.page.waitForTimeout(1300);
    assert.equal(edge.calls.length, 5, 'state polling and geometry do not reload fonts');
    assert.equal(
      await edge.page.locator('.feature-view').getAttribute('data-font-identity'),
      'retained',
    );
    await desktop.page.reload();
    await desktop.page.waitForFunction(() =>
      [...window.fontFaces].some((face) => face.family === 'Codex selected ArialMT'),
    );
    assert.equal(await desktop.header.evaluate((node) => getComputedStyle(node).fontSize), '24px');
    for (const window of Object.values(windows)) {
      assert.deepEqual(window.errors, []);
      assert.equal(
        window.writes.filter((input) => ['appearance', 'layout', 'action'].includes(input.op))
          .length,
        0,
      );
      await window.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      assert.equal(
        await window.page.evaluate(() => window.fontFaces.size),
        0,
        'document exit removes owned font faces',
      );
    }
  },
);
