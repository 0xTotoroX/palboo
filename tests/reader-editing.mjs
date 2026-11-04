/* [INPUT]: Synthetic reader/browser fixture, filesystem and isolated authorization.
 * [OUTPUT]: Rendered sidebar, spreadsheet and conflict-safe autosave including Quick Switcher navigation.
 * [POS]: Called by web-library.mjs; changes synthetic notes only.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function exerciseReaderEditing({ page, vault, url, record }) {
  await page.goto(url);
  const sidebar = page.getByRole('button', { name: '目录与搜索', exact: true });
  if ((await sidebar.getAttribute('aria-expanded')) !== 'true') await sidebar.click();
  await page.getByRole('searchbox', { name: '搜索笔记' }).waitFor();
  await sidebar.click();
  assert.equal(
    await page.locator('.reader-sidebar').evaluate((node) => node.getBoundingClientRect().width),
    44,
  );
  await page.reload();
  assert.equal(await sidebar.getAttribute('aria-expanded'), 'false');
  await sidebar.click();
  let settingsOpened = false;
  await page.route('**/api/settings-open', (route) => {
    settingsOpened = true;
    return route.fulfill({ json: { ok: true } });
  });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/settings-open')),
    page.getByRole('button', { name: '笔记文件夹设置' }).click(),
  ]);
  assert.equal(settingsOpened, true);
  record('no top bar/read-only label; sidebar collapse persists; direct folder settings action');

  const folder = page.locator('.reader-sidebar summary').filter({ hasText: /^项目$/ });
  if (!(await folder.evaluate((node) => node.parentElement.open))) await folder.click();
  await page.getByRole('button', { name: '表格.xlsx', exact: true }).click();
  await page.getByRole('cell', { name: '合成行 1', exact: true }).waitFor();
  assert.equal(await page.locator('.reader-sheet-scroll tbody tr').count(), 100);
  assert.equal(await page.getByRole('button', { name: '编辑笔记' }).count(), 0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('cell', { name: '合成行 125', exact: true }).waitFor();
  assert.equal(await page.locator('.reader-sheet-scroll tbody tr').count(), 26);
  assert.equal(
    await page.locator('.reader-sheet-scroll tbody tr').last().locator('td').last().textContent(),
    '3',
  );
  await page.getByRole('combobox', { name: '工作表', exact: true }).selectOption('说明');
  await page
    .getByRole('cell', { name: '<script>window.sheetInjected=true</script>', exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.sheetInjected), undefined);
  await page.getByRole('button', { name: '数据.csv', exact: true }).click();
  await page.getByRole('cell', { name: '带逗号,文本', exact: true }).waitFor();
  assert.equal(await page.getByRole('cell', { name: '=1+1', exact: true }).count(), 1);
  await page.getByRole('button', { name: '损坏.xlsx', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '表格无法打开' }).waitFor();
  record(
    'XLSX sheets, cached formulas and pagination; quoted CSV; inert HTML; corrupt workbook feedback',
  );

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('heading', { name: '欢迎', exact: true }).waitFor();
  const file = join(vault, '首页.md');
  const original = readFileSync(file, 'utf8');
  const input = page.getByRole('textbox', { name: '编辑 Markdown', exact: true });
  const saveRequests = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/save')) saveRequests.push(request);
  });
  await page.getByRole('button', { name: '编辑笔记' }).click();
  await input.waitFor();
  await sidebar.click();
  await page.setViewportSize({ width: 390, height: 740 });
  assert.equal(await input.isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1100, height: 820 });
  await sidebar.click();
  await page.waitForTimeout(850);
  assert.equal(saveRequests.length, 0, 'entering edit does not write');
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let first;
  const started = new Promise((resolve) => {
    first = resolve;
  });
  await page.route('**/api/save', async (route) => {
    first();
    await held;
    await route.continue();
  });
  await input.fill('# 自动保存\n\n第一稿');
  await started;
  await input.fill('# 自动保存\n\n后续输入');
  release();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(readFileSync(file, 'utf8'), '# 自动保存\n\n后续输入');
  assert.equal(saveRequests.length, 2);
  await page.unroute('**/api/save');
  const count = saveRequests.length;
  await input.dispatchEvent('compositionstart');
  await input.fill('# 自动保存\n\n中文输入中');
  await page.waitForTimeout(850);
  assert.equal(saveRequests.length, count, 'IME composition does not save partial text');
  await input.dispatchEvent('compositionend');
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(readFileSync(file, 'utf8'), '# 自动保存\n\n中文输入中');
  await input.fill('# 自动保存\n\n切换前的最后修改');
  await page.keyboard.press('Control+o');
  await page.getByRole('combobox', { name: '按标题或路径查找' }).fill('代码笔记');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '代码笔记', exact: true }).waitFor();
  assert.equal(readFileSync(file, 'utf8'), '# 自动保存\n\n切换前的最后修改');
  record(
    'no write on edit entry; serialized autosave keeps in-flight typing and IME; navigation flushes',
  );

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('heading', { name: '自动保存', exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑笔记' }).click();
  writeFileSync(file, '# 外部修改\n\n来自另一个编辑器');
  await input.fill('# 我的草稿\n\n保留这个内容');
  await page.getByRole('alert').filter({ hasText: '文件已在其他地方修改' }).waitFor();
  assert.equal(readFileSync(file, 'utf8'), '# 外部修改\n\n来自另一个编辑器');
  await page.getByRole('button', { name: '代码笔记', exact: true }).click();
  assert.equal(await input.inputValue(), '# 我的草稿\n\n保留这个内容');
  assert.equal(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    true,
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.reader-editor textarea')?.value.includes('外部修改'),
  );
  await page.route('**/api/save', (route) => route.abort('failed'));
  await input.fill('# 断线草稿\n\n仍然保留');
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  assert.equal(await input.inputValue(), '# 断线草稿\n\n仍然保留');
  assert.equal(readFileSync(file, 'utf8'), '# 外部修改\n\n来自另一个编辑器');
  await page.unroute('**/api/save');
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(readFileSync(file, 'utf8'), '# 断线草稿\n\n仍然保留');
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await page.getByRole('heading', { name: '断线草稿', exact: true }).waitFor();
  record(
    'external edit conflict preserves both versions; unsaved navigation/close guard; failed-save draft and retry',
  );
  // Restore only our isolated fixture. Real user files are never edited in acceptance.
  writeFileSync(file, original);
}
