/* [INPUT]: Actual next view, retained reading state and synthetic revision-checked settings.
 * [OUTPUT]: Add/edit/delete confirmation, draft retention, conflict/failed save protection and no accidental sending.
 * [POS]: Isolated browser tests; no real settings or chat writes. [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const script = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import {createNextView} from './ui/features/next/view.js';
window.reading={};window.calls=[];window.saves=[];window.fail=false;window.pending=false;
window.snapshot={settings:{configurationRevision:1,generationMode:'manual',quickPrompts:[{label:'继续',prompt:'继续'},{label:'执行',prompt:'执行'}]},display:{promptClickMode:'fill'},prompts:[],promptToken:'same',bridgeStatus:'ready'};
let view;window.mount=()=>{view?.clear();view=createNextView({read:()=>snapshot,reading,command:(...args)=>calls.push(args),saveQuickPrompts:async(items,revision)=>{saves.push({items,revision});if(pending)await new Promise(resolve=>window.finish=resolve);if(fail)throw Error('保存失败');if(revision!==snapshot.settings.configurationRevision)throw Error('设置已在其他窗口更新');snapshot.settings={...snapshot.settings,quickPrompts:items,configurationRevision:revision+1};return snapshot.settings;}});document.querySelector('#root').innerHTML=view.html();view.bind(document.querySelector('#root'));};mount();`,
    },
    bundle: true,
    write: false,
    format: 'iife',
  })
).outputFiles[0].text;
async function fixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 360, height: 760 } });
  await page.setContent(
    `<style>body{font:14px sans-serif;--csw-text:#222;--csw-muted:#777;--csw-surface-opaque:#fafafa;--csw-hover:#eee;--csw-divider:#ddd}*{box-sizing:border-box}${readFileSync('ui/features/content.css', 'utf8')}</style><div id=root></div>`,
  );
  await page.addScriptTag({ content: script });
  return page;
}
test('quick prompt editor adds, edits, confirms deletion and keeps unfinished input', async (t) => {
  const page = await fixture(t);
  assert.equal(
    await page
      .getByRole('button', { name: '编辑快捷指令', exact: true })
      .locator('svg')
      .getAttribute('data-icon'),
    'pencil',
  );
  await page.getByRole('button', { name: '添加快捷指令', exact: true }).click();
  await page.getByLabel('快捷指令名称', { exact: true }).fill('解释');
  await page.getByLabel('快捷指令内容', { exact: true }).fill('解释刚才的概念');
  await page.evaluate(() => mount());
  assert.equal(
    await page.getByLabel('快捷指令内容', { exact: true }).inputValue(),
    '解释刚才的概念',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '解释', exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑快捷指令', exact: true }).click();
  await page.getByRole('button', { name: '解释', exact: true }).click();
  await page.getByLabel('快捷指令名称', { exact: true }).fill('说明');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '说明', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => calls), []);
  await page.getByRole('button', { name: '删除快捷指令 说明', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => saves.length), 2);
  await page.getByRole('button', { name: '删除快捷指令 说明', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.waitForFunction(() => snapshot.settings.quickPrompts.length === 2);
  await page.getByRole('button', { name: '完成编辑快捷指令', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.waitForFunction(() => calls.length === 1);
  assert.deepEqual(await page.evaluate(() => calls[0]), [
    'quick-fill',
    { index: 0, submit: false },
  ]);
});
test('quick prompt failures and external conflicts retain drafts without retries or overwrites', async (t) => {
  const page = await fixture(t);
  await page.getByRole('button', { name: '添加快捷指令', exact: true }).click();
  await page.getByLabel('快捷指令名称', { exact: true }).fill('测试');
  await page.getByLabel('快捷指令内容', { exact: true }).fill('保留草稿');
  await page.evaluate(() => {
    pending = true;
    fail = true;
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await page.getByLabel('快捷指令内容', { exact: true }).isDisabled(), true);
  await page.evaluate(() => finish());
  await page.getByRole('status').filter({ hasText: '保存失败' }).waitFor();
  assert.equal(await page.getByLabel('快捷指令内容', { exact: true }).inputValue(), '保留草稿');
  assert.equal(await page.evaluate(() => saves.length), 1);
  await page.evaluate(() => {
    pending = false;
    fail = false;
    snapshot.settings.configurationRevision = 2;
    mount();
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '设置已在其他窗口更新' }).waitFor();
  assert.equal(await page.evaluate(() => snapshot.settings.quickPrompts.length), 2);
  assert.equal(await page.getByLabel('快捷指令内容', { exact: true }).inputValue(), '保留草稿');
  await page.getByLabel('快捷指令名称', { exact: true }).press('Escape');
  assert.equal(await page.locator('.csw-quick-editor').count(), 0);
  assert.equal(await page.evaluate(() => saves.length), 2);
  await page.evaluate(() => {
    snapshot.settings.quickPrompts = [];
    mount();
  });
  await page.getByRole('button', { name: '添加快捷指令', exact: true }).click();
  assert.equal(await page.getByLabel('快捷指令名称', { exact: true }).inputValue(), '');
});
