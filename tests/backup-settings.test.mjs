/* [INPUT]: Actual backup page, compiled settings styles and isolated API fixtures.
 * [OUTPUT]: Explicit preview/apply, encryption choices, dirty protection and bilingual layout.
 * [POS]: Browser regression; no real backups, host data or external service access.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const targets = [
  { id: 'current', label: '当前运行环境', path: '/synthetic/dev', version: '1.6.0', current: true },
  { id: 'release', label: '正式版', path: '/synthetic/release', version: '1.6.0', current: false },
];
const sections = [
  ['settings', '功能与模型服务', true],
  ['appearance', '外观与字体', true],
  ['data', '任务与术语数据', false],
  ['machine', '本机目录与设备设置', false],
  ['secrets', 'API 密钥', false],
].map(([id, label, enabled]) => ({ id, label, default: enabled }));
const script = build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BackupSettings}from'./ui/settings/backup-settings';import{setLocale}from'./ui/shared/i18n.js';window.locale=setLocale;function App(){const[dirty,setDirty]=React.useState(false);window.dirty=setDirty;const[,render]=React.useState(0);window.repaint=()=>render(v=>v+1);return <div className="settings-app"><main className="settings-content"><div className="settings-form-column"><h1>Backup fixture</h1><BackupSettings active live dirty={dirty}/></div></main></div>}createRoot(document.getElementById('root')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
}).then((r) => r.outputFiles[0].text);
test('backup requires a reviewed operation and keeps feedback outside the form flow', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1040, height: 1000 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(5000);
  const writes = [],
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'https://backup.test');
    if (url.pathname != '/api/backup')
      return route.fulfill({
        contentType: 'text/html',
        body: '<meta name="viewport" content="width=device-width"><div id="root"></div>',
      });
    const body = route.request().postDataJSON();
    writes.push(body);
    let result;
    if (body.op === 'status') result = { targets, sections, canUndo: false };
    else if (body.op === 'export')
      result = {
        data: Buffer.from('synthetic-encrypted-archive').toString('base64'),
        filename: 'synthetic.palboo.age',
      };
    else if (body.op === 'apply') result = { ok: true, restarting: false };
    else
      result = {
        previewId: 'synthetic-preview',
        sections: body.sections || [],
        target: targets.find((v) => v.id === body.target),
        changes: [{ file: 'config.json', fields: ['stepwise.maxItems'], secret: false }],
        restart: false,
      };
    return route.fulfill({ json: result });
  });
  await page.goto('https://backup.test/#token=fixture');
  const html = await readFile('target/web/index.html', 'utf8');
  for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
    await page.addStyleTag({ content: await readFile(`target/web${href}`, 'utf8') });
  await page.addScriptTag({ content: await script });
  await page.getByLabel('功能与模型服务', { exact: true }).waitFor();
  assert.deepEqual(
    writes.map((w) => w.op),
    ['status'],
  );
  assert.equal(await page.locator('#settings-feedback-center').count(), 0);
  await page.getByRole('switch', { name: '包含 API 密钥', exact: true }).click();
  const exportButton = page.getByRole('button', { name: '导出备份', exact: true });
  assert.equal(await exportButton.isDisabled(), true);
  await page.getByLabel('备份密码', { exact: true }).fill('synthetic backup password');
  const before = await page.getByLabel('目标环境', { exact: true }).boundingBox();
  const download = page.waitForEvent('download');
  await exportButton.click();
  await download;
  const exported = writes.find((w) => w.op === 'export');
  assert.equal(exported.includeSecrets, true);
  assert.equal(exported.includeData, false);
  await page.getByRole('status').filter({ hasText: '备份已生成' }).waitFor();
  assert.deepEqual(
    await page.getByLabel('目标环境', { exact: true }).boundingBox(),
    before,
    'fixed feedback must not move form rows',
  );
  const repaint = await page.evaluate(() => setInterval(window.repaint, 100));
  await page
    .getByRole('status')
    .filter({ hasText: '备份已生成' })
    .waitFor({ state: 'hidden', timeout: 7500 });
  await page.evaluate((timer) => clearInterval(timer), repaint);
  await page.getByLabel('目标环境', { exact: true }).selectOption('release');
  await page.getByRole('button', { name: '预览复制', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '确认恢复范围', exact: true });
  await drawer.waitFor();
  assert.equal(writes.filter((w) => w.op === 'apply').length, 0);
  assert.match(await drawer.innerText(), /正式版/);
  assert.match(await drawer.innerText(), /自动保存恢复点/);
  await page.keyboard.press('Escape');
  assert.equal(await drawer.isVisible(), false);
  await page.getByLabel('任务与术语数据', { exact: true }).check();
  await page.getByLabel('备份文件', { exact: true }).setInputFiles({
    name: 'synthetic.palboo',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await page.getByRole('button', { name: '预览导入', exact: true }).click();
  await drawer.waitFor();
  assert.match(await drawer.innerText(), /同步保持暂停/);
  assert.equal(writes.filter((w) => w.op === 'apply').length, 0);
  await drawer.getByRole('button', { name: '应用配置' }).click();
  await page.getByRole('status').filter({ hasText: '目标下次启动时生效' }).waitFor();
  assert.equal(writes.filter((w) => w.op === 'apply').length, 1);
  assert.equal(writes.find((w) => w.op === 'apply').confirm, true);
  await page.evaluate(() => window.dirty(true));
  await page.getByRole('alert').waitFor();
  assert.equal(
    await page.getByRole('button', { name: '预览导入', exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => window.dirty(false));
  await mkdir('target/reports/local-backup', { recursive: true });
  for (const lang of ['zh-CN', 'en'])
    for (const width of [390, 1280]) {
      await page.evaluate((lang) => window.locale(lang), lang);
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => (document.documentElement.dataset.settingsTheme = 'dark'));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${lang}/${width} has no horizontal overflow`,
      );
      if (lang === 'en')
        assert.equal(
          await page.getByRole('button', { name: 'Preview import', exact: true }).count(),
          1,
        );
      await page.screenshot({
        path: `target/reports/local-backup/${lang}-${width}.png`,
        fullPage: true,
      });
    }
  assert.deepEqual(errors, []);
});
