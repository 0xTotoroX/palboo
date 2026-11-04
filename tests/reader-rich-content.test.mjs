/* [INPUT]: Built reader, synthetic notes and isolated browser storage/network.
 * [OUTPUT]: Recent navigation, lazy local math/diagrams, source fallback and resource-boundary acceptance.
 * [POS]: No real notes, credentials or host; captures contain synthetic content only.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
const reports = resolve('target/reports/reader-rich-content');
const output = resolve(reports, `web-${process.pid}`);
const fence = (source) => `\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
const invalid = [
  'flowchart LR\n A --> [',
  'flowchart LR\n A@{ img: "https://outside.invalid/image.png" }',
  '%%{init: { "securityLevel": "loose" }}%%\nflowchart LR\n A --> B',
  '---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\n A --> B',
  'flowchart LR\n A["<img src=x onerror=alert(1)>"]',
  'flowchart LR\n A --> B\n style A fill:u\\72l(https://outside.invalid/x)',
  'flowchart LR\n A@{ "img": "&#104;ttps://outside.invalid/x" }',
  'flowchart LR\n A --> B\n classDef x fill:url(/api/private)',
  'flowchart LR; A --> B; style A fill:u\\72l(/api/private)',
];
const notes = [
  {
    id: '项目/计划.md',
    title: '计划',
    markdown: '# 普通笔记\n\n普通文字与 `code`，价格 $5。\n\n[[来源]]',
  },
  { id: '来源.md', title: '来源', markdown: '# 来源\n\n没有公式与图表。' },
  {
    id: 'rich.md',
    title: '数学与图表',
    markdown:
      String.raw`# 数学与图表

行内公式 $E = mc^2$，价格 $5。

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

> [!tip]+ 提示
> 主题切换应保留展开状态。
` +
      fence('flowchart LR\n A[搜索] --> B[阅读]\n B --> C[摘录]\n C --> B') +
      fence(
        'sequenceDiagram\n participant A as Reader\n participant B as Library\n A->>B: Open\n B-->>A: Note',
      ) +
      '\n```text\n$not math$\n```\n' +
      '\n\n正文段落。'.repeat(40),
  },
  {
    id: 'unsafe.md',
    title: '错误与限制',
    markdown:
      '# 错误与限制\n\n' +
      invalid.map(fence).join('') +
      String.raw`
$$\unknownCommand{x}$$

$$\def\a{\a}\a$$

$$\includegraphics{https://outside.invalid/math.png}$$
`,
  },
].map((note) => ({ ...note, version: 'v1', backlinks: [], kind: 'markdown' }));
notes.push({ id: 'table.csv', title: '数据表', kind: 'spreadsheet' });
let browser, server, base;
test.before(async () => {
  await mkdir(reports, { recursive: true });
  await build({
    configFile: 'ui/settings/vite.config.ts',
    logLevel: 'error',
    build: {
      outDir: output,
      rollupOptions: { input: { reader: resolve('ui/settings/reader.html') } },
    },
  });
  server = await preview({
    configFile: 'ui/settings/vite.config.ts',
    logLevel: 'error',
    build: { outDir: output },
    preview: { host: '127.0.0.1', port: 0 },
  });
  base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chromium', headless: true });
});
test.after(async () => {
  await browser?.close();
  await new Promise((done) => {
    if (!server) return done();
    server.httpServer.close(done);
    server.httpServer.closeAllConnections();
  });
  await rm(output, { recursive: true, force: true });
});
async function setup(t, id = notes[0].id, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1320, height: 1000 },
    locale: 'zh-CN',
    permissions: ['clipboard-read', 'clipboard-write'],
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [],
    outside = [],
    resources = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to load/.test(message.text()))
      errors.push(message.text().slice(0, 180));
  });
  page.on('request', (request) => resources.push(request.url()));
  await page.addInitScript(() => {
    localStorage.setItem(
      'palboo-reader-recent:obsidian',
      JSON.stringify(['missing.md', '来源.md']),
    );
    localStorage.setItem('palboo-reader-recent:other', JSON.stringify(['secret.md']));
    window.liveBlobs = new Set();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      window.liveBlobs.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.liveBlobs.delete(url);
      revoke(url);
    };
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) {
      outside.push(url.origin);
      return route.abort();
    }
    if (url.pathname === '/reader.html') {
      const response = await route.fetch();
      return route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: http: https:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        },
      });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let value;
    if (url.pathname === '/api/catalog')
      value = {
        name: '合成笔记',
        notes,
        revision: 1,
        skipped: 0,
        language: options.locale === 'en' ? 'en' : 'zh-CN',
      };
    else if (url.pathname === '/api/note')
      value = notes.find((note) => note.id === url.searchParams.get('id'));
    else if (url.pathname === '/api/workbook')
      value = {
        sheets: ['Sheet1'],
        sheet: 'Sheet1',
        rows: [
          ['Name', 'Value'],
          ['A', '1'],
        ],
        offset: 0,
        startRow: 0,
        startColumn: 0,
        totalRows: 2,
        totalColumns: 2,
      };
    else if (url.pathname === '/api/search') value = { total: 1, offset: 0, results: [notes[1]] };
    else if (url.pathname === '/api/resolve') value = { candidates: [notes[1]], anchor: '' };
    else if (url.pathname === '/api/preview')
      value = { candidates: [notes[1]], total: 1, excerpt: '摘要', anchor: '' };
    else throw new Error(`unexpected API: ${url.pathname}`);
    return route.fulfill({ json: value });
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no page or CSP errors');
    assert.deepEqual(outside, [], 'no external requests');
  });
  await page.goto(`${base}/reader.html?folder=obsidian&note=${encodeURIComponent(id)}`);
  await page.locator('.reader-markdown h1').waitFor();
  return { page, resources };
}
test('files/recent tabs preserve tree state, share history and restore the tab after unified search', async (t) => {
  const { page, resources } = await setup(t);
  const nav = page.locator('.reader-sidebar');
  const files = nav.getByRole('tab', { name: '文件', exact: true });
  const recent = nav.getByRole('tab', { name: '最近', exact: true });
  await files.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await recent.getAttribute('aria-selected'), 'true');
  assert.equal(await recent.evaluate((node) => node === document.activeElement), true);
  assert.deepEqual(await nav.locator('.reader-sidebar-recent button').allTextContents(), [
    '计划项目/计划.md',
    '来源来源.md',
  ]);
  await nav.getByRole('searchbox').fill('来源');
  await nav.getByRole('navigation', { name: '搜索结果' }).waitFor();
  assert.equal(await page.getByRole('searchbox').count(), 1);
  await nav.getByRole('button', { name: '清除搜索' }).click();
  assert.equal(await recent.getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: '定位当前笔记' }).click();
  assert.equal(await files.getAttribute('aria-selected'), 'true');
  assert.equal(await nav.locator('details[open]').count(), 1);
  await recent.click();
  await files.click();
  assert.equal(await nav.locator('details[open]').count(), 1);
  await recent.click();
  await nav.locator('.reader-sidebar-recent button').last().click();
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  assert.equal(
    await nav.locator('.reader-sidebar-recent button').first().getAttribute('aria-current'),
    'page',
  );
  await files.click();
  await nav.getByRole('button', { name: '数据表', exact: true }).click();
  await page.getByRole('cell', { name: 'Value', exact: true }).waitFor();
  await recent.click();
  assert.match(await nav.locator('.reader-sidebar-recent button').first().textContent(), /数据表/);
  assert.ok(
    !resources.some((url) => /(?:diagram-engine|math-engine|KaTeX_)/.test(url)),
    'ordinary notes do not load rendering engines or fonts',
  );
});
test('local math and Mermaid render, copy source, zoom and follow theme without replacing the article', async (t) => {
  const { page, resources } = await setup(t, 'rich.md');
  await page.locator('.reader-math-display[data-state=ready]').waitFor();
  const diagrams = page.locator('.reader-diagram');
  await diagrams.nth(1).scrollIntoViewIfNeeded();
  await page.locator('.reader-diagram[data-state=ready]').nth(1).waitFor();
  assert.equal(await page.locator('.reader-math .katex').count(), 2);
  assert.equal(await page.locator('.reader-code-block pre').last().textContent(), '$not math$\n');
  assert.equal(
    await page
      .locator('.reader-diagram-zoom img')
      .evaluateAll((nodes) => nodes.every((n) => n.complete && n.naturalWidth > 0)),
    true,
  );
  const first = diagrams.first();
  await first.getByRole('button', { name: '复制代码' }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /flowchart LR/);
  await first.getByRole('button', { name: '源码', exact: true }).click();
  assert.match(await first.locator('pre').textContent(), /搜索/);
  await first.getByRole('button', { name: '图表', exact: true }).click();
  await first.getByRole('button', { name: '放大图表' }).click();
  assert.equal(await page.locator('.reader-diagram-dialog[open]').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.reader-diagram-dialog[open]').count(), 0);
  const previous = await first.locator('.reader-diagram-zoom img').getAttribute('src');
  await page.locator('.reader-callout summary').click();
  await page.evaluate(() => {
    window.originalArticle = document.querySelector('.reader-markdown');
  });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.waitForFunction(
    (old) => document.querySelector('.reader-diagram-zoom img')?.getAttribute('src') !== old,
    previous,
  );
  await page.locator('.reader-diagram[data-state=ready]').nth(1).waitFor();
  assert.equal(
    await page.evaluate(
      () => window.originalArticle === document.querySelector('.reader-markdown'),
    ),
    true,
  );
  assert.equal(await page.locator('.reader-callout').getAttribute('open'), null);
  assert.equal(await page.evaluate(() => window.liveBlobs.size), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.reader-main').evaluate((node) => {
    node.scrollTop = 0;
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(
    resources.some((url) => /KaTeX_.*\.woff2/.test(url)),
    'fonts are bundled local assets',
  );
  await page.screenshot({ path: resolve(reports, 'rich-narrow-dark.png') });
  await page.getByRole('button', { name: '阅读首页', exact: true }).click();
  await page.locator('.reader-home').waitFor();
  await page.locator('.reader-markdown').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.liveBlobs.size === 0);
  assert.deepEqual(
    await page.evaluate(() => [
      window.liveBlobs.size,
      document.querySelectorAll('[data-reader-diagram-measure],[data-reader-math]').length,
    ]),
    [0, 0],
  );
});
test('malformed or resource-bearing diagrams retain source and cannot load resources; math is bounded', async (t) => {
  const { page } = await setup(t, 'unsafe.md', { locale: 'en' });
  for (const diagram of await page.locator('.reader-diagram').all()) {
    await diagram.scrollIntoViewIfNeeded();
    await diagram.locator('[role=status]').filter({ hasText: 'Could not render' }).waitFor();
    assert.ok((await diagram.locator('pre').textContent()).trim());
  }
  const math = page.locator('.reader-math');
  await math.last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.reader-math')].every((n) => n.dataset.state !== 'pending'),
  );
  assert.equal(await page.locator('.reader-math[data-state=error]').count(), 2);
  assert.equal(
    await page
      .locator('.reader-markdown img, .reader-markdown iframe, .reader-markdown script')
      .count(),
    0,
  );
  assert.equal(await page.locator('[data-reader-diagram-measure]').count(), 0);
});
