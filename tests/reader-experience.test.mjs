/* [INPUT]: Production reader entry, synthetic API notes and isolated Chromium storage.
 * [OUTPUT]: Sidebar, navigation, Markdown safety, outline and responsive behavior acceptance.
 * [POS]: No real files, host, credentials or model requests; screenshots contain synthetic notes only.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
const reports = resolve('target/reports/reader-experience');
const output = resolve(reports, `web-${process.pid}`);
const deep = '项目/研究/阅读器/这是一篇很长很长需要完整显示的笔记名称.md';
const text = `---
tags: [测试, 阅读/笔记]
aliases:
  - 示例
published: true
count: 3
owner:
  name: Palboo
---
# 阅读器示例

==重点内容== 和 #阅读/笔记，普通数字 #123，\`==code== #code\`。

> [!note]+ **提示标题**
> 默认展开的正文。

> [!tip]- 收起提示
> 隐藏命中 hiddenneedle。
>
> > [!warning]+ 嵌套提示
> > 注意内容。

## 第二节

[[来源|打开来源]]

\`\`\`js
const value = '<script>unsafe</script>';
\`\`\`

${Array.from({ length: 35 }, (_, i) => `段落 ${i}，用于验证阅读位置和常驻目录。`).join('\n\n')}

## 最后一节

底部 needle 正文。

<script>window.injected = true</script>
[危险](javascript:alert(1))
`;
const notes = [
  {
    id: deep,
    title: deep.split('/').at(-1).replace('.md', ''),
    markdown: text,
    backlinks: [{ id: '来源.md', title: '来源' }],
    version: 'v1',
  },
  {
    id: '来源.md',
    title: '来源',
    markdown: `# 来源\n\n${'引言。\n\n'.repeat(30)}[[${deep}|返回示例]]`,
    backlinks: [],
    version: 'v1',
  },
  {
    id: '错误属性.md',
    title: '错误属性',
    markdown: '---\na: &loop [*loop]\n---\n# 属性错误仍可阅读',
    backlinks: [],
    version: 'v1',
  },
  { id: '其他/空白.md', title: '空白', markdown: '', backlinks: [], version: 'v1' },
];
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
async function setup(t, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get('id');
    let value;
    if (url.pathname === '/api/catalog')
      value = {
        name: '合成笔记',
        revision: 1,
        notes,
        language: options.locale === 'en' ? 'en' : 'zh-CN',
        skipped: 0,
      };
    else if (url.pathname === '/api/note') value = notes.find((note) => note.id === id);
    else if (url.pathname === '/api/search')
      value = { total: 1, offset: 0, results: [{ ...notes[0], snippet: 'needle 正文' }] };
    else if (url.pathname === '/api/resolve')
      value = {
        candidates: [notes[url.searchParams.get('target') === '来源' ? 1 : 0]],
        anchor: '',
      };
    else if (url.pathname === '/api/save')
      value = {
        ...notes.find((note) => note.id === id),
        ...route.request().postDataJSON(),
        version: 'v2',
      };
    else return route.fulfill({ status: 404, json: { message: 'Unknown test API' } });
    return route.fulfill({ json: value });
  });
  await page.goto(`${base}/reader.html?note=${encodeURIComponent(deep)}`);
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
  return { page, context };
}
const width = (page) =>
  page.locator('.reader-sidebar').evaluate((node) => node.getBoundingClientRect().width);

test('resizable persisted sidebar, collapsed rail, wrapped names and tree reveal', async (t) => {
  const { page } = await setup(t);
  const handle = page.getByRole('separator');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 173, box.y + 100);
  await page.mouse.up();
  assert.equal(await width(page), 402);
  await page.reload();
  await handle.waitFor();
  assert.equal(await width(page), 402);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await width(page), 414);
  await handle.dblclick();
  assert.equal(await width(page), 232);
  const current = page.locator('.reader-tree button[aria-current="page"] .reader-row-name');
  assert.ok(
    await current.evaluate(
      (node) => node.offsetHeight > 32 && node.scrollWidth <= node.clientWidth,
    ),
  );
  await page.getByRole('button', { name: '全部折叠', exact: true }).click();
  assert.equal(await page.locator('.reader-tree details[open]').count(), 0);
  await page.getByRole('button', { name: '定位当前笔记', exact: true }).click();
  await current.waitFor();
  assert.equal(await page.locator('.reader-tree details[open]').count(), 3);
  await page.getByRole('button', { name: '目录与搜索', exact: true }).click();
  assert.equal(await width(page), 44);
  await page.reload();
  assert.equal(await width(page), 44);
});

test('structured properties, callouts, safe markup, tags and code clipboard', async (t) => {
  const { page, context } = await setup(t);
  assert.equal(await page.locator('.reader-properties dt').count(), 5);
  assert.equal(await page.locator('.reader-properties .reader-tag').count(), 2);
  assert.equal(await page.locator('mark').first().textContent(), '重点内容');
  const editBox = await page.getByRole('button', { name: '编辑笔记', exact: true }).boundingBox();
  const outlineBox = await page.locator('.reader-outline').boundingBox();
  assert.ok(editBox.x + editBox.width <= outlineBox.x, 'edit action stays clear of outline');
  await page.screenshot({ path: resolve(reports, 'markdown.png') });
  assert.equal(await page.locator('details[data-callout="tip"]').getAttribute('open'), null);
  assert.equal(await page.locator('details[data-callout="note"] strong').textContent(), '提示标题');
  await page.locator('details[data-callout="tip"] > summary').click();
  assert.equal(await page.getByText('隐藏命中 hiddenneedle。', { exact: true }).isVisible(), true);
  assert.equal(await page.locator('code').first().textContent(), '==code== #code');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  await page.getByText('已复制', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "const value = '<script>unsafe</script>';\n",
  );
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
  await page.locator('.reader-properties .reader-tag').first().click();
  assert.equal(await page.getByRole('searchbox').inputValue(), '测试');
  await page.keyboard.press('Control+o');
  await page.getByRole('combobox').fill('错误属性');
  await page.keyboard.press('Enter');
  await page.getByText('属性无法解析，显示原文').waitFor();
  assert.equal(await page.getByRole('heading', { name: '属性错误仍可阅读' }).isVisible(), true);
});

test('quick switcher keyboard, search reveal, backlink destinations and active pinned outline', async (t) => {
  const { page } = await setup(t);
  assert.ok(
    (await page.getByRole('navigation', { name: '笔记路径' }).textContent()).includes('项目'),
  );
  assert.equal(
    await page.locator('.reader-outline').evaluate((node) => getComputedStyle(node).position),
    'sticky',
  );
  await page.locator('.reader-toc a').last().click();
  await page.waitForFunction(
    () =>
      document.querySelector('.reader-toc a[aria-current="location"]')?.textContent === '最后一节',
  );
  await page.getByRole('searchbox').fill('hiddenneedle');
  await page.locator('.reader-results button').click();
  await page.locator('mark[data-search-hit]').waitFor();
  assert.equal(
    await page.locator('details[data-callout="tip"]').evaluate((node) => node.open),
    true,
  );
  assert.equal(
    await page.locator('[data-search-hit]').evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.top > 0 && box.bottom < innerHeight;
    }),
    true,
  );
  await page.locator('.reader-main').evaluate((node) => {
    node.scrollTop = 1200;
  });
  await page.route('**/api/catalog?*', (route) =>
    route.fulfill({
      json: { name: '合成笔记', revision: 2, notes, language: 'zh-CN', skipped: 0 },
    }),
  );
  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/note'),
    page.getByRole('button', { name: '刷新', exact: true }).click(),
  ]);
  await page.waitForFunction(() => document.querySelector('.reader-main').scrollTop === 1200);
  await page.getByRole('searchbox').fill('const value');
  await page.locator('.reader-results button').click();
  await page.locator('code [data-search-hit]').waitFor();
  await page.locator('.reader-backlinks button').click();
  await page.locator('[data-backlink-hit]').waitFor();
  assert.equal(
    await page.locator('[data-backlink-hit]').evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.top > 0 && box.bottom < innerHeight;
    }),
    true,
  );
  await page.keyboard.press('Meta+o');
  await page.getByRole('combobox').fill('项目 阅读器');
  assert.equal(await page.getByRole('option').count(), 1);
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
  await page.keyboard.press('Control+o');
  await page.getByRole('combobox').fill('notfound');
  await page.getByText('没有匹配的笔记').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.screenshot({ path: resolve(reports, 'wide.png') });
});

test('narrow English dark reader, empty note, resize limits and reduced motion', async (t) => {
  const { page } = await setup(t, {
    locale: 'en',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 740 },
  });
  assert.equal(await width(page), 44);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press('Control+o');
  await page.getByRole('combobox').fill('空白');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '空白' }).waitFor();
  await page.getByRole('button', { name: 'Notes and search', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse all', exact: true }).waitFor();
  await page.screenshot({ path: resolve(reports, 'narrow-dark.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  const separator = page.getByRole('separator');
  await separator.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await width(page), 520);
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  assert.equal(await width(page), 180);
});
