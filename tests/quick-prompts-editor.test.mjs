/* [INPUT]: Actual standalone phrase view, retained reading state and synthetic revision-checked settings.
 * [OUTPUT]: Content disclosure and optional-name display, add/edit/delete confirmation, retained failure drafts and guarded execution.
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
      contents: `import {createQuickPromptsView} from './ui/features/quick-prompts.js';
import {setLocale} from './ui/shared/i18n.js'; window.setLocale=setLocale;
window.reading={};window.calls=[];window.saves=[];window.fail=false;window.pending=false;
window.snapshot={settings:{enabled:false,quickPromptsEnabled:true,quickPromptClickMode:null,quickPromptLabelOnly:false,configurationRevision:1,generationMode:'manual',quickPrompts:[{label:'继续',prompt:'继续'},{label:'执行',prompt:'执行'}]},display:{promptClickMode:'fill'},prompts:[],promptToken:'same',bridgeStatus:'ready'};
let view;window.mount=()=>{view?.clear();view=createQuickPromptsView({read:()=>snapshot,reading,command:(...args)=>calls.push(args),saveQuickPrompts:async(items,revision)=>{saves.push({items,revision});if(pending)await new Promise(resolve=>window.finish=resolve);if(fail)throw Error('保存失败');if(revision!==snapshot.settings.configurationRevision)throw Error('设置已在其他窗口更新');snapshot.settings={...snapshot.settings,quickPrompts:items,configurationRevision:revision+1};return snapshot.settings;}});document.querySelector('#root').innerHTML=view.html();view.bind(document.querySelector('#root'));};window.disable=(value)=>view.setDisabled(value);mount();`,
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
test('standalone quick phrases keep click modes and ignore suggestion refreshes', async (t) => {
  const page = await fixture(t);
  assert.equal(await page.locator('.csw-next-layout, .csw-empty, .csw-progress').count(), 0);
  for (const mode of ['fill', 'direct', 'hybrid']) {
    await page.evaluate((value) => {
      snapshot.settings.quickPromptClickMode = value;
      calls.length = 0;
      mount();
    }, mode);
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await page.evaluate(() => {
      snapshot.promptToken = 'another-generation';
      snapshot.bridgeStatus = 'failed';
    });
    await page.waitForFunction(() => calls.length === 1);
    assert.deepEqual(await page.evaluate(() => calls[0]), [
      'quick-fill',
      { index: 0, submit: mode === 'direct' },
    ]);
    await page.evaluate(() => {
      calls.length = 0;
    });
    await page.getByRole('button', { name: '执行', exact: true }).dblclick();
    await page.waitForFunction(() => calls.length === 1);
    assert.deepEqual(await page.evaluate(() => calls[0]), [
      'quick-fill',
      { index: 1, submit: mode !== 'fill' },
    ]);
  }
  await page.evaluate(() => {
    calls.length = 0;
  });
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.evaluate(() => {
    snapshot.settings.quickPrompts[0].prompt = 'changed';
  });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => calls.length), 0);
});
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

test('content-first phrases separate reading from execution and retain disclosure across updates', async (t) => {
  const page = await fixture(t);
  const prompt =
    '检查方案：\n第一步，检查布局。\n第二步，核对内容。\n第三步，给出修改建议。\n保留已确认的主题。';
  await page.evaluate((prompt) => {
    snapshot.settings.quickPrompts = [
      { label: '审查', prompt },
      { label: '继续', prompt: '继续' },
    ];
    mount();
  }, prompt);
  const phrase = page.getByRole('button', { name: '审查', exact: true });
  const body = phrase.locator('.csw-quick-text');
  assert.equal(await body.textContent(), prompt);
  assert.equal(await phrase.evaluate((node) => getComputedStyle(node).textDecorationLine), 'none');
  assert.equal(
    await page
      .getByRole('button', { name: '继续', exact: true })
      .locator('.csw-quick-caption')
      .count(),
    0,
  );
  assert.ok(
    (await page.getByRole('button', { name: '继续', exact: true }).boundingBox()).height < 60,
  );
  const before = (await body.boundingBox()).height;
  await page.evaluate(() => disable(true));
  assert.equal(await phrase.isDisabled(), true);
  await page.getByRole('button', { name: '展开全文', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.ok((await body.boundingBox()).height > before);
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => calls), []);
  await page.evaluate(() => mount());
  assert.equal(
    await page.getByRole('button', { name: '收起内容' }).getAttribute('aria-expanded'),
    'true',
  );
  await page.getByRole('button', { name: '收起内容' }).click();
  assert.equal((await body.boundingBox()).height, before);
  await page.evaluate(() => disable(false));
  await phrase.click();
  await page.waitForFunction(() => calls.length === 1);
  assert.deepEqual(await page.evaluate(() => calls[0]), [
    'quick-fill',
    { index: 0, submit: false },
  ]);
});

test('optional names save blank and name-only mode falls back without changing content', async (t) => {
  const page = await fixture(t);
  const prompt = '请用更直白的语言解释，并举一个具体例子。\n保留所有关键条件。';
  await page.getByRole('button', { name: '添加快捷指令', exact: true }).click();
  assert.equal(
    await page
      .getByLabel('快捷指令内容', { exact: true })
      .evaluate((node) => document.activeElement === node),
    true,
  );
  assert.equal(
    await page.getByLabel('快捷指令名称', { exact: true }).getAttribute('required'),
    null,
  );
  await page.getByLabel('快捷指令内容', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => snapshot.settings.quickPrompts.length === 3);
  assert.deepEqual(await page.evaluate(() => snapshot.settings.quickPrompts[2]), {
    label: '',
    prompt,
  });
  await page.evaluate(() => {
    snapshot.settings.quickPromptLabelOnly = true;
    mount();
  });
  const firstLine = Array.from(prompt.split('\n')[0]);
  const fallback = firstLine.slice(0, 20).join('') + (firstLine.length > 20 ? '…' : '');
  assert.equal(
    await page.getByRole('button', { name: fallback, exact: true }).textContent(),
    fallback,
  );
  assert.equal(await page.locator('[data-quick-expand]').count(), 0);
  await page.getByRole('button', { name: fallback, exact: true }).click();
  await page.waitForFunction(() => calls.length === 1);
  assert.deepEqual(await page.evaluate(() => calls[0]), [
    'quick-fill',
    { index: 2, submit: false },
  ]);
  assert.deepEqual(await page.evaluate(() => snapshot.settings.quickPrompts[2]), {
    label: '',
    prompt,
  });
});

test('disclosure follows actual wrapping and responds to resizing, language and hidden mounts', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    snapshot.settings.quickPrompts = [
      {
        label: 'Review',
        prompt:
          'Please check the plan and list concrete changes, keeping the visual style we agreed on. '.repeat(
            3,
          ),
      },
    ];
    setLocale('en');
    document.querySelector('#root').hidden = true;
    mount();
  });
  await page.evaluate(() => (document.querySelector('#root').hidden = false));
  await page.getByRole('button', { name: 'Show full text' }).waitFor();
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.getByRole('button', { name: 'Show full text' }).waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 240, height: 760 });
  await page.getByRole('button', { name: 'Show full text' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Show full text' }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Collapse text' }).getAttribute('aria-expanded'),
    'true',
  );
  assert.deepEqual(await page.evaluate(() => calls), []);
});
