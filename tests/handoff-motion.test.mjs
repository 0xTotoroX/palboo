/* [INPUT]: Real workbench layout/mounts, synthetic feature snapshots and handoff owners.
 * [OUTPUT]: A single spatial cue preserves content/drafts/scroll, blocks interaction, restores on cancellation, respects reduced motion and coalesces repeated window requests.
 * [POS]: Browser-only acceptance; no host data or native capture.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('workbench moves as one surface without repeated pending text or lost draft nodes', async (t) => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
import {mountFeature} from './ui/surfaces/workspace/mount';
import {installFeatureLayout} from './ui/surfaces/workspace/layout';
import {installHandoffMotion} from './ui/surfaces/workspace/handoff';
import {installStyle} from './ui/surfaces/embedded/shell/install-styles';
import {workbenchHeadHtml} from './ui/surfaces/workspace/chrome';
installStyle();
const root=document.querySelector('#workbench');root.innerHTML=workbenchHeadHtml();
window.motion=installHandoffMotion(root);window.calls=[];
const request=async input=>{
 calls.push(structuredClone(input));
 if(input.op==='read')return {snapshot:{viewToken:'synthetic',quickPromptToken:'phrases',settings:{quickPromptsEnabled:true,quickPrompts:[{label:'继续',prompt:'继续'}],configurationRevision:1},display:{promptClickMode:'fill'},bridgeStatus:'ready',outlineStatus:'ready',outlineItems:[],prompts:[]}};
 return {};
};
const entries=['prompts','outline'].map(id=>({id,owner:id,placement:'sidebar',open:true,view:{},reveal:1}));
window.items=entries.map(entry=>{
 const node=document.createElement('div');node.style.cssText='height:100%;min-height:0';
 return {id:entry.id,node,active:true,mount:mountFeature(node,entry,entry.owner,'sidebar',request,()=>{})};
});

const layout=installFeatureLayout(root,{save:async()=>{},error:e=>{throw e}});
layout.update(items,'sidebar',{axis:'vertical',groups:entries.map(e=>({ids:[e.id],active:e.id,weight:1}))},null,'prompts',1);
motion.update('sidebar',null);
window.move=()=>{entries.forEach((entry,i)=>items[i].mount.update({...entry,pending:{owner:entry.id+'new',placement:'desktop',ready:false}}));motion.update('sidebar','desktop')};
window.cancel=()=>{entries.forEach((entry,i)=>items[i].mount.update(entry));motion.update('sidebar',null)};
window.returnInside=()=>{motion.update('desktop',null);motion.update('desktop','sidebar');motion.update('sidebar',null)};
window.destroy=()=>{motion.destroy();items.forEach(item=>item.mount.dispose());layout.destroy()};
`,
      },
      bundle: true,
      write: false,
      loader: { '.css': 'text' },
      define: { PALBOO_DEVELOPMENT: 'true' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 580, height: 700 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(
    '<div data-companion-stepwise-root="true" data-workbench="true" style="position:fixed;inset:12px;pointer-events:auto"><div id="workbench" class="csw-workbench"></div></div>',
  );
  await page.addScriptTag({ content: script });
  await page.getByRole('button', { name: '添加快捷指令', exact: true }).click();
  await page.getByLabel('快捷指令内容', { exact: true }).fill('切换期间保留的草稿');
  const before = await page.getByLabel('快捷指令内容', { exact: true }).boundingBox();
  await page.evaluate(() => {
    window.draft = items[0].node.shadowRoot.querySelector('textarea');
    window.originalNode = items[0].node;
  });
  await page.evaluate(() => move());
  await page.waitForFunction(() => calls.some((c) => c.op === 'handoff'));
  assert.equal(await page.locator('#workbench').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#workbench').evaluate((node) => node.inert), true);
  assert.equal(await page.getByText('正在移到新位置…', { exact: true }).count(), 0);
  assert.equal(await page.locator('[role=status]').filter({ hasText: '正在切换位置…' }).count(), 1);
  assert.equal(await page.evaluate(() => items[0].node === originalNode), true);
  const after = await page.getByLabel('快捷指令内容', { exact: true }).boundingBox();
  assert.ok(Math.abs(before.height - after.height) < 5, 'pending state adds no text row');
  await page.waitForTimeout(210);
  assert.ok(
    Number(await page.locator('#workbench').evaluate((node) => getComputedStyle(node).opacity)) <
      0.7,
  );
  await page.evaluate(() => cancel());
  await page.waitForTimeout(260);
  assert.equal(await page.locator('#workbench').evaluate((node) => node.inert), false);
  assert.equal(
    await page.getByLabel('快捷指令内容', { exact: true }).inputValue(),
    '切换期间保留的草稿',
  );
  assert.equal(
    await page.locator('#workbench').evaluate((node) => getComputedStyle(node).transform),
    'none',
  );
  await page.getByText('未能切换位置，请重试。', { exact: true }).first().waitFor();
  await page.evaluate(() => returnInside());
  assert.ok(await page.locator('#workbench').evaluate((node) => node.getAnimations().length > 0));
  await page.setViewportSize({ width: 340, height: 620 });
  await page.waitForFunction(
    () => document.querySelector('#workbench').getAnimations().length === 0,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => move());
  assert.equal(await page.locator('#workbench').evaluate((node) => node.getAnimations().length), 0);
  await page.evaluate(() => cancel());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('Alt+Enter');
  await page.evaluate(() => move());
  assert.equal(await page.locator('#workbench').evaluate((node) => node.getAnimations().length), 0);
  await page.evaluate(() => destroy());
  assert.equal(await page.locator('#workbench').getAttribute('data-handoff'), null);
  assert.equal(await page.locator('#workbench').evaluate((node) => node.inert), false);
  assert.deepEqual(errors, []);
});

test('embedded switching coalesces repeated clicks and clears only its previous error', async (t) => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
import {startFeatureHost,stopFeatureHost,renderFeatureShell,popoutSelectedFeature,featureTransitioning,featurePlacement,independentFeatures} from './ui/surfaces/embedded/features';
import {shellState,runtimeState} from './ui/codex/runtime/state';
import {onSignal} from './ui/codex/runtime/signals';
import {installStyle} from './ui/surfaces/embedded/shell/install-styles';
installStyle();shellState.panel=document.querySelector('#panel');
window.fixture={mainManaged:true,mainPlacement:'overlay',returnPlacement:'overlay',pendingPlacement:null,features:[{id:'prompts',owner:'source',placement:'overlay',open:true,size:[840,620],view:{},reveal:1,pending:null}],appearance:{themes:{}}};
window.moves=[];window.failNext=false;
window.__companionDesktopRequest=async(path,input)=>{
 if(input.op==='main-placement'){
  moves.push(input.placement);
  if(failNext){failNext=false;return {error:'测试：窗口启动失败'}};
  if(window.moveReply)return {error:'功能正在交接，请稍后重试'};
  return new Promise(resolve=>{window.moveReply=()=>{
   fixture.pendingPlacement=input.placement;
   fixture.features[0].pending={owner:'target-'+moves.length,placement:input.placement,ready:true};
   window.moveReply=null;resolve(structuredClone(fixture));
  }});
 }
 if(input.op==='state')return structuredClone(fixture);
 if(input.op==='read')return {snapshot:{viewToken:'synthetic',quickPromptToken:'phrases',settings:{quickPromptsEnabled:true,quickPrompts:[],configurationRevision:1},display:{promptClickMode:'fill'},bridgeStatus:'ready',prompts:[]}};
 return {};
};
window.finishMove=()=>{const entry=fixture.features[0];fixture.mainPlacement=fixture.pendingPlacement;fixture.pendingPlacement=null;Object.assign(entry,{owner:entry.pending.owner,placement:entry.pending.placement,pending:null})};
Object.assign(window,{move:popoutSelectedFeature,moving:featureTransitioning,placement:featurePlacement,independent:independentFeatures,stop:stopFeatureHost,runtime:runtimeState});
onSignal('render',()=>renderFeatureShell(()=>{}));startFeatureHost();
`,
      },
      bundle: true,
      write: false,
      loader: { '.css': 'text' },
      define: { PALBOO_DEVELOPMENT: 'true' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(
    '<div data-companion-stepwise-root="true"><section id="panel" style="position:fixed;inset:12px"></section></div>',
  );
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => independent());
  const feedback = page.locator('[data-feature-error]');
  await page.evaluate(async () => {
    failNext = true;
    await move();
  });
  assert.equal(await feedback.textContent(), '测试：窗口启动失败');
  for (const target of ['desktop', 'overlay']) {
    const before = await page.evaluate(() => moves.length);
    await page.evaluate(() => {
      window.inFlight = Promise.all([move(), move(), move()]);
    });
    await page.waitForFunction(() => !!window.moveReply);
    assert.equal(await page.evaluate(() => moves.length), before + 1);
    assert.equal(await page.evaluate(() => moving()), true);
    assert.equal(await feedback.textContent(), '');
    assert.equal(await feedback.isHidden(), true);
    await page.evaluate(async () => {
      moveReply();
      await inFlight;
      await move();
    });
    assert.equal(await page.evaluate(() => moves.length), before + 1);
    assert.equal(await page.evaluate(() => moving()), true);
    assert.equal(await page.getByText('功能正在交接，请稍后重试', { exact: true }).count(), 0);
    await page.evaluate(() => finishMove());
    await page.waitForFunction((target) => placement() === target && !moving(), target);
  }
  await page.evaluate(() => {
    runtime.settingsOpenStatus = '其他设置提示';
    window.inFlight = move();
  });
  await page.waitForFunction(() => !!window.moveReply);
  await page.evaluate(async () => {
    stop();
    moveReply();
    await inFlight;
  });
  assert.equal(await page.evaluate(() => independent() || moving()), false);
  assert.equal(await page.evaluate(() => runtime.settingsOpenStatus), '其他设置提示');
  assert.equal(await feedback.textContent(), '');
  assert.deepEqual(errors, []);
});
