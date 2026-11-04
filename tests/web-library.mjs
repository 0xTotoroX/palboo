/* [INPUT]: Matching backend/web artifacts, synthetic vault and isolated browser profile.
 * [OUTPUT]: Reader behavior and compact folder/site settings, retained drafts and revision-conflict acceptance.
 * [POS]: No real notes, external websites, host messages, model calls or credentials.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { prepareTestBinary } from '../scripts/verify.mjs';
import { workbookFixture } from './reader-fixtures.mjs';
import { exerciseReaderEditing } from './reader-editing.mjs';
import { exerciseReaderFolders } from './reader-folders.mjs';
const artifact = prepareTestBinary();
const root = resolve(import.meta.dirname, '..');
const folder = realpathSync(mkdtempSync(join(tmpdir(), 'palboo-reader-')));
const vault = join(folder, '中文笔记'),
  data = join(folder, 'data');
mkdirSync(join(vault, '项目/附件'), { recursive: true });
mkdirSync(join(vault, '其他'), { recursive: true });
mkdirSync(join(vault, '.obsidian'), { recursive: true });
mkdirSync(data);
writeFileSync(join(data, 'panel.json'), JSON.stringify({ language: 'zh-CN' }));
writeFileSync(
  join(vault, '首页.md'),
  '# 欢迎\n\n中文全文 needle\n\n[[项目/文章#章节|进入章节]]\n\n[[同名]]\n\n`[[代码链接]]`\n\n<script>window.noteInjected=true</script>\n\n![remote](https://tracking.example.invalid/image.png)\n',
);
writeFileSync(
  join(vault, '项目/文章.md'),
  '---\ntags: [测试]\n---\n# 文章\n\n## 章节\n\n带有段落标记 ^block\n\n[[首页|返回首页]]\n\n![[附件/图片.png|100]]\n\n![Markdown 图片](附件/图片.png)\n\n| 列 | 值 |\n| --- | --- |\n| 搜索 | 本地 |\n\n> [!note] 提示\n> 安全只读\n\n' +
    Array.from({ length: 70 }, (_, i) => `段落 ${i} 正文。\n\n`).join('') +
    '[[#^block|段落跳转]]\n',
);
writeFileSync(join(vault, '项目/同名.md'), 'a');
writeFileSync(join(vault, '其他/同名.md'), 'b');
writeFileSync(join(vault, '代码笔记.md'), '```sh\n# comment, not a heading\n```\n');
writeFileSync(join(vault, '另一文件名.md'), '下划线标题\n===\n\n正文\n');
writeFileSync(join(vault, '.obsidian/config.json'), '{}');
writeFileSync(
  join(vault, '项目/附件/图片.png'),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'base64',
  ),
);
function hashes() {
  return Object.fromEntries(
    readdirSync(vault, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const path = join(e.parentPath, e.name);
        return [
          path.slice(vault.length),
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        ];
      }),
  );
}
for (const name of ['A10', 'A2', '_AI']) {
  mkdirSync(join(vault, name));
  writeFileSync(join(vault, name, '排序.md'), '# 排序');
}
writeFileSync(join(vault, '项目/表格.xlsx'), workbookFixture);
writeFileSync(join(vault, '项目/数据.csv'), '名称,值\n"带逗号,文本",=1+1\n');
writeFileSync(join(vault, '项目/损坏.xlsx'), 'not a workbook');
const before = hashes();
const startBackend = () =>
  spawn(
    artifact.binary,
    ['--data-dir', data, 'serve', '--port', '0', '--cdp', 'http://127.0.0.1:9'],
    { stdio: 'ignore', env: { ...process.env, PALBOO_START_DISCONNECTED: '1' } },
  );
let child = startBackend();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label) {
  for (let i = 0; i < 200; i++) {
    const value = await fn();
    if (value) return value;
    await delay(50);
  }
  throw Error(label);
}
const checks = [];
const record = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
let browser;
try {
  const runtime = await wait(() => {
    try {
      return JSON.parse(readFileSync(join(data, 'runtime.json')));
    } catch {
      return null;
    }
  }, 'backend startup');
  const base = `http://127.0.0.1:${runtime.port}`;
  async function api(path, body) {
    const response = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.ok, true, JSON.stringify(result));
    return result;
  }
  await api('web-library', {
    expectedRevision: 0,
    vault,
    sites: [{ id: 'fixture', name: '本地网站', url: 'https://example.invalid/' }],
  });
  const { url } = await api('web-library/reader');
  const destination = new URL(url);
  const token = new URLSearchParams(destination.hash.slice(1)).get('reader');
  assert.notEqual(destination.port, String(runtime.port));
  assert.notEqual(token, runtime.token);
  for (const [credential, status] of [
    ['', 401],
    [runtime.token, 401],
    [token, 200],
  ]) {
    const r = await fetch(`${destination.origin}/api/catalog`, {
      headers: { Authorization: `Bearer ${credential}` },
    });
    assert.equal(r.status, status);
  }
  assert.equal(
    (
      await fetch(`${destination.origin}/api/note`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/api/settings`, { headers: { Authorization: `Bearer ${token}` } })).status,
    401,
  );
  record('reader credential isolation; same-origin writes only');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1100, height: 820 },
  });
  const page = await context.newPage();
  const outbound = [],
    errors = [];
  page.on('request', (r) => {
    if (
      !new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/) &&
      !r.url().startsWith('blob:')
    )
      outbound.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator('.reader-sidebar summary').first().waitFor();
  assert.equal(await page.locator('.reader-header').count(), 0);
  assert.equal(await page.getByText('只读', { exact: true }).count(), 0);
  assert.equal(
    await page.locator('.reader-main').evaluate((e) => e.getBoundingClientRect().top),
    0,
  );
  const folders = await page
    .locator('.reader-tree > ul > li > details > summary')
    .allTextContents();
  assert.equal(folders[0], '_AI');
  assert.ok(
    folders.indexOf('A2') < folders.indexOf('A10'),
    'numbers sort naturally in the current locale',
  );
  const ai = page.locator('.reader-sidebar summary').filter({ hasText: /^_AI$/ });
  assert.equal(await ai.locator('[data-icon="reader-folder"]').count(), 1);
  await ai.press('Enter');
  await ai.locator('[data-icon="reader-folder-open"]').waitFor();
  await ai.press('Enter');
  assert.equal(await ai.evaluate((el) => getComputedStyle(el).listStyleType), 'none');
  record('folder icons, keyboard expansion, underscore-first and numeric natural order');
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('heading', { name: '欢迎', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await page.evaluate(() => window.noteInjected), undefined);
  assert.deepEqual(outbound, []);
  assert.equal(await page.locator('.reader-markdown a').filter({ hasText: '代码链接' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /加载外部图片/ }).count(), 1);
  assert.equal(await page.locator('h1').count(), 1, 'the note title is not repeated');
  record('raw HTML/code stay inert; no automatic external image/network requests');
  await page.getByRole('button', { name: '代码笔记', exact: true }).click();
  await page.getByRole('heading', { name: '代码笔记', exact: true }).waitFor();
  assert.equal(await page.locator('.reader-markdown h1').count(), 0);
  await page.getByRole('button', { name: '另一文件名', exact: true }).click();
  await page.getByRole('heading', { name: '下划线标题', exact: true }).waitFor();
  assert.equal(await page.locator('h1').count(), 1, 'setext headings do not repeat the file title');
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('heading', { name: '欢迎', exact: true }).waitFor();
  await page.getByRole('searchbox', { name: '搜索笔记' }).fill('needle');
  await page.locator('.reader-results button').first().waitFor();
  assert.equal(await page.locator('.reader-results button').count(), 1);
  await page.getByRole('searchbox', { name: '搜索笔记' }).fill('中文全文');
  await page.waitForFunction(
    () => document.querySelector('.reader-results strong')?.textContent === '首页',
  );
  record('Chinese full-text/path search and snippets');
  await page.getByRole('link', { name: '进入章节', exact: true }).click();
  await page.getByRole('heading', { name: '章节', exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.reader-picture>button img')].length === 2 &&
      [...document.querySelectorAll('.reader-picture>button img')].every(
        (i) => i.complete && i.naturalWidth > 0,
      ),
  );
  assert.equal(await page.locator('.reader-markdown table').count(), 1);
  assert.equal(await page.locator('[data-note-anchor="^block"]').count(), 1);
  assert.equal(await page.locator('.reader-backlinks button').count(), 1);
  await page.getByRole('button', { name: '放大图片', exact: true }).first().click();
  await page.locator('.reader-lightbox[open]').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '段落跳转', exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('data-note-anchor') === '^block',
  );
  await page.getByRole('searchbox', { name: '搜索笔记' }).fill('');
  await page.getByRole('button', { name: '文章', exact: true }).click();
  await page.locator('.reader-main').evaluate((element) => (element.scrollTop = 850));
  await page.waitForFunction(() => document.querySelector('.reader-main').scrollTop === 850);
  // Allow the native scroll event to update the saved position before navigating.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.locator('.reader-sidebar').getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('heading', { name: '欢迎', exact: true }).waitFor();
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.reader-main').scrollTop >= 840);
  record('wikilinks, aliases, headings, block anchors, backlinks, GFM, local images and zoom');
  await page.getByRole('link', { name: '返回首页', exact: true }).click();
  await page.getByRole('link', { name: '同名', exact: true }).click();
  await page.locator('.reader-choices[open]').waitFor();
  assert.equal(await page.locator('.reader-choices li').count(), 2);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  record('ambiguous links require a choice instead of silently choosing a note');
  for (const width of [390, 780, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (width === 390) {
      if (
        (await page
          .getByRole('button', { name: '目录与搜索', exact: true })
          .getAttribute('aria-expanded')) === 'true'
      )
        await page.getByRole('button', { name: '目录与搜索', exact: true }).click();
      await page.getByRole('button', { name: '目录与搜索', exact: true }).click();
      assert.equal(await page.getByRole('searchbox', { name: '搜索笔记' }).isVisible(), true);
      await page.getByRole('button', { name: '目录与搜索', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: '目录与搜索', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).colorScheme === 'dark',
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
    'rgb(0, 0, 0)',
  );
  await page.route('**/api/catalog?*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), language: 'en' } });
  });
  await page.reload();
  await page.getByRole('searchbox', { name: 'Search notes', exact: true }).waitFor();
  record(
    'narrow/regular/wide layouts, live dark fallback, English, history positions, keyboard and reduced motion',
  );
  const settings = await context.newPage();
  settings.on('pageerror', (e) => errors.push(e.message));
  await settings.route('**/api/web-library', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), vaults: [vault] } });
  });
  await settings.goto(`${base}/#token=${runtime.token}`);
  await settings.locator('.settings-nav a[href="#settings-sites"]').click();
  assert.equal(await settings.locator('#reader-vault').isVisible(), false);
  assert.equal(await settings.locator('#website-name').isVisible(), false);
  assert.equal(await settings.locator('.reader-folder-list .web-library-row').count(), 1);
  for (const width of [985, 720, 390]) {
    await settings.setViewportSize({ width, height: 850 });
    const layout = await settings.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        previewFirst:
          box('#settings-sites .preview-frame').bottom <= box('.reader-configuration').top,
        aligned: Math.abs(box('.reader-folder-list').left - box('.reader-configuration').left) < 1,
      };
    });
    assert.deepEqual(layout, { overflow: false, previewFirst: true, aligned: true });
  }
  await settings.setViewportSize({ width: 985, height: 850 });
  await settings.getByRole('button', { name: '编辑中文笔记', exact: true }).click();
  assert.equal(await settings.locator('#reader-vault').inputValue(), vault);
  assert.equal(
    await settings.locator('#reader-vault-choice option:checked').innerText(),
    '中文笔记',
  );
  record('preview stays above configuration; folders stay visible and wide/narrow layouts fit');
  const beforePicker = await api('web-library');
  await settings.route('**/api/web-library/choose-directory', (route) =>
    route.fulfill({ json: { path: join(vault, '_AI') } }),
  );
  await settings.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await settings.waitForFunction(
    (path) => document.querySelector('#reader-vault').value === path,
    join(vault, '_AI'),
  );
  assert.equal(
    (await api('web-library')).revision,
    beforePicker.revision,
    'picker fills a draft only',
  );
  await settings.route('**/api/web-library/choose-directory', (route) =>
    route.fulfill({ json: { path: null } }),
  );
  await settings.getByRole('button', { name: '选择文件夹', exact: true }).click();
  assert.equal(
    await settings.locator('#reader-vault').inputValue(),
    join(vault, '_AI'),
    'cancel preserves draft',
  );
  await settings.locator('#reader-vault').fill(vault);
  record('folder picker draft and cancel preserve saved grants');
  assert.equal(await settings.locator('.settings-preview').count(), 0);
  await settings.locator('#reader-attachments').fill(join(vault, '项目/附件'));
  await settings.getByRole('dialog', { name: '编辑文件夹', exact: true }).press('Escape');
  const saved = await api('web-library');
  await api('web-library', {
    expectedRevision: saved.revision,
    attachments: [join(vault, '其他')],
  });
  await settings.locator('.settings-nav a[href="#settings-features"]').click();
  await settings.locator('.settings-nav a[href="#settings-sites"]').click();
  await settings.getByRole('button', { name: '编辑文件夹', exact: true }).click();
  await settings.getByRole('button', { name: '重新读取已保存目录', exact: true }).waitFor();
  assert.equal(
    await settings.locator('#reader-attachments').inputValue(),
    join(vault, '项目/附件'),
  );
  await settings
    .getByRole('dialog', { name: '编辑文件夹', exact: true })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await settings
    .getByRole('dialog', { name: '编辑文件夹', exact: true })
    .getByRole('alert')
    .filter({ hasText: '阅读与网页设置已在其他窗口更新，请刷新后重试' })
    .waitFor();
  assert.deepEqual((await api('web-library')).attachments, [join(vault, '其他')]);
  await settings.getByRole('button', { name: '重新读取已保存目录', exact: true }).click();
  assert.equal(await settings.locator('#reader-attachments').inputValue(), join(vault, '其他'));
  await settings
    .getByRole('dialog', { name: '编辑文件夹', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  const current = await api('web-library');
  await api('web-library', { expectedRevision: current.revision, attachments: [] });
  await settings.locator('.settings-nav a[href="#settings-features"]').click();
  await settings.locator('.settings-nav a[href="#settings-sites"]').click();
  await settings.getByRole('button', { name: '编辑中文笔记', exact: true }).click();
  await wait(
    async () => (await settings.locator('#reader-attachments').inputValue()) === '',
    'clean roots refresh',
  );
  await settings
    .getByRole('dialog', { name: '编辑文件夹', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  record('root drafts survive external conflicts; saved grants refresh without silent overwrite');
  await settings.getByRole('button', { name: '添加网站', exact: true }).click();
  await settings.locator('#website-name').fill('合成网站');
  await settings.locator('#website-url').fill('https://example.invalid/path');
  await settings.getByRole('dialog', { name: '添加网站', exact: true }).press('Escape');
  await settings.getByRole('button', { name: '添加网站', exact: true }).click();
  assert.equal(
    await settings.locator('#website-name').inputValue(),
    '合成网站',
    'closing retains website draft',
  );
  await settings
    .getByRole('dialog', { name: '添加网站', exact: true })
    .getByRole('button', { name: '添加网站', exact: true })
    .click();
  await settings.locator('.web-library-open').filter({ hasText: '合成网站' }).waitFor();
  let state = await api('web-library');
  assert.equal(state.sites.length, 2);
  await settings.getByRole('button', { name: '编辑合成网站', exact: true }).click();
  await settings.locator('#website-name').fill('更新名称');
  await settings
    .locator('form')
    .filter({ has: settings.locator('#website-name') })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await settings.locator('.web-library-open').filter({ hasText: '更新名称' }).waitFor();
  const row = settings.locator('.web-library-row').filter({ hasText: '更新名称' });
  await row.focus();
  await settings.keyboard.press('Alt+ArrowUp');
  await wait(
    async () => (await api('web-library')).sites[0].name === '更新名称',
    'keyboard website order',
  );
  const calls = [];
  settings.on('request', (r) => {
    if (r.url().endsWith('/api/web-library/open')) calls.push(r.url());
  });
  await settings
    .locator('[data-settings-feature="sites"] button')
    .filter({ hasText: '中文笔记' })
    .click();
  assert.equal(calls.length, 0);
  await settings.getByRole('button', { name: '删除更新名称', exact: true }).click();
  await settings.getByRole('button', { name: '确认', exact: true }).click();
  await wait(async () => (await api('web-library')).sites.length === 1, 'website removal');
  record('website add/edit/delete/keyboard order and real-component preview without navigation');
  assert.deepEqual(hashes(), before);
  assert.deepEqual(outbound, []);
  assert.deepEqual(errors, []);
  record('all original note, attachment and .obsidian hashes unchanged; no browser errors');
  await page.unroute('**/api/catalog?*');
  await page.setViewportSize({ width: 1100, height: 820 });
  await exerciseReaderEditing({ page, vault, url: (await api('web-library/reader')).url, record });
  assert.deepEqual(errors, []);
  await exerciseReaderFolders({ page, context, settings, api, vault, folder, wait, record });
  const stableUrl = (await api('web-library/reader')).url;
  const oldPid = child.pid;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  child = startBackend();
  await wait(() => {
    try {
      const next = JSON.parse(readFileSync(join(data, 'runtime.json')));
      return next.pid !== oldPid;
    } catch {
      return false;
    }
  }, 'backend restart');
  await wait(async () => {
    try {
      const response = await fetch(new URL('/api/catalog', stableUrl), {
        headers: {
          Authorization: `Bearer ${new URLSearchParams(new URL(stableUrl).hash.slice(1)).get('reader')}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }, 'stable reader port/token');
  await page.reload();
  await page.getByRole('heading', { name: '欢迎', exact: true }).waitFor();
  assert.deepEqual(hashes(), before);
  record(
    'same-grant backend restart preserves reader origin/access; synthetic edits restored; other files unchanged',
  );
  const report = { passed: true, artifact, checks };
  mkdirSync(join(root, 'target/reports/web-library'), { recursive: true });
  writeFileSync(
    join(root, 'target/reports/web-library/acceptance.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  rmSync(folder, { recursive: true, force: true });
}
