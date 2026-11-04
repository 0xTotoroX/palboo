/* [INPUT]: Real FeatureView/ModelView with synthetic owner handoff and model preferences.
 * [OUTPUT]: Catalog pins stay in the matrix until the user explicitly bookmarks a configuration; saved reasoning/Fast remain visible and apply together; immediate preset creation and legacy creation/rename drafts survive remount, failed saves and current-model changes; clearing is synchronous.
 * [POS]: Isolated browser regression; no native windows, real host or model requests.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {FeatureView} from './ui/surfaces/workspace/feature-session';
window.calls=[]; window.failSave=false; window.sequence=1;
window.alpha={model:'alpha',reasoning:'high',speed:'fast'};
window.beta={model:'beta',reasoning:'low',speed:'standard'};
window.model={revision:1,preferences:{enabled:true,pinned:['alpha','beta'],presets:[{id:'existing',name:'原名称',agent:'codex',selection:window.alpha}]},snapshot:{target:{id:'chat'},revision:'r1',status:'ready',message:'',current:window.alpha,models:[{id:'alpha',label:'Alpha',reasoning:['high'],fast:true},{id:'beta',label:'Beta',reasoning:['low'],fast:false}]}};
window.entry={id:'model',owner:'owner-1',placement:'sidebar',open:true,pending:null,view:{},size:[500,400],reveal:0};
if(window.legacyDraft) window.entry.view.modelPresetDraft={id:'legacy-create',name:'',selection:window.alpha,creating:true};
const notify=()=>{};
const request=async(input)=>{
  window.calls.push(structuredClone(input));
  if(input.owner!==window.entry.owner) throw Error('stale owner');
  if(input.op==='read') return structuredClone(window.model);
  if(input.op==='action') {
    if(input.action==='apply') {
      if (input.data.agent && window.agentSnapshots) {
        window.model.snapshot = structuredClone(window.agentSnapshots[input.data.agent]);
      } else window.model.snapshot.current=structuredClone(input.data.selection);
      window.model.snapshot.revision+='-applied';
      return structuredClone(window.model);
    }
    if(input.action!=='preferences') throw Error('unexpected model action');
    if(window.failSave) throw Error('模拟保存失败');
    if(input.data.revision!==window.model.revision) throw Error('stale revision');
    Object.assign(window.model.preferences,structuredClone(input.data.patch));
    window.model.revision++;
    return structuredClone(window.model);
  }
  return {};
};
window.render=()=>window.root.render(<FeatureView entry={window.entry} owner={window.entry.owner} request={request} onState={notify}/>);
window.mount=()=>{window.root=createRoot(document.getElementById('root'));window.render()};
window.beginMove=()=>{window.entry={...window.entry,pending:{owner:'owner-'+(++window.sequence),placement:window.entry.placement==='sidebar'?'desktop':'sidebar',ready:false}};window.render()};
window.finishMove=()=>{
  const capture=window.calls.findLast(c=>c.op==='handoff'&&c.pendingOwner===window.entry.pending.owner);
  if(!capture) throw Error('missing source handoff');
  window.root.unmount();
  window.entry={...window.entry,owner:window.entry.pending.owner,placement:window.entry.pending.placement,pending:null,view:structuredClone(capture.view)};
  window.model.snapshot.current=window.beta;
  window.mount();
};
window.editAndRemount=(name)=>{
  const input=document.querySelector('input[aria-label="预设名称"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,name);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  window.root.unmount();
  const capture=window.calls.findLast(c=>c.op==='save');
  window.entry={...window.entry,view:structuredClone(capture.view)};
  window.mount();
  return capture.view;
};
window.mount();`,
    },
    loader: { '.css': 'text' },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'text' },
  })
).outputFiles[0].text;

async function fixture(browser, legacyDraft = false) {
  const page = await browser.newPage();
  await page.route('http://localhost:19991/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="root" style="width:500px;height:400px"></div>',
    }),
  );
  await page.goto('http://localhost:19991/');
  if (legacyDraft) await page.evaluate(() => (window.legacyDraft = true));
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: '添加预设', exact: true }).waitFor();
  return page;
}
async function move(page) {
  await page.evaluate(() => window.beginMove());
  await page.waitForFunction(() =>
    window.calls.some((c) => c.op === 'handoff' && c.pendingOwner === window.entry.pending.owner),
  );
  const captured = await page.evaluate(() => window.calls.findLast((c) => c.op === 'handoff'));
  await page.evaluate(() => window.finishMove());
  await page.getByRole('button', { name: '添加预设', exact: true }).waitFor();
  return captured.view;
}

test('legacy preset creation draft survives owner handoff, failure, model changes and immediate unmount', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser, true);
    const input = page.getByRole('textbox', { name: '预设名称' });
    await input.fill('新增草稿');
    const first = (await move(page)).modelPresetDraft;
    assert.equal(first.name, '新增草稿');
    assert.equal(first.creating, true);
    assert.ok(first.id);
    assert.deepEqual(first.selection, { model: 'alpha', reasoning: 'high', speed: 'fast' });
    assert.equal(await input.inputValue(), first.name);
    assert.equal(await page.evaluate(() => window.model.snapshot.current.model), 'beta');
    await page.evaluate(() => (window.failSave = true));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
    assert.equal(await input.inputValue(), first.name);
    assert.deepEqual((await move(page)).modelPresetDraft, first);
    assert.equal(await input.inputValue(), first.name);
    // 同一浏览器任务内输入后立即卸载，不能等待被动 effect 才把文字交给 capture。
    const captured = await page.evaluate(() => window.editAndRemount('卸载前最后一次编辑'));
    assert.deepEqual(captured.modelPresetDraft, { ...first, name: '卸载前最后一次编辑' });
    await input.waitFor();
    assert.equal(await input.inputValue(), '卸载前最后一次编辑');
    await page.evaluate(() => (window.failSave = false));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    const saved = await page.evaluate(() => window.model.preferences.presets.at(-1));
    assert.deepEqual(saved, {
      id: first.id,
      name: '卸载前最后一次编辑',
      selection: first.selection,
    });
    assert.equal((await move(page)).modelPresetDraft, undefined);
    assert.equal(await input.count(), 0);
  } finally {
    await browser.close();
  }
});

test('rename draft retains identity and captured selection; cancel and Escape clear handoff state', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser);
    const input = page.getByRole('textbox', { name: '预设名称' });
    await page.getByRole('button', { name: '编辑预设', exact: true }).click();
    await page.getByRole('button', { name: '原名称 · High · Fast', exact: true }).click();
    await input.fill('改名草稿');
    const draft = (await move(page)).modelPresetDraft;
    assert.deepEqual(draft, {
      id: 'existing',
      name: '改名草稿',
      agent: 'codex',
      selection: { model: 'alpha', reasoning: 'high', speed: 'fast' },
      creating: false,
    });
    assert.equal(await input.inputValue(), draft.name);
    assert.equal(
      await page.locator('.model-preset-editor .model-preset-reasoning').innerText(),
      'High',
    );
    assert.equal(await page.locator('.model-preset-editor [data-icon="bolt-filled"]').count(), 1);
    await page.evaluate(() => (window.failSave = true));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
    assert.deepEqual((await move(page)).modelPresetDraft, draft);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await move(page)).modelPresetDraft, undefined);
    assert.equal(await input.count(), 0);
    assert.equal(await page.evaluate(() => window.model.preferences.presets[0].name), '原名称');
    await page.getByRole('button', { name: '原名称 · High · Fast', exact: true }).click();
    await input.fill('取消改名');
    await input.press('Escape');
    assert.equal((await move(page)).modelPresetDraft, undefined);
    assert.equal(await input.count(), 0);
    await page.getByRole('button', { name: '原名称 · High · Fast', exact: true }).click();
    await input.fill('保存改名');
    await move(page);
    await page.evaluate(() => (window.failSave = false));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.model.preferences.presets), [
      { id: 'existing', name: '保存改名', agent: 'codex', selection: draft.selection },
    ]);
    assert.equal((await move(page)).modelPresetDraft, undefined);
  } finally {
    await browser.close();
  }
});

test('add preset captures the current selection immediately and failed saves do not add a tag', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser);
    await page.evaluate(() => (window.failSave = true));
    await page.getByRole('button', { name: '添加预设', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
    assert.equal(await page.evaluate(() => window.model.preferences.presets.length), 1);
    assert.equal(await page.getByRole('textbox', { name: '预设名称' }).count(), 0);
    await page.evaluate(() => (window.failSave = false));
    await page.getByRole('button', { name: '添加预设', exact: true }).click();
    await page.getByRole('button', { name: 'Alpha · High · Fast', exact: true }).waitFor();
    const saved = await page.evaluate(() => window.model.preferences.presets.at(-1));
    assert.ok(saved.id);
    assert.deepEqual(saved.selection, { model: 'alpha', reasoning: 'high', speed: 'fast' });
    assert.equal((await move(page)).modelPresetDraft, undefined);
    assert.deepEqual(await page.evaluate(() => window.model.preferences.presets.at(-1)), saved);
  } finally {
    await browser.close();
  }
});

test('preset rename and add distinguish the Fast marker from a standard preset', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser);
    await page.evaluate(() => {
      window.model.preferences.presets.push({
        id: 'standard',
        agent: 'codex',
        name: 'Alpha',
        selection: { ...window.alpha, speed: 'standard' },
      });
    });
    await page
      .locator('.model-presets')
      .getByRole('button', { name: 'Alpha · High', exact: true })
      .waitFor();
    await page.getByRole('button', { name: '编辑预设', exact: true }).click();
    await page.getByRole('button', { name: '原名称 · High · Fast', exact: true }).click();
    await page.getByRole('textbox', { name: '预设名称' }).fill('Alpha');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('textbox', { name: '预设名称' }).waitFor({ state: 'detached' });
    assert.deepEqual(
      await page.evaluate(() => window.model.preferences.presets.map((p) => p.name)),
      ['Alpha', 'Alpha'],
    );
    await page.getByRole('button', { name: '编辑预设', exact: true }).click();
    await page.getByRole('button', { name: '添加预设', exact: true }).click();
    await page.getByRole('button', { name: 'Alpha 2 · High · Fast', exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.model.preferences.presets.at(-1).selection.speed),
      'fast',
    );
  } finally {
    await browser.close();
  }
});

test('presets show and apply saved reasoning independently of the current model and keep unavailable choices readable', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser);
    const initial = await page.evaluate(() => {
      window.model.snapshot.models[0].reasoning.push('low', 'none');
      window.model.snapshot.models.push({
        id: 'basic',
        agent: 'codex',
        label: 'Basic',
        reasoning: [],
        fast: false,
      });
      window.model.preferences.presets.push(
        {
          id: 'high',
          agent: 'codex',
          name: 'Alpha',
          selection: { ...window.alpha, speed: 'standard' },
        },
        {
          id: 'low',
          agent: 'codex',
          name: 'Alpha',
          selection: { ...window.alpha, reasoning: 'low', speed: 'standard' },
        },
        {
          id: 'none',
          agent: 'codex',
          name: 'Alpha',
          selection: { ...window.alpha, reasoning: 'none', speed: 'standard' },
        },
        {
          id: 'basic',
          agent: 'codex',
          name: 'Basic',
          selection: { model: 'basic', reasoning: '', speed: 'standard' },
        },
        {
          id: 'missing',
          agent: 'codex',
          name: '旧模型',
          selection: { model: 'missing', reasoning: 'ultra', speed: 'fast' },
        },
      );
      window.model.snapshot.current = window.beta;
      return structuredClone(window.model.preferences.presets);
    });
    const presets = page.locator('.model-presets');
    const low = presets.getByRole('button', { name: 'Alpha · Low', exact: true });
    const high = presets.getByRole('button', { name: 'Alpha · High', exact: true });
    const fast = presets.getByRole('button', { name: '原名称 · High · Fast', exact: true });
    const unavailable = presets.getByRole('button', { name: '旧模型 · Ultra · Fast', exact: true });
    await low.waitFor();
    assert.equal(await low.innerText(), 'Alpha · Low');
    assert.equal(await high.innerText(), 'Alpha · High');
    assert.equal(await fast.innerText(), '原名称 · High');
    assert.equal(await fast.getAttribute('title'), 'Alpha · High · Fast');
    assert.equal(
      await presets.getByRole('button', { name: 'Alpha · None', exact: true }).innerText(),
      'Alpha · None',
    );
    assert.equal(
      await presets
        .getByRole('button', { name: 'Basic', exact: true })
        .locator('.model-preset-reasoning')
        .count(),
      0,
    );
    assert.equal(await unavailable.getAttribute('aria-disabled'), 'true');
    await unavailable.click({ force: true });
    assert.equal(
      await page.evaluate(() => window.calls.filter((c) => c.op === 'action').length),
      0,
    );
    assert.deepEqual(await page.evaluate(() => window.model.preferences.presets), initial);

    await low.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        window.model.snapshot.current.reasoning === 'low' &&
        window.model.snapshot.current.model === 'alpha',
    );
    assert.equal(await low.getAttribute('aria-pressed'), 'true');
    assert.equal(await high.getAttribute('aria-pressed'), 'false');
    await fast.click();
    await page.waitForFunction(() => window.model.snapshot.current.speed === 'fast');
    const applied = await page.evaluate(() =>
      window.calls.filter((c) => c.action === 'apply').map((c) => c.data),
    );
    assert.deepEqual(
      applied.map((c) => c.selection),
      [
        { model: 'alpha', reasoning: 'low', speed: 'standard' },
        { model: 'alpha', reasoning: 'high', speed: 'fast' },
      ],
    );
    assert.ok(
      applied.every(
        (c) => c.target.id === 'chat' && c.expectedRevision && c.preserveSpeed === false,
      ),
    );
    assert.equal(await fast.getAttribute('aria-pressed'), 'true');
    assert.equal(await low.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await page.evaluate(() => window.model.preferences.presets), initial);
  } finally {
    await browser.close();
  }
});

test('catalog pins stay in the matrix and only the bookmark creates visible presets', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const agent of ['codex', 'antigravity']) {
      const page = await fixture(browser);
      await page.evaluate((agent) => {
        window.root.unmount();
        window.model.preferences.pinned = [];
        window.model.preferences.presets = [
          { id: 'unknown', name: '来源未知', selection: window.beta },
          { id: 'old-pin', name: 'Alpha', agent, catalogPin: true, selection: window.alpha },
        ];
        window.model.snapshot.agent = { current: agent, label: agent, locked: false, options: [] };
        window.mount();
      }, agent);
      assert.equal(await page.locator('.model-preset-choice').count(), 0);
      const before = await page.evaluate(() => window.model.preferences.presets);
      await page.getByRole('button', { name: '所有模型', exact: true }).click();
      await page.locator('[data-model-tile="beta"]').click();
      await page.locator('[data-model-tile="beta"][aria-pressed="true"]').waitFor();
      assert.deepEqual(await page.evaluate(() => window.model.preferences.presets), before);
      const pins = await page.evaluate((agent) => {
        const prefs = window.model.preferences;
        return agent === 'codex' ? prefs.pinned : prefs.agentOrganizations[agent].pinned;
      }, agent);
      assert.deepEqual(pins, ['beta']);
      await page.getByRole('button', { name: '关闭所有模型', exact: true }).click();
      assert.deepEqual(
        await page
          .locator('.model-row')
          .evaluateAll((rows) => rows.map((row) => row.dataset.modelRow).sort()),
        ['alpha', 'beta'],
      );
      assert.equal(await page.locator('.model-preset-choice').count(), 0);
      await page.locator('[data-model="alpha"][data-reasoning="high"]').click();
      assert.deepEqual(await page.evaluate(() => window.model.preferences.presets), before);
      await page.getByRole('button', { name: '添加预设', exact: true }).click();
      await page
        .locator('.model-presets')
        .getByRole('button', { name: 'Alpha · High', exact: true })
        .waitFor();
      const saved = await page.evaluate(() => window.model.preferences.presets);
      assert.deepEqual(saved.slice(0, 2), before, 'legacy and catalog records stay unchanged');
      assert.equal(saved[2].agent, agent);
      assert.equal(saved[2].catalogPin, undefined);
      assert.equal(saved[2].name, 'Alpha', 'hidden catalog pins do not number saved preset names');
      await page.getByRole('button', { name: '所有模型', exact: true }).click();
      await page.locator('[data-model-tile="alpha"]').click();
      await page.locator('[data-model-tile="alpha"][aria-pressed="false"]').waitFor();
      assert.deepEqual(
        await page.evaluate(() => window.model.preferences.presets.map((p) => p.id)),
        ['unknown', saved[2].id],
        'unpinning an old catalog entry preserves the explicitly saved preset',
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('switching CLI returns to the target matrix and isolates presets, pins and manufacturers', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser);
    await page.evaluate(() => {
      window.root.unmount();
      const options = [
        { id: 'codex', label: 'Codex', available: true },
        { id: 'antigravity', label: 'Antigravity CLI', available: true },
      ];
      window.model.snapshot.agent = { current: 'codex', label: 'Codex', locked: true, options };
      window.model.preferences.modelOverrides = { beta: { manufacturer: 'Codex Vendor' } };
      window.model.preferences.presets.push(
        { id: 'unknown', name: '来源未知', selection: window.beta },
        { id: 'external', name: 'Antigravity 专用', agent: 'antigravity', selection: window.beta },
      );
      window.model.preferences.agentOrganizations = {
        antigravity: {
          pinned: ['beta'],
          modelOverrides: { beta: { manufacturer: 'Antigravity Vendor' } },
        },
      };
      window.agentSnapshots = {
        antigravity: {
          ...window.model.snapshot,
          target: { id: 'fresh-chat' },
          current: window.beta,
          models: [{ id: 'beta', label: 'External Beta', reasoning: ['low'], fast: false }],
          agent: { current: 'antigravity', label: 'Antigravity CLI', locked: false, options },
        },
      };
      window.mount();
    });
    await page.getByRole('button', { name: '原名称 · High · Fast', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Antigravity 专用|来源未知/ }).count(), 0);
    await page.getByRole('button', { name: '所有模型', exact: true }).click();
    await page.getByRole('region', { name: 'Codex Vendor' }).waitFor();
    await page.getByText('切换 Agent 会新建聊天', { exact: true }).waitFor();
    await page.locator('[data-agent-option="antigravity"]').click();
    await page
      .locator('.model-current-agent')
      .getByText('Antigravity CLI', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Antigravity 专用 · Low', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: '所有模型' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /原名称|来源未知/ }).count(), 0);
    assert.deepEqual(
      await page.locator('.model-row').evaluateAll((nodes) => nodes.map((n) => n.dataset.modelRow)),
      ['beta'],
    );
    await page.getByRole('button', { name: '所有模型', exact: true }).click();
    await page.getByRole('region', { name: 'Antigravity Vendor' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Codex Vendor' }).count(), 0);
    await page.locator('[data-model-tile="beta"]').click();
    await page.locator('[data-model-tile="beta"][aria-pressed="false"]').waitFor();
    const stored = await page.evaluate(() => window.model.preferences);
    assert.deepEqual(stored.pinned, ['alpha', 'beta']);
    assert.deepEqual(stored.agentOrganizations.antigravity.pinned, []);
    assert.deepEqual(
      stored.presets.find((p) => p.id === 'unknown'),
      {
        id: 'unknown',
        name: '来源未知',
        selection: { model: 'beta', reasoning: 'low', speed: 'standard' },
      },
    );
  } finally {
    await browser.close();
  }
});
