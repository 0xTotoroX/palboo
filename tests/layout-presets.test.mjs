/* [INPUT]: Real window menu, layout controller and isolated synthetic feature nodes.
 * [OUTPUT]: Preset switching preserves DOM/drafts/scroll; menu keyboard, save failure and pin interactions remain usable.
 * [POS]: Browser regression without host data, screenshots or native permissions.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

async function fixture(page) {
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
window.changeLocale=setLocale;window.__buddyNativeChrome=true;installStyle();
document.documentElement.dataset.nativeBackdrop='true';
const host=document.querySelector('#root');host.innerHTML='<div class="csw-workbench">'+workbenchHeadHtml(true)+'</div>';
const root=host.firstElementChild;
const paired={axis:'vertical',groups:[{ids:['outline'],active:'outline',weight:1},{ids:['next','prompts'],active:'next',weight:1}],visible:['outline','next','prompts']};
const focused={...structuredClone(paired),visible:['outline']};
window.state={mainPlacement:'desktop',layoutPresetsRevision:1,layouts:{desktop:paired},layoutPresets:[{id:'paired',name:'对照',layout:paired},{id:'focused',name:'专注',layout:focused}],features:['outline','next','prompts'].map(id=>({id,open:true,placement:'desktop',owner:id}))};
window.requests=[];window.pins=[];window.pinned=true;window.rejectSave=false;
const items=state.features.map(entry=>{const node=document.createElement('div');node.style.cssText='height:100%;min-height:0';const shadow=node.attachShadow({mode:'open'});shadow.innerHTML='<div data-scroll style="height:100%;overflow:auto"><input aria-label="'+entry.id+'草稿" value="未保存内容"><div style="height:900px">Synthetic content</div></div>';return {...entry,node,active:true}});
window.originalNodes=items.map(item=>item.node);
const composition=installFeatureLayout(root,{save:async(surface,next)=>{state.layouts[surface]=next},error:e=>{throw e}});
const refresh=async()=>{composition.update(items,'desktop',state.layouts.desktop,null,'next',1);menu.update(state,pinned)};
const request=async input=>{
 requests.push(structuredClone(input));
 if(input.op==='main-preset-apply')state.layouts.desktop=structuredClone(state.layoutPresets.find(p=>p.id===input.id).layout);
 else if(input.op==='main-preset-save'){
  if(rejectSave)throw Error('保存失败，请重试');
  state.layoutPresets.push({id:'saved',name:input.name,layout:input.layout});state.layoutPresetsRevision++;
 }
 return state;
};
const menu=installWindowMenu(root.querySelector('.csw-workbench-controls'),{request,lease:'test',layout:()=>composition.snapshot(),pin:async value=>{pinned=value;pins.push(value)},settings:async()=>{window.settingsOpened=true},refresh,isBusy:()=>false});
window.refresh=refresh;window.switchSurface=surface=>composition.update(items,surface,state.layouts.desktop,null,'next',1);refresh();
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
  await page.getByRole('button', { name: '窗口操作', exact: true }).waitFor();
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
    await page.getByRole('menuitem', { name: '保存当前布局…', exact: true }).click();
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
    await page.getByRole('menuitem', { name: 'Save current layout…', exact: true }).waitFor();
    assert.deepEqual(errors, []);
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
setLocale('zh-CN');
window.requests=[];window.failSave=false;
window.server={mainPlacement:'desktop',layoutPresetsRevision:0,layoutPresets:[],layouts:{desktop:{axis:'horizontal',groups:[{ids:['outline'],active:'outline',weight:.4},{ids:['next','prompts'],active:'next',weight:.6}]}},features:['outline','next','prompts'].map(id=>({id,open:true,placement:'desktop'}))};
window.fetch=async(url,options)=>{
 const input=JSON.parse(options.body);requests.push(input);
 let error='';
 if(input.op.startsWith('main-preset-') && input.expectedRevision!==server.layoutPresetsRevision)error='布局预设已在其他窗口更新，请刷新后重试';
 else if(input.op==='main-preset-save' && failSave)error='保存失败，请重试';
 else if(input.op==='main-layout')server.layouts.desktop=input.layout;
 else if(input.op==='main-preset-save'){
  const preset={id:input.id||'saved',name:input.name,layout:input.layout};
  const index=server.layoutPresets.findIndex(p=>p.id===preset.id);
  if(index<0)server.layoutPresets.push(preset);else server.layoutPresets[index]=preset;
  server.layoutPresetsRevision++;
 }else if(input.op==='main-preset-rename'){
  server.layoutPresets.find(p=>p.id===input.id).name=input.name;server.layoutPresetsRevision++;
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
    await drawer.getByRole('switch', { name: '常用语', exact: true }).click();
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
    await drawer.getByRole('button', { name: '使用此预设', exact: true }).waitFor();
    const rename = drawer.locator('#layout-preset-rename');
    await rename.fill('我正在编辑');
    await page.evaluate(() => {
      server.layoutPresetsRevision++;
      server.layoutPresets[0].name = '另一窗口的名称';
    });
    await drawer.getByRole('button', { name: '重命名', exact: true }).click();
    await drawer.getByRole('alert').filter({ hasText: '其他窗口更新' }).waitFor();
    assert.equal(await rename.inputValue(), '我正在编辑');
    assert.equal(await page.evaluate(() => server.layoutPresets[0].name), '另一窗口的名称');
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await rename.inputValue(), '另一窗口的名称');
    await rename.fill('我的布局');
    await drawer.getByRole('button', { name: '重命名', exact: true }).click();
    await page.waitForFunction(() => server.layoutPresets[0].name === '我的布局');
    await drawer.getByRole('switch', { name: '常用语', exact: true }).click();
    await page.waitForFunction(() => server.layouts.desktop.visible.length === 3);
    await drawer.getByRole('button', { name: '使用此预设', exact: true }).click();
    await page.waitForFunction(() => server.layouts.desktop.visible.length === 2);
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
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
