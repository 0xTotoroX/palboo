/* [INPUT]: Production reader entry, synthetic API notes and isolated Chromium storage.
 * [OUTPUT]: Reader sidebar/search/home, preview and information focus, conflict-safe history, scroll restoration and responsive acceptance.
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

- [x] 已整理目录层级
- [ ] 待补充截图

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
function searchNotes(rawQuery) {
  const words = (rawQuery || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = notes
    .filter((note) =>
      words.every((w) => `${note.id} ${note.markdown}`.toLocaleLowerCase().includes(w)),
    )
    .map((note) => ({
      id: note.id,
      title: note.title,
      kind: 'markdown',
      snippet: note.markdown.toLocaleLowerCase().includes(words[0] || '') ? 'needle 正文' : '',
    }));
  return { total: results.length, offset: 0, results };
}
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
    else if (url.pathname === '/api/search') value = searchNotes(url.searchParams.get('q'));
    else if (url.pathname === '/api/preview')
      value = { candidates: [notes[1]], total: 1, anchor: '', excerpt: '来源摘要，支持悬停阅读。' };
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

test('drawer keeps article geometry, restores focus and tree state, and only pinning saves layout', async (t) => {
  const { page } = await setup(t);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  const mainBox = await page.locator('.reader-main').boundingBox();
  assert.equal(mainBox.x, 0);
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click();
  assert.deepEqual(await page.locator('.reader-main').boundingBox(), mainBox);
  assert.equal(
    await page.getByRole('searchbox').evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(await page.locator('.reader-main').getAttribute('inert'), '');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('palboo-reader-sidebar')), 'false');
  await page.getByRole('searchbox').fill('来源');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('searchbox').inputValue(), '');
  assert.equal(await page.locator('.reader-tree details[open]').count(), 3);
  await page.keyboard.press('Escape');
  assert.equal(await width(page), 0);
  assert.equal(
    await page
      .getByRole('button', { name: '搜索笔记', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('Control+o');
  await page.getByRole('searchbox').fill('来源');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  assert.equal(await width(page), 0);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '固定侧栏', exact: true }).click();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('palboo-reader-sidebar')), 'true');
  assert.equal(await width(page), 268);
  await page.reload();
  await page.getByRole('searchbox').waitFor();
  assert.equal(await width(page), 268);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.keyboard.press('Control+o');
  await page.waitForFunction(() => document.activeElement?.matches('input[type="search"]'));
  await page.keyboard.press('Escape');
  await page.screenshot({ path: resolve(reports, 'round1-collapsed.png') });
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.screenshot({ path: resolve(reports, 'round1-drawer.png') });
});

test('home shows valid recent notes, preserves reading position and offers a first-use tree', async (t) => {
  const { page } = await setup(t);
  await page.locator('.reader-main').evaluate((node) => {
    node.scrollTop = 900;
  });
  await page.getByRole('button', { name: '阅读首页', exact: true }).click();
  await page.getByRole('heading', { name: '继续阅读', exact: true }).waitFor();
  assert.equal(await page.locator('.reader-resume strong').textContent(), notes[0].title);
  await page.reload();
  await page.locator('.reader-resume').click();
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.reader-main').scrollTop === 900);
  await page.getByRole('button', { name: '阅读首页', exact: true }).click();
  await page.evaluate(() =>
    localStorage.setItem(
      'palboo-reader-recent:obsidian',
      JSON.stringify(['missing.md', '来源.md']),
    ),
  );
  await page.reload();
  await page.locator('.reader-resume').waitFor();
  assert.equal(await page.locator('.reader-home .reader-recent button').count(), 1);
  assert.equal(await page.locator('.reader-resume strong').textContent(), '来源');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.screenshot({ path: resolve(reports, 'round1-home.png') });
  await page.evaluate(() => localStorage.removeItem('palboo-reader-recent:obsidian'));
  await page.reload();
  await page.locator('.reader-home .reader-tree').waitFor();
  assert.equal(await width(page), 0);
  await page.locator('.reader-home').getByRole('button', { name: '来源', exact: true }).click();
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
});

test('late full-text results enrich title matches without duplicates or moving the keyboard selection', async (t) => {
  const { page } = await setup(t);
  const summaries = notes.map((note) =>
    note.id === '来源.md' ? { ...note, title: '项目 来源' } : note,
  );
  await page.route('**/api/catalog?*', (route) =>
    route.fulfill({
      json: { name: '合成笔记', revision: 2, notes: summaries, skipped: 0, language: 'zh-CN' },
    }),
  );
  await page.route('**/api/search?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      json: {
        total: 3,
        offset: 0,
        results: [
          { ...notes[2], snippet: '项目 正文' },
          { ...notes[0], snippet: '项目 摘要' },
          { ...summaries[1], snippet: '项目 摘要' },
        ],
      },
    });
  });
  await page.reload();
  await page.getByRole('searchbox').fill('项目');
  await page.waitForFunction(
    () => document.querySelectorAll('.reader-results button').length === 2,
  );
  await page.keyboard.press('ArrowDown');
  const before = await page.locator('.reader-results [data-active="true"] strong').textContent();
  await page.waitForFunction(
    () => document.querySelectorAll('.reader-results button').length === 3,
  );
  assert.equal(
    await page.locator('.reader-results [data-active="true"] strong').textContent(),
    before,
  );
  assert.deepEqual(await page.locator('.reader-results strong').allTextContents(), [
    summaries[1].title,
    notes[0].title,
    notes[2].title,
  ]);
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
});

test('resizable persisted sidebar, collapsed navigation, neat single-line tree and folder/note reveal', async (t) => {
  const { page } = await setup(t);
  assert.equal(await page.locator('.reader-sidebar input[type="search"]').count(), 1);
  assert.equal(await page.locator('.reader-switcher-trigger').count(), 0);
  assert.equal(await width(page), 268);
  const handle = page.getByRole('separator');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 153, box.y + 100);
  await page.mouse.up();
  assert.equal(await width(page), 418);
  await page.reload();
  await handle.waitFor();
  assert.equal(await width(page), 418);
  const current = page.locator('.reader-tree button[aria-current="page"] .reader-row-name');
  assert.ok(
    await current.evaluate(
      (node) => node.offsetHeight <= 30 && node.scrollWidth <= node.clientWidth,
    ),
    'widened sidebar reveals full single-line note title cleanly',
  );
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await width(page), 430);
  await handle.dblclick();
  assert.equal(await width(page), 268);
  await page.getByRole('button', { name: '全部折叠', exact: true }).click();
  assert.equal(await page.locator('.reader-tree details[open]').count(), 0);
  await page
    .getByRole('navigation', { name: '笔记路径' })
    .getByRole('button', { name: '研究', exact: true })
    .click();
  assert.equal(await page.locator('.reader-tree details[open]').count(), 2);
  await page.getByRole('button', { name: '定位当前笔记', exact: true }).click();
  await current.waitFor();
  assert.equal(await page.locator('.reader-tree details[open]').count(), 3);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  assert.equal(await width(page), 0);
  await page.reload();
  assert.equal(await width(page), 0);
});

test('title-above-properties hierarchy, callouts, safe markup, tags and code clipboard', async (t) => {
  const { page, context } = await setup(t);
  const titleBox = await page
    .getByRole('heading', { name: '阅读器示例', exact: true })
    .boundingBox();
  const propsBox = await page.locator('.reader-properties').boundingBox();
  assert.ok(titleBox.y < propsBox.y, 'H1 note title renders above properties');
  assert.equal(await page.locator('.reader-properties dt').count(), 5);
  assert.equal(await page.locator('.reader-properties .reader-tag').count(), 2);
  assert.ok((await page.locator('.reader-properties').textContent()).includes('name: Palboo'));
  assert.equal(await page.locator('mark').first().textContent(), '重点内容');
  const topbarBox = await page.locator('.reader-topbar').boundingBox();
  const editBox = await page.getByRole('button', { name: '编辑笔记', exact: true }).boundingBox();
  const outlineBox = await page.locator('aside.reader-information').boundingBox();
  assert.equal(
    Math.round(topbarBox.x),
    Math.round(titleBox.x),
    'topbar aligns with article column',
  );
  assert.ok(editBox.x + editBox.width <= outlineBox.x, 'edit action stays clear of outline');
  await page.screenshot({ path: resolve(reports, 'markdown.png') });
  assert.equal(await page.locator('details[data-callout="tip"]').getAttribute('open'), null);
  assert.equal(await page.locator('details[data-callout="note"] strong').textContent(), '提示标题');
  await page.locator('details[data-callout="tip"] > summary').click();
  assert.equal(await page.getByText('隐藏命中 hiddenneedle。', { exact: true }).isVisible(), true);
  assert.equal(await page.locator('code').first().textContent(), '==code== #code');
  assert.equal(await page.locator('.reader-code-lang').textContent(), 'js');
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
  await page.getByRole('searchbox').fill('错误属性');
  await page.keyboard.press('Enter');
  await page.getByText('属性无法解析，显示原文').waitFor();
  assert.equal(await page.getByRole('heading', { name: '属性错误仍可阅读' }).isVisible(), true);
});

test('unified search keyboard, search reveal, backlink destinations and active independent outline', async (t) => {
  const { page } = await setup(t);
  assert.ok(
    (await page.getByRole('navigation', { name: '笔记路径' }).textContent()).includes('项目'),
  );
  const informationBox = await page.locator('aside.reader-information').boundingBox();
  await page.locator('.reader-main').evaluate((node) => {
    node.scrollTop = 200;
  });
  assert.deepEqual(await page.locator('aside.reader-information').boundingBox(), informationBox);
  await page.locator('.reader-toc a').last().click();
  await page.waitForFunction(
    () =>
      document.querySelector('.reader-toc a[aria-current="location"]')?.textContent === '最后一节',
  );
  await page.getByRole('searchbox').fill('hiddenneedle');
  await page.locator('.reader-results button').click();
  await page.locator('mark[data-search-hit]').waitFor();
  assert.equal(await page.locator('.reader-pagination').count(), 0);
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
  await page.getByRole('tab', { name: '反向链接' }).click();
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
  await page.getByRole('searchbox').fill('项目 阅读器');
  assert.equal(await page.locator('.reader-results button').count(), 1);
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
  await page.keyboard.press('Control+k');
  await page.getByRole('searchbox').fill('notfound');
  await page.getByText('没有匹配的笔记').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('searchbox').inputValue(), '');
  await page.screenshot({ path: resolve(reports, 'wide.png') });
});

test('narrow English dark reader, shortcut expands collapsed navigation, resize limits and reduced motion', async (t) => {
  const { page } = await setup(t, {
    locale: 'en',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 740 },
  });
  assert.equal(await width(page), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press('Control+o');
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('空白');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '空白' }).waitFor();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse all', exact: true }).waitFor();
  await page.screenshot({ path: resolve(reports, 'narrow-dark.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click();
  const separator = page.getByRole('separator');
  await separator.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await width(page), 520);
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  assert.equal(await width(page), 180);
});

test('link preview preserves reading/history, stays open under the pointer, supports keyboard and opens explicitly', async (t) => {
  const { page } = await setup(t);
  const link = page.getByRole('link', { name: '打开来源', exact: true });
  await link.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => ({
    url: location.href,
    length: history.length,
    recent: localStorage.getItem('palboo-reader-recent:obsidian'),
  }));
  await link.hover();
  const card = page.getByRole('dialog', { name: '链接预览' });
  await card.getByText('来源摘要，支持悬停阅读。').waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      url: location.href,
      length: history.length,
      recent: localStorage.getItem('palboo-reader-recent:obsidian'),
    })),
    before,
  );
  await card.hover();
  await page.waitForTimeout(230);
  assert.equal(await card.isVisible(), true);
  assert.equal(await card.locator('img,script,iframe').count(), 0);
  await page.screenshot({ path: resolve(reports, 'round2-link-preview.png') });
  await card.getByRole('button', { name: '关闭预览' }).click();
  assert.equal(await card.count(), 0);
  assert.equal(await link.evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press('Tab');
  await link.focus();
  await card.waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await card.evaluate((node) => node.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  assert.equal(await card.count(), 0);
  await link.hover();
  await card.getByRole('button', { name: '打开笔记', exact: true }).click();
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  assert.equal(await card.count(), 0);
  assert.equal(await page.getByRole('button', { name: '后退', exact: true }).isEnabled(), true);
});

test('preview cancellation, errors, missing and ambiguous targets never replace the current note', async (t) => {
  const { page } = await setup(t);
  const link = page.getByRole('link', { name: '打开来源', exact: true });
  let releasePreview;
  const pendingPreview = new Promise((done) => {
    releasePreview = done;
  });
  t.after(() => releasePreview());
  await page.route('**/api/preview?*', async (route) => {
    await pendingPreview;
    await route.fulfill({
      json: { candidates: [notes[1]], total: 1, anchor: '', excerpt: '过期摘要' },
    });
  });
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  await page.getByText('正在读取预览…').waitFor();
  await page.getByRole('button', { name: '阅读首页', exact: true }).click();
  await page.getByRole('heading', { name: '继续阅读' }).waitFor();
  releasePreview();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.reader-link-preview').count(), 0);
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await link.waitFor();
  for (const [response, expected] of [
    [{ status: 503, json: { message: '暂时不可用' } }, '暂时不可用'],
    [{ json: { candidates: [], total: 0, anchor: '', excerpt: null } }, '链接指向的笔记不存在'],
    [
      { json: { candidates: [notes[1], notes[2]], total: 2, anchor: '章节', excerpt: null } },
      '选择链接目标',
    ],
  ]) {
    await page.route('**/api/preview?*', (route) => route.fulfill(response));
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    const card = page.getByRole('dialog', { name: '链接预览' });
    await card.getByText(expected, { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '阅读器示例', exact: true }).count(), 1);
    if (expected === '选择链接目标') {
      await card.getByRole('button', { name: '来源 来源.md' }).click();
      await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, `#${encodeURIComponent('章节')}`);
    } else {
      // Refresh changes the catalog generation and invalidates the transient preview cache.
      await card.getByRole('button', { name: '关闭预览' }).click();
      await page.reload();
      await link.waitFor();
    }
  }
});

test('back/forward restores scroll, survives reload, truncates branches and retains history on an editor conflict', async (t) => {
  const { page } = await setup(t);
  const back = page.getByRole('button', { name: '后退', exact: true });
  const forward = page.getByRole('button', { name: '前进', exact: true });
  assert.equal(await back.isEnabled(), false);
  assert.equal(await forward.isEnabled(), false);
  await page.locator('.reader-main').evaluate((node) => {
    node.scrollTop = 800;
  });
  await page.getByRole('button', { name: '阅读首页', exact: true }).click();
  await page.locator('.reader-resume').waitFor();
  await back.click();
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.reader-main').scrollTop === 800);
  assert.equal(await forward.isEnabled(), true);
  await page.reload();
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
  assert.equal(await back.isEnabled(), false);
  assert.equal(await forward.isEnabled(), true);
  await forward.click();
  await page.locator('.reader-resume').waitFor();
  await back.click();
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
  await page.getByRole('searchbox').fill('来源');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  assert.equal(await forward.isEnabled(), false);
  await page.route('**/api/save', (route) =>
    route.fulfill({ status: 409, json: { message: '文件已被其他程序修改' } }),
  );
  await page.getByRole('button', { name: '编辑笔记', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '编辑 Markdown' });
  await editor.fill('# 保留的草稿');
  await back.click();
  await page.getByText('文件已被其他程序修改', { exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('.reader-history-actions button').disabled,
  );
  assert.equal(new URL(page.url()).searchParams.get('note'), '来源.md');
  assert.equal(await editor.inputValue(), '# 保留的草稿');
  // A second native Back must return to the same conflicted entry without adding entries.
  const length = await page.evaluate(() => history.length);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => new URLSearchParams(location.search).get('note') === '来源.md');
  assert.equal(await page.evaluate(() => history.length), length);
  await page.route('**/api/save', (route) =>
    route.fulfill({ json: { ...notes[1], markdown: '# 保留的草稿', version: 'v3' } }),
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.reader-save-error'));
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await back.click();
  await page.getByRole('heading', { name: '阅读器示例', exact: true }).waitFor();
  assert.equal(await forward.isEnabled(), true);
});

test('narrow reading information is one modal, retains tab choice and returns keyboard focus', async (t) => {
  const { page } = await setup(t, {
    locale: 'en',
    viewport: { width: 390, height: 740 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  const main = await page.locator('.reader-main').boundingBox();
  const trigger = page.getByRole('button', { name: 'Reading information', exact: true });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Reading information', exact: true });
  await panel.waitFor();
  assert.deepEqual(await page.locator('.reader-main').boundingBox(), main);
  await panel.getByRole('tab', { name: 'Backlinks' }).click();
  await page.screenshot({ path: resolve(reports, 'round2-info-narrow.png') });
  assert.equal(await panel.locator('.reader-backlinks button').count(), 1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.reader-information').open);
  assert.equal(await trigger.evaluate((node) => document.activeElement === node), true);
  await trigger.click();
  assert.equal(
    await panel.getByRole('tab', { name: 'Backlinks' }).getAttribute('aria-selected'),
    'true',
  );
  await page.keyboard.press('Home');
  assert.equal(
    await panel.getByRole('tab', { name: 'On this page' }).getAttribute('aria-selected'),
    'true',
  );
  await panel.locator('.reader-toc a').last().click();
  await page.waitForFunction(() => !document.querySelector('dialog.reader-information').open);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('aside.reader-information').waitFor();
  await page.getByRole('button', { name: 'Close reading information', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 740 });
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.locator('aside.reader-information').isVisible(), false);
  await trigger.click();
  await page.locator('aside.reader-information').waitFor();
  await page.screenshot({ path: resolve(reports, 'round2-info-dark.png') });
});
