/* [INPUT]: Real window menu, layout controller and isolated synthetic feature nodes.
 * [OUTPUT]: Preset switching preserves DOM/drafts/scroll; aligned settings fields, menu keyboard, save failure and pin interactions remain usable.
 * [POS]: Browser regression without host data, screenshots or native permissions.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

async function fixture(page, placement = 'desktop', ids = ['outline', 'next', 'prompts']) {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
import {installStyle} from './ui/surfaces/embedded/shell/install-styles.js';
import {workbenchHeadHtml} from './ui/surfaces/workspace/chrome.js';
import {installFeatureLayout} from './ui/surfaces/workspace/layout.js';
import {installWindowMenu} from './ui/surfaces/workspace/window-menu.js';
import {setLocale} from './ui/shared/i18n.js';
const placement=${JSON.stringify(placement)};window.changeLocale=setLocale;window.__buddyNativeChrome=placement==='desktop';installStyle();
if(placement==='desktop')document.documentElement.dataset.nativeBackdrop='true';
const host=document.querySelector('#root');host.innerHTML='<div class="csw-workbench">'+workbenchHeadHtml(placement==='desktop')+'</div>';
const root=host.firstElementChild;
const paired={axis:'vertical',groups:[{ids:['outline'],active:'outline',weight:1},{ids:['next','prompts'],active:'next',weight:1}],visible:['outline','next','prompts']};
const focused={...structuredClone(paired),visible:['outline']};
window.state={mainPlacement:placement,layoutPresetsRevision:1,layouts:{[placement]:paired},layoutPresets:[{id:'paired',name:'对照',scope:placement,layout:paired},{id:'focused',name:'专注',scope:placement,layout:focused}],features:${JSON.stringify(ids)}.map(id=>({id,open:true,placement,owner:id}))};
window.requests=[];window.pins=[];window.pinned=true;window.rejectSave=false;
const items=state.features.map(entry=>{const node=document.createElement('div');node.style.cssText='height:100%;min-height:0';const shadow=node.attachShadow({mode:'open'});shadow.innerHTML='<div data-scroll style="height:100%;overflow:auto"><input aria-label="'+entry.id+'草稿" value="未保存内容"><div style="height:900px">Synthetic content</div></div>';return {...entry,node,active:true}});
window.originalNodes=items.map(item=>item.node);
const composition=installFeatureLayout(root,{save:async(surface,next)=>{state.layouts[surface]=next},error:e=>{throw e}});
const refresh=async()=>{composition.update(items,placement,state.layouts[placement],null,'next',1);menu.update(state,pinned)};
const request=async input=>{
 requests.push(structuredClone(input));
 if(input.op==='main-preset-apply')state.layouts[placement]=structuredClone(state.layoutPresets.find(p=>p.id===input.id).layout);
 else if(input.op==='layout')state.layouts[placement]=structuredClone(input.layout);
 else if(input.op==='main-preset-save'){
  if(rejectSave)throw Error('保存失败，请重试');
  state.layoutPresets.push({id:'saved',name:input.name,scope:input.placement==='sidebar'?'sidebar':'overlay',layout:input.layout});state.layoutPresetsRevision++;
 }
 return state;
};
const menu=installWindowMenu(root.querySelector('.csw-workbench-controls'),{request,...(placement==='desktop'?{lease:'test',pin:async value=>{pinned=value;pins.push(value)}}:{}),layout:()=>composition.snapshot(),canUndo:()=>composition.canUndo(),undo:()=>composition.undo(),settings:async()=>{window.settingsOpened=true},refresh,isBusy:()=>false});
window.refresh=refresh;window.switchSurface=surface=>composition.update(items,surface,state.layouts[placement],null,'next',1);refresh();
`,
        loader: 'js',
      },
      bundle: true,
      write: false,
      loader: { '.css': 'text' },
      define: { PALBOO_DEVELOPMENT: 'true' },
    })
  ).outputFiles[0].text;
  await page.setContent(
    '<div id="root" data-companion-stepwise-root="true" data-workbench="true" style="position:fixed;inset:12px;pointer-events:auto;--csw-text:#222;--csw-muted:#777;--csw-surface-opaque:#fff;--csw-hover:#eee;--csw-divider:#ddd"></div>',
  );
  await page.addScriptTag({ content: script });
  await page
    .getByRole('button', { name: placement === 'desktop' ? '窗口操作' : '布局预设', exact: true })
    .waitFor();
}

test('desktop presets preserve mounted drafts and reading through hide, restore and surface changes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 500, height: 680 },
      reducedMotion: 'reduce',
    });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await fixture(page);
    await page.getByLabel('next草稿').fill('切换布局后保留');
    await page.getByLabel('next草稿').evaluate((node) => (node.parentElement.scrollTop = 240));
    const before = await page
      .getByLabel('next草稿')
      .evaluate((node) => node.parentElement.scrollTop);
    const menu = page.getByRole('button', { name: '窗口操作', exact: true });
    const triggerBox = await menu.boundingBox();
    assert.deepEqual([triggerBox.width, triggerBox.height], [28, 28]);
    assert.equal(triggerBox.y + triggerBox.height / 2, 34);
    await page.getByRole('tab', { name: '大纲', exact: true }).dblclick();
    assert.equal(await page.locator('.csw-workbench').getAttribute('data-composition'), 'focus');
    await menu.click();
    const system = page.getByRole('group', { name: '系统预设', exact: true });
    const custom = page.getByRole('group', { name: '自定义预设', exact: true });
    assert.deepEqual(
      (await system.getByRole('menuitemradio').allTextContents()).map((label) => label.trim()),
      ['顶部标签', '左侧标签', '双栏'],
    );
    assert.equal(
      await custom
        .getByRole('menuitemradio', { name: '专注', exact: true })
        .locator('[data-icon="bookmark"]')
        .count(),
      1,
    );
    await page.getByRole('menuitemradio', { name: '专注', exact: true }).click();
    assert.equal(await page.locator('.csw-workbench').getAttribute('data-composition'), 'tabs');
    assert.equal(await page.getByLabel('next草稿').isVisible(), false);
    assert.equal(await page.getByLabel('next草稿').count(), 1);
    await menu.click();
    await page.getByRole('menuitemradio', { name: '对照', exact: true }).click();
    assert.equal(await page.getByLabel('next草稿').inputValue(), '切换布局后保留');
    assert.equal(
      await page.getByLabel('next草稿').evaluate((node) => node.parentElement.scrollTop),
      before,
    );
    assert.equal(
      await page
        .getByLabel('next草稿')
        .evaluate((node) => node.getRootNode().host === originalNodes[1]),
      true,
    );
    for (const surface of ['sidebar', 'overlay', 'desktop']) {
      await page.evaluate((surface) => switchSurface(surface), surface);
      assert.equal(await page.getByLabel('next草稿').inputValue(), '切换布局后保留');
    }
    await menu.focus();
    await menu.press('ArrowDown');
    assert.equal(
      await page
        .getByRole('menuitemcheckbox', { name: '窗口置顶', exact: true })
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => pins), [false]);
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await menu.click();
    await page.getByRole('menuitem', { name: '保存布局…', exact: true }).click();
    await page.getByLabel('预设名称', { exact: true }).fill('我的组合');
    await page.evaluate(() => (rejectSave = true));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
    assert.equal(await page.getByLabel('预设名称', { exact: true }).inputValue(), '我的组合');
    await page.evaluate(() => (rejectSave = false));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => state.layoutPresets.some((p) => p.name === '我的组合'));
    const save = await page.evaluate(() =>
      requests.filter((r) => r.op === 'main-preset-save').at(-1),
    );
    assert.deepEqual(save.layout.visible, ['outline', 'next', 'prompts']);
    assert.equal('alwaysOnTop' in save, false);
    await page.setViewportSize({ width: 324, height: 364 });
    await menu.click();
    const box = await page.getByRole('menu').boundingBox();
    assert.ok(box.x >= 12 && box.x + box.width <= 312);
    assert.ok(box.y + box.height <= 352);
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => {
      changeLocale('en');
      return refresh();
    });
    await page.getByRole('button', { name: 'Window actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Save layout…', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('side-by-side tab bars merge at the header and built-in presets position all tabs', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 920, height: 680 },
      reducedMotion: 'reduce',
    });
    page.setDefaultTimeout(5000);
    await fixture(page);
    await page.evaluate(() => {
      state.layouts.desktop = {
        axis: 'horizontal',
        groups: [
          { ids: ['outline'], active: 'outline', weight: 2 },
          { ids: ['next'], active: 'next', weight: 1 },
          { ids: ['prompts'], active: 'prompts', weight: 2.4 },
        ],
      };
      return refresh();
    });
    const next = page.locator('[data-pane-tab="next"]');
    const prompts = page.locator('[data-pane-tab="prompts"]');
    const start = await next.boundingBox();
    const end = await prompts.boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
    await page.locator('.csw-drop-preview').filter({ hasText: '合并为标签' }).waitFor();
    await page.mouse.up();
    await page.waitForFunction(() => state.layouts.desktop.groups.length === 2);
    assert.deepEqual(
      await page.evaluate(() =>
        state.layouts.desktop.groups.map(({ ids, weight }) => ({ ids, weight })),
      ),
      [
        { ids: ['outline'], weight: 2 },
        { ids: ['prompts', 'next'], weight: 3.4 },
      ],
    );

    const menu = page.getByRole('button', { name: '窗口操作', exact: true });
    await menu.click();
    await page.getByRole('menuitemradio', { name: '左侧标签' }).click();
    const tabs = page.getByRole('tablist');
    await page.waitForFunction(() => state.layouts.desktop.tabPosition === 'left');
    assert.equal(await tabs.getAttribute('aria-orientation'), 'vertical');
    const leftNext = await next.boundingBox();
    const leftPrompts = await prompts.boundingBox();
    assert.equal(leftNext.x, leftPrompts.x);
    assert.ok(leftNext.y > leftPrompts.y);
    const body = page.locator('.csw-feature-content');
    assert.ok((await body.boundingBox()).x >= leftNext.x + leftNext.width);
    await prompts.press('ArrowDown');
    assert.equal(await next.evaluate((tab) => tab === document.activeElement), true);
    await page.setViewportSize({ width: 324, height: 364 });
    assert.ok(await next.isVisible());
    await menu.click();
    assert.equal(
      await page.getByRole('menuitemradio', { name: '左侧标签' }).getAttribute('aria-checked'),
      'true',
    );
    await page.getByRole('menuitemradio', { name: '顶部标签' }).click();
    await page.waitForFunction(() => !state.layouts.desktop.tabPosition);
    assert.equal(await tabs.getAttribute('aria-orientation'), 'horizontal');
    const topNext = await next.boundingBox();
    const topPrompts = await prompts.boundingBox();
    assert.equal(topNext.y, topPrompts.y);
    assert.ok(topNext.x > topPrompts.x);
    assert.ok((await body.boundingBox()).y >= topNext.y + topNext.height);
    assert.deepEqual(await page.evaluate(() => state.layoutPresets.map(({ id }) => id)), [
      'paired',
      'focused',
    ]);
  } finally {
    await browser.close();
  }
});

test('overdragging the divider merges the narrower column only when released beyond the minimum', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 680 },
      reducedMotion: 'reduce',
    });
    page.setDefaultTimeout(5000);
    await fixture(page, 'desktop', ['outline', 'next', 'prompts', 'bots']);
    await page.evaluate(() => {
      state.layouts.desktop = {
        axis: 'horizontal',
        groups: [
          { ids: ['outline'], active: 'outline', weight: 1 },
          {
            axis: 'horizontal',
            weight: 2,
            groups: [
              { ids: ['next', 'prompts'], active: 'next', weight: 1 },
              { ids: ['bots'], active: 'bots', weight: 1 },
            ],
          },
        ],
      };
      return refresh();
    });
    const divider = page.locator('.csw-feature-split > [role="separator"]');
    const handle = await divider.boundingBox();
    const left = await page.locator('section[data-pane="next"]').boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - left.width - 16, y, { steps: 12 });
    assert.equal(await divider.getAttribute('data-merge-preview'), '合并为标签');
    await page.mouse.move(x - left.width + 34, y);
    assert.equal(await divider.getAttribute('data-merge-preview'), '继续拖动可合并');
    assert.equal(await divider.getAttribute('data-merge-side'), null);
    await page.mouse.up();
    assert.equal(await divider.count(), 1);
    assert.equal(
      await page.locator('section[data-pane="next"]').getAttribute('data-compact'),
      'true',
    );
    assert.ok(
      Math.abs((await page.locator('section[data-pane="next"]').boundingBox()).width - 44) < 1,
    );
    const minimum = await divider.boundingBox();
    await page.mouse.move(minimum.x + minimum.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(minimum.x + 80, y, { steps: 8 });
    await page.mouse.up();
    const before = await page.evaluate(() => structuredClone(state.layouts.desktop));
    const widened = await divider.boundingBox();
    assert.ok(widened.x > minimum.x + 50);
    await page.mouse.move(widened.x + widened.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(minimum.x - 64, y, { steps: 8 });
    assert.equal(await divider.getAttribute('data-merge-preview'), '合并为标签');
    assert.equal(await divider.getAttribute('data-merge-side'), 'previous');
    assert.deepEqual(
      await divider.evaluate((node) =>
        [node.previousElementSibling, node.nextElementSibling].map(
          (pane) => getComputedStyle(pane).outlineStyle,
        ),
      ),
      ['dashed', 'solid'],
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => state.layouts.desktop), before);
    assert.ok(Math.abs((await divider.boundingBox()).x - widened.x) < 1);
    await page.mouse.move(widened.x + widened.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(minimum.x - 64, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => state.layouts.desktop.groups[1].ids?.length === 3);
    assert.deepEqual(await page.evaluate(() => state.layouts.desktop.groups), [
      { ids: ['outline'], active: 'outline', weight: 1 },
      { ids: ['bots', 'next', 'prompts'], active: 'bots', weight: 2 },
    ]);
    await page.getByRole('button', { name: '窗口操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '撤销布局' }).click();
    await divider.waitFor();
    assert.deepEqual(await page.evaluate(() => state.layouts.desktop), before);
    const restored = await divider.boundingBox();
    assert.ok(Math.abs(restored.x - widened.x) < 1);
    await page.getByRole('button', { name: '窗口操作', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: '撤销布局' }).count(), 0);
  } finally {
    await browser.close();
  }
});

test('standalone rows still fold when their vertical stack includes a split', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 920, height: 720 },
      reducedMotion: 'reduce',
    });
    page.setDefaultTimeout(5000);
    await fixture(page, 'desktop', ['outline', 'next', 'prompts', 'bots']);
    await page.evaluate(() => {
      const row = (id) => ({ ids: [id], active: id, weight: 1 });
      state.layouts.desktop = {
        axis: 'vertical',
        groups: [
          { axis: 'horizontal', weight: 1, groups: [row('outline'), row('bots')] },
          row('next'),
          row('prompts'),
        ],
      };
      return refresh();
    });
    const pane = page.locator('section[data-pane="prompts"]');
    const divider = page.locator('.csw-feature-panes > [role="separator"]').last();
    const handle = await divider.boundingBox();
    const row = await pane.boundingBox();
    const header = await pane.locator('.csw-feature-pane-head').boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + row.height - header.height + 12, { steps: 12 });
    await page.mouse.up();
    assert.equal(await pane.getAttribute('data-compact'), 'true');
    assert.ok(Math.abs((await pane.boundingBox()).height - header.height) < 1);
    assert.equal(await divider.count(), 1);
    assert.ok(
      (await page.locator('.csw-feature-panes > .csw-feature-split').boundingBox()).height >= 180,
    );
    await page.locator('[data-pane-tab="prompts"]').click();
    assert.equal(await pane.getAttribute('data-compact'), 'false');
    await page.locator('[data-layout-saving="true"]').waitFor({ state: 'detached' });
    await page.evaluate(() => {
      const layout = structuredClone(state.layouts.desktop);
      layout.axis = 'horizontal';
      layout.groups[0].axis = 'vertical';
      for (const group of layout.groups) group.weight = 1;
      state.layouts.desktop = layout;
      return refresh();
    });
    const horizontal = await divider.boundingBox();
    const column = await pane.boundingBox();
    assert.equal(await divider.getAttribute('aria-orientation'), 'vertical');
    const startX = horizontal.x + horizontal.width / 2;
    const startY = horizontal.y + horizontal.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + column.width - 32, startY, { steps: 12 });
    await page.mouse.up();
    assert.equal(await pane.getAttribute('data-compact'), 'true');
    assert.ok(Math.abs((await pane.boundingBox()).width - 44) < 1);
    assert.ok(
      (await page.locator('.csw-feature-panes > .csw-feature-split').boundingBox()).width >= 180,
    );
  } finally {
    await browser.close();
  }
});

test('dragging beyond a folded row merges it into its vertical neighbor and supports undo', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 920, height: 650 } });
    page.setDefaultTimeout(5000);
    await fixture(page, 'desktop', ['outline', 'next', 'prompts', 'bots']);
    const before = {
      axis: 'horizontal',
      groups: [
        {
          axis: 'vertical',
          weight: 2,
          groups: [
            { ids: ['next'], active: 'next', weight: 0.2, collapsed: true },
            { ids: ['prompts'], active: 'prompts', weight: 0.2, collapsed: true },
            { ids: ['outline'], active: 'outline', weight: 1.6 },
          ],
        },
        { ids: ['bots'], active: 'bots', weight: 1 },
      ],
    };
    await page.evaluate((layout) => {
      state.layouts.desktop = layout;
      return refresh();
    }, before);
    const dividers = page.locator('.csw-feature-split > [role="separator"]');
    const divider = dividers.nth(1);
    const { x, y, width, height } = await divider.boundingBox();
    const origin = [x + width / 2, y + height / 2];
    await page.mouse.move(...origin);
    await page.mouse.down();
    await page.mouse.move(origin[0], origin[1] - 24);
    assert.equal(await divider.getAttribute('data-merge-preview'), '继续拖动可合并');
    await page.mouse.move(origin[0], origin[1] - 64, { steps: 8 });
    assert.equal(await divider.getAttribute('data-merge-side'), 'previous');
    await page.mouse.up();
    await page.waitForFunction(() => state.layouts.desktop.groups[0].groups.length === 2);
    const merged = await page.evaluate(() => state.layouts.desktop);
    assert.deepEqual(merged.groups[0].groups, [
      before.groups[0].groups[0],
      { ids: ['outline', 'prompts'], active: 'outline', weight: 1.8 },
    ]);
    assert.deepEqual(merged.groups[1], before.groups[1]);
    await page.getByRole('button', { name: '窗口操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '撤销布局', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => state.layouts.desktop), before);
  } finally {
    await browser.close();
  }
});

test('tab insertion and keyboard sorting work with both tab positions and the two-column preset', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    page.setDefaultTimeout(5000);
    await fixture(page);
    const menu = page.getByRole('button', { name: '窗口操作', exact: true });
    const preset = (name) => page.getByRole('menuitemradio', { name });
    const tab = (id) => page.locator(`[data-pane-tab="${id}"]`);
    await tab('prompts').click();
    await menu.click();
    assert.equal(await preset('对照').getAttribute('aria-checked'), 'true');
    await preset('双栏').click();
    await page.waitForFunction(() => state.layouts.desktop.axis === 'horizontal');
    assert.deepEqual(await page.evaluate(() => state.layouts.desktop.groups), [
      { ids: ['outline'], active: 'outline', weight: 0.45 },
      { ids: ['next', 'prompts'], active: 'prompts', weight: 0.55 },
    ]);
    await menu.click();
    assert.equal(await preset('双栏').getAttribute('aria-checked'), 'true');
    await page.getByRole('menuitem', { name: '撤销布局' }).click();
    await page.waitForFunction(() => state.layouts.desktop.axis === 'vertical');
    await menu.click();
    await preset('顶部标签').click();
    await tab('prompts').click();
    await tab('prompts').press('Alt+ArrowLeft');
    await page.waitForFunction(() => state.layouts.desktop.groups[0].ids[1] === 'prompts');
    assert.equal(await tab('prompts').getAttribute('aria-selected'), 'true');
    await menu.click();
    await preset('左侧标签').click();
    const source = await tab('next').boundingBox();
    const target = await tab('prompts').boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + 4, { steps: 8 });
    const marker = await page.locator('.csw-drop-preview[data-tab-insertion]').boundingBox();
    assert.ok(marker.width > marker.height);
    await page.mouse.up();
    await page.waitForFunction(() => state.layouts.desktop.groups[0].ids[1] === 'next');
    assert.equal(await tab('prompts').getAttribute('aria-selected'), 'true');
    await tab('prompts').press('Alt+ArrowUp');
    await page.waitForFunction(() => state.layouts.desktop.groups[0].ids[1] === 'prompts');
  } finally {
    await browser.close();
  }
});

test('layout settings deep link, membership, conflicts and management preserve drafts and current layout', async () => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'jsx',
        contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {FeatureSettings} from './ui/settings/feature-settings';
import {useSettingsPage} from './ui/settings/settings-outline';
import {setLocale} from './ui/shared/i18n.js';
window.changeLocale=setLocale;setLocale('system','zh-CN');
window.requests=[];window.failSave=false;
window.server={mainPlacement:'desktop',layoutPresetsRevision:0,layoutPresets:[],layouts:{desktop:{axis:'horizontal',groups:[{ids:['outline'],active:'outline',weight:.4},{ids:['next','prompts'],active:'next',weight:.6}]}},features:['outline','next','prompts'].map(id=>({id,open:true,placement:'desktop'}))};
window.fetch=async(url,options)=>{
 const input=JSON.parse(options.body);requests.push(input);
 let error='';
 if(input.op.startsWith('main-preset-') && input.expectedRevision!==server.layoutPresetsRevision)error='布局预设已在其他窗口更新，请刷新后重试';
 else if(input.op==='main-preset-save' && failSave)error='保存失败，请重试';
 else if(input.op==='main-layout')server.layouts.desktop=input.layout;
 else if(input.op==='main-preset-save'){
  const preset={id:input.id||'saved',name:input.name,scope:input.placement==='sidebar'?'sidebar':'overlay',layout:input.layout};
  const index=server.layoutPresets.findIndex(p=>p.id===preset.id);
  if(index<0)server.layoutPresets.push(preset);else server.layoutPresets[index]=preset;
  server.layoutPresetsRevision++;
 }else if(input.op==='main-preset-update'){
  Object.assign(server.layoutPresets.find(p=>p.id===input.id),{name:input.name});server.layoutPresetsRevision++;
 }else if(input.op==='main-preset-delete'){
  server.layoutPresets=server.layoutPresets.filter(p=>p.id!==input.id);server.layoutPresetsRevision++;
 }else if(input.op==='main-preset-apply')server.layouts.desktop=structuredClone(server.layoutPresets.find(p=>p.id===input.id).layout);
 return new Response(JSON.stringify(error?{ok:false,code:'conflict',message:error}:server),{status:error?409:200});
};
function App(){const nav=useSettingsPage(true);return <div className="settings-app" data-settings-category={nav.page}><main data-settings-page="surfaces" hidden={nav.page!=='surfaces'}><FeatureSettings live desktopSupported onPlacement={()=>{}} /></main></div>}
createRoot(document.getElementById('root')).render(<App/>);
`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.env.DEV': 'false',
        PALBOO_DEVELOPMENT: 'true',
      },
    })
  ).outputFiles[0].text;
  const html = await readFile('target/web/index.html', 'utf8');
  let css = '';
  for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
    css += await readFile(`target/web${href}`, 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 780 },
      reducedMotion: 'reduce',
      locale: 'en-US',
    });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://layout-presets.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div>`,
      }),
    );
    await page.goto('http://layout-presets.test/?open=layout-presets#token=synthetic');
    await page.addScriptTag({ content: script });
    const drawer = page.getByRole('dialog', { name: '布局预设', exact: true });
    await drawer.waitFor();
    for (const width of [901, 390]) {
      await page.setViewportSize({ width, height: 780 });
      const geometry = await page.evaluate(() => {
        const rect = (selector) => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width, top: box.top };
        };
        return {
          layout: rect('#main-layout'),
          preset: rect('#current-layout-preset'),
          manager: rect('button[aria-controls="layout-presets-drawer"]'),
        };
      });
      assert.ok(geometry.layout.width > 0);
      for (const edge of ['left', 'right', 'width'])
        assert.ok(
          Math.abs(geometry.layout[edge] - geometry.preset[edge]) < 1,
          `${width}px: layout and preset ${edge} should align`,
        );
      assert.ok(geometry.manager.top < geometry.layout.top, 'management belongs above the fields');
      assert.ok(geometry.preset.top > geometry.layout.top, 'presets have their own row');
    }
    assert.equal(await page.getByRole('button', { name: '管理布局预设', exact: true }).count(), 1);
    assert.equal(await drawer.getByRole('textbox').count(), 0);
    assert.equal(await drawer.getByRole('checkbox').count(), 0);
    await drawer.getByRole('button', { name: '保存新预设' }).click();
    assert.equal(await drawer.getByLabel('适用形式').count(), 0);
    await drawer.getByRole('checkbox', { name: '常用语', exact: true }).click();
    await page.waitForFunction(() => server.layouts.desktop.visible?.length === 2);
    assert.deepEqual(await page.evaluate(() => server.layouts.desktop.visible), [
      'outline',
      'next',
    ]);
    assert.equal(await page.evaluate(() => server.features.every((f) => f.open)), true);
    const name = drawer.locator('#new-layout-preset-name');
    await name.fill('阅读对照');
    await page.evaluate(() => (failSave = true));
    await drawer.getByRole('button', { name: '保存当前布局', exact: true }).click();
    await drawer.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
    assert.equal(await name.inputValue(), '阅读对照');
    await page.evaluate(() => (failSave = false));
    await drawer.getByRole('button', { name: '保存当前布局', exact: true }).click();
    await page.waitForFunction(() => server.layoutPresets.length === 1);
    const editPreset = (name) => drawer.getByRole('button', { name: '编辑' + name, exact: true });
    await editPreset('阅读对照').waitFor();
    assert.equal(await drawer.getByRole('textbox').count(), 0);
    await editPreset('阅读对照').click();
    assert.equal(await drawer.getByRole('checkbox').count(), 0);
    assert.equal(await page.evaluate(() => server.layoutPresets[0].scope), 'overlay');
    const rename = drawer.locator('#layout-preset-rename');
    await rename.fill('我正在编辑');
    await page.evaluate(() => {
      server.layoutPresetsRevision++;
      server.layoutPresets[0].name = '另一窗口的名称';
    });
    await drawer.getByRole('button', { name: '保存更改', exact: true }).click();
    await drawer.getByRole('alert').filter({ hasText: '其他窗口更新' }).waitFor();
    assert.equal(await rename.inputValue(), '我正在编辑');
    assert.equal(await page.evaluate(() => server.layoutPresets[0].name), '另一窗口的名称');
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await rename.inputValue(), '另一窗口的名称');
    await rename.fill('我的布局');
    await drawer.getByRole('button', { name: '保存更改', exact: true }).click();
    await page.waitForFunction(() => server.layoutPresets[0].name === '我的布局');
    await rename.fill('语言切换保留草稿');
    await page.evaluate(() => changeLocale('en'));
    const englishDrawer = page.getByRole('dialog', { name: 'Layout presets', exact: true });
    await englishDrawer.getByRole('button', { name: 'Save changes', exact: true }).waitFor();
    assert.equal(
      await englishDrawer.locator('#layout-preset-rename').inputValue(),
      '语言切换保留草稿',
    );
    await page.evaluate(() => changeLocale('system'));
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await drawer.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal(
      await editPreset('我的布局').evaluate((node) => node === document.activeElement),
      true,
    );
    await drawer.getByRole('button', { name: '保存新预设' }).click();
    await drawer.getByRole('checkbox', { name: '常用语', exact: true }).click();
    await page.waitForFunction(() => server.layouts.desktop.visible.length === 3);
    await drawer.getByRole('button', { name: '返回', exact: true }).click();
    await drawer.getByRole('button', { name: '我的布局', exact: true }).click();
    await page.waitForFunction(() => server.layouts.desktop.visible.length === 2);
    await editPreset('我的布局').click();
    await drawer.getByRole('button', { name: '用当前布局更新', exact: true }).click();
    const update = page.getByRole('dialog', { name: '更新布局预设', exact: true });
    await update.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(
      await page.evaluate(() => requests.filter((r) => r.op === 'main-preset-save').length),
      2,
    );
    await drawer.getByRole('button', { name: '删除', exact: true }).click();
    await page
      .getByRole('dialog', { name: '删除布局预设', exact: true })
      .getByRole('button', { name: '删除', exact: true })
      .click();
    await page.waitForFunction(() => server.layoutPresets.length === 0);
    assert.deepEqual(await page.evaluate(() => server.layouts.desktop.visible), [
      'outline',
      'next',
    ]);
    await page.keyboard.press('Escape');
    const preset = page.locator('#current-layout-preset');
    await preset.selectOption('tabs-left');
    await page.waitForFunction(() => server.layouts.desktop.tabPosition === 'left');
    assert.equal(await preset.inputValue(), 'tabs-left');
    assert.deepEqual(await page.evaluate(() => server.layouts.desktop.groups[0].ids), [
      'outline',
      'next',
      'prompts',
    ]);
    await preset.selectOption('two-column');
    await page.waitForFunction(() => server.layouts.desktop.groups.length === 2);
    assert.equal(await preset.inputValue(), 'two-column');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('sidebar and floating menus filter saved presets while sharing the built-in choices', async () => {
  const browser = await chromium.launch();
  try {
    for (const placement of ['sidebar', 'overlay']) {
      const page = await browser.newPage({
        viewport: { width: 340, height: 650 },
        reducedMotion: 'reduce',
      });
      await fixture(page, placement);
      await page.evaluate(() => {
        const layout = state.layoutPresets[0].layout;
        state.layoutPresets.push(
          { id: 'legacy', name: '旧侧栏', layout },
          { id: 'desktop', name: '桌面保存', scope: 'desktop', layout },
        );
        return refresh();
      });
      const trigger = page.getByRole('button', { name: '布局预设', exact: true });
      await trigger.click();
      assert.equal(await page.getByRole('menuitemcheckbox').count(), 0);
      assert.equal(
        await page.getByRole('menuitemradio', { name: '旧侧栏' }).count(),
        Number(placement === 'sidebar'),
      );
      assert.equal(
        await page.getByRole('menuitemradio', { name: '桌面保存' }).count(),
        Number(placement === 'overlay'),
      );
      await page.getByRole('menuitemradio', { name: '专注', exact: true }).click();
      const applied = await page.evaluate(() => requests.at(-1));
      assert.equal(applied.placement, placement);
      assert.equal('lease' in applied, false);
      assert.equal(applied.expectedLayout.groups.length, 2);
      await trigger.click();
      await page.getByRole('menuitem', { name: '保存布局…', exact: true }).click();
      await page.getByLabel('预设名称', { exact: true }).fill('当前阅读');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.waitForFunction(() => state.layoutPresets.some((p) => p.name === '当前阅读'));
      assert.equal((await page.evaluate(() => requests.at(-1))).placement, placement);
      await trigger.click();
      await page.getByRole('menuitem', { name: '管理预设…', exact: true }).click();
      assert.equal(await page.evaluate(() => settingsOpened), true);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
