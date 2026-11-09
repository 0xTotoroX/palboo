/* [INPUT]: Isolated settings/reader pages, synthetic source folders and their local API.
 * [OUTPUT]: Folder addition, independent tabs, guarded switching and selective removal acceptance.
 * [POS]: Only temporary test files are edited; never touches user directories or a real host.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function exerciseReaderFolders({
  page,
  context,
  settings,
  api,
  vault,
  folder,
  wait,
  record,
}) {
  const secondPath = join(folder, '第二笔记库');
  mkdirSync(secondPath);
  const secondText = '# 第二个文件夹\n\n独立正文 second-only\n\n[[首页]]';
  writeFileSync(join(secondPath, '首页.md'), secondText);
  const firstFile = join(vault, '首页.md');
  const original = readFileSync(firstFile, 'utf8');
  const primary = (await api('web-library/reader')).url;
  const before = await api('web-library');
  await settings.getByRole('button', { name: '添加文件夹', exact: true }).click();
  await settings.locator('#reader-folder-name').fill('项目笔记');
  await settings.locator('#reader-vault').fill(secondPath);
  assert.equal(
    (await api('web-library')).revision,
    before.revision,
    'typing does not grant access',
  );
  await settings.getByRole('region', { name: '添加文件夹', exact: true }).press('Escape');
  await settings.getByRole('button', { name: '添加文件夹', exact: true }).click();
  assert.equal(await settings.locator('#reader-vault').inputValue(), secondPath);
  await settings
    .getByRole('region', { name: '添加文件夹', exact: true })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await settings
    .locator('.reader-folder-list .web-library-open')
    .filter({ hasText: '项目笔记' })
    .waitFor();
  const configured = await api('web-library');
  assert.equal(configured.folders.length, 2);
  assert.equal(
    (await api('web-library/reader')).url,
    primary,
    'adding a folder keeps existing tabs authorized',
  );
  const secondary = configured.folders.find((item) => item.name === '项目笔记');
  await settings.getByRole('button', { name: '编辑项目笔记', exact: true }).click();
  await settings.locator('#reader-folder-name').fill('尚未保存的名称');
  await settings.getByRole('region', { name: '编辑文件夹', exact: true }).press('Escape');
  await settings.getByRole('button', { name: '编辑项目笔记', exact: true }).click();
  assert.equal(await settings.locator('#reader-folder-name').inputValue(), '尚未保存的名称');
  await settings
    .getByRole('region', { name: '编辑文件夹', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  let launched;
  await settings.route('**/api/web-library/open', async (route) => {
    launched = route.request().postDataJSON().id;
    await route.fulfill({ json: { ok: true } });
  });
  await settings
    .locator('.reader-folder-list .web-library-open')
    .filter({ hasText: '项目笔记' })
    .click();
  assert.equal(launched, `folder:${secondary.id}`);
  await settings.unroute('**/api/web-library/open');
  record(
    'multiple folders appear in the foreground list and launch independently; adding preserves existing reader access',
  );
  const parsed = new URL(primary);
  const switchResult = await fetch(`${parsed.origin}/api/folder-open`, {
    method: 'POST',
    headers: {
      Origin: parsed.origin,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${new URLSearchParams(parsed.hash.slice(1)).get('reader')}`,
      'X-Palboo-Folder': parsed.searchParams.get('folder'),
    },
    body: JSON.stringify({ id: secondary.id }),
  });
  assert.equal(switchResult.ok, true);
  const secondURL = (await switchResult.json()).url;
  const secondPage = await context.newPage();
  try {
    await page.goto(primary);
    await secondPage.goto(secondURL);
    await page
      .locator('.reader-sidebar')
      .getByRole('button', { name: '首页', exact: true })
      .click();
    await secondPage
      .locator('.reader-sidebar')
      .getByRole('button', { name: '首页', exact: true })
      .click();
    await page.getByRole('heading', { name: '欢迎', exact: true }).waitFor();
    await secondPage.getByRole('heading', { name: '第二个文件夹', exact: true }).waitFor();
    assert.equal(new URL(secondPage.url()).searchParams.get('folder'), secondary.id);
    await secondPage.reload();
    await secondPage.getByRole('heading', { name: '第二个文件夹', exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑笔记', exact: true }).click();
    await page
      .getByRole('textbox', { name: '编辑 Markdown', exact: true })
      .fill('# 第一个文件夹保存');
    await page
      .getByRole('combobox', { name: '切换笔记文件夹', exact: true })
      .selectOption(secondary.id);
    await page.waitForURL((url) => url.searchParams.get('folder') === secondary.id);
    assert.equal(readFileSync(firstFile, 'utf8'), '# 第一个文件夹保存');
    assert.equal(readFileSync(join(secondPath, '首页.md'), 'utf8'), secondText);
    await page
      .locator('.reader-sidebar')
      .getByRole('button', { name: '首页', exact: true })
      .click();
    await page.getByRole('heading', { name: '第二个文件夹', exact: true }).waitFor();
    await secondPage.getByRole('button', { name: '编辑笔记', exact: true }).click();
    await secondPage
      .getByRole('textbox', { name: '编辑 Markdown', exact: true })
      .fill('# 第二个文件夹保存');
    await secondPage.getByText('已保存', { exact: true }).waitFor();
    assert.equal(readFileSync(join(secondPath, '首页.md'), 'utf8'), '# 第二个文件夹保存');
    assert.equal(readFileSync(firstFile, 'utf8'), '# 第一个文件夹保存');
    await secondPage.getByRole('button', { name: '完成编辑', exact: true }).click();
    await page
      .getByRole('combobox', { name: '切换笔记文件夹', exact: true })
      .selectOption(configured.folders[0].id);
    await page.waitForURL((url) => url.searchParams.get('folder') === configured.folders[0].id);
    await page
      .locator('.reader-sidebar')
      .getByRole('button', { name: '首页', exact: true })
      .click();
    await page.getByRole('heading', { name: '第一个文件夹保存', exact: true }).waitFor();
    record(
      'two tabs with identical note names stay isolated; switching flushes edits to the original folder; reload retains folder identity',
    );
    await settings.getByRole('button', { name: '移除项目笔记', exact: true }).click();
    await settings.getByRole('button', { name: '确认', exact: true }).click();
    await wait(async () => (await api('web-library')).folders.length === 1, 'remove second folder');
    assert.equal((await api('web-library/reader')).url, primary);
    await secondPage.reload();
    await secondPage.getByRole('alert').filter({ hasText: '笔记文件夹已移除' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '第一个文件夹保存', exact: true }).waitFor();
    assert.equal(readFileSync(join(secondPath, '首页.md'), 'utf8'), '# 第二个文件夹保存');
    record(
      'removing one folder revokes only its tabs, preserves the other folder and never deletes files',
    );
  } finally {
    writeFileSync(firstFile, original);
    await secondPage.close();
  }
}
