/* [INPUT]: 真实 React 模型按钮、经典模型适配器、测速采集器/读数组件及合成流式事件。
 * [OUTPUT]: 纯图标识别、已提交控件状态、快速模型/Fast 切换、跨聊天轮次归属和历史缓存隔离回归。
 * [POS]: 隔离 Chromium 验收，不连接真实宿主、不发送请求或改用户配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { records, installModelControlFixture } from './model-control-fixture.mjs';

const source = readFileSync('ui/codex/model.js', 'utf8');
const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {installTokenMeter} from './ui/codex/token-meter.js';
import {TokenMeterView} from './ui/features/token-meter/view';
const picker=createRoot(document.getElementById('native-picker'));
const output=createRoot(document.getElementById('meter-output'));
window.nativeState={model:'alpha',reasoningEffort:'low',selectedServiceTier:null,iconOnly:false,
  serviceTierOptions:[{value:null,iconKind:null},{value:'priority',iconKind:'fast'}]};
window.nativeCalls=0;
const callback=()=>window.nativeCalls++;
function NativePicker(props) {
  const label=props.model==='alpha'?'Alpha':props.model==='beta'?'Beta':props.model;
  return <button type="button" aria-label="Select model" aria-haspopup="menu" data-composer-navigation-target="reasoning" data-selected-reasoning-effort={props.reasoningEffort} style={{width:200,height:32}}>
    {props.iconOnly?<svg width="20" height="20"><path d="M5 5L10 10"/></svg>:<span className="ModelPickerTriggerModelGroup-test">
      {props.selectedServiceTier==='priority'&&<svg className="ModelPickerTriggerInlineModeIcon-test"><path d="M11.9125 21.4125Z"/></svg>}
      <span className="ModelPickerTriggerModelText-test">{label}</span>
    </span>}
  </button>;
}
window.selectNative=(patch={})=>{
  if(patch.model)window.nativeState.reasoningEffort=patch.model==='beta'?'medium':'low';
  Object.assign(window.nativeState,patch);
  flushSync(()=>picker.render(<NativePicker {...window.nativeState} onSelectModel={callback} onCommitPower={callback} onSelectServiceTier={callback} powerSelections={[]}/>));
};
window.selectNative();
window.boot=()=>installTokenMeter();
window.readMeter=()=>window.__palbooTokenMeter.read(window.__palbooModelControl.inputTarget()?.id);
window.renderMeter=()=>flushSync(()=>output.render(<TokenMeterView snapshot={window.readMeter()}/>));
window.notify=(method,params)=>window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'mcp-notification',hostId:'local',method,params:{threadId:window.__palbooModelControl.inputTarget().id,...params}}}));
window.chooseChat=id=>{
  document.querySelector('section[data-thread-id]').dataset.threadId=id;
  history.replaceState(null,'','/c/'+id);
  document.dispatchEvent(new Event('pointerup'));
};`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    loader: { '.css': 'text' },
  })
).outputFiles[0].text;

async function fixture(browser, iconOnly = false) {
  const page = await browser.newPage();
  await page.route('http://model-host.test/**', (route) =>
    route.fulfill({ body: '<!doctype html><body></body>', contentType: 'text/html' }),
  );
  await page.goto('http://model-host.test/c/chat-a');
  await page.clock.install();
  await page.evaluate(installModelControlFixture, { records });
  await page.evaluate(() => {
    const form = document.querySelector('form');
    form.querySelector('button').remove();
    form.insertAdjacentHTML('beforeend', '<div id="native-picker"></div>');
    document.body.insertAdjacentHTML('beforeend', '<div id="meter-output"></div>');
  });
  await page.addScriptTag({ content: bundle });
  await page.addScriptTag({ content: source });
  await page.evaluate((iconOnly) => {
    window.capability();
    window.selectNative({ iconOnly });
    window.boot();
  }, iconOnly);
  return page;
}
const choose = (page, patch) => page.evaluate((patch) => window.selectNative(patch), patch);
const chat = (page, id) => page.evaluate((id) => window.chooseChat(id), id);
const notify = (page, method, params) =>
  page.evaluate(({ method, params }) => window.notify(method, params), { method, params });
const read = (page) => page.evaluate(() => window.readMeter());
async function render(page) {
  await page.clock.runFor(501);
  await page.evaluate(() => window.renderMeter());
  return page.locator('.token-meter-readout').textContent();
}
async function stream(page, turnId, text, start = true) {
  if (start) await notify(page, 'turn/started', { turnId });
  await notify(page, 'item/agentMessage/delta', {
    turnId,
    itemId: turnId + '-' + text.length,
    delta: text,
  });
  return render(page);
}
async function finish(page, turnId) {
  await notify(page, 'turn/completed', {
    turnId,
    turn: { id: turnId, status: 'completed', durationMs: 5000 },
  });
  return render(page);
}

test('icon-only picker reads committed model and Fast without opening menus or writable snapshots', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser, true);
    assert.deepEqual(
      await page.evaluate(() => window.__palbooModelControl.inputTarget().selection),
      { model: 'alpha', reasoning: 'low', speed: 'standard' },
    );
    assert.match(
      await stream(page, 'alpha', 'First visible output in the compact picker.'),
      /^≈ [\d.]+ tok\/s$/,
    );
    const alpha = (await read(page)).lastSpeed;
    await finish(page, 'alpha');
    await choose(page, { model: 'beta' });
    assert.equal(
      await page.evaluate(() => window.__palbooModelControl.inputTarget().selection.model),
      'beta',
    );
    await choose(page, { model: 'alpha', selectedServiceTier: 'priority' });
    assert.equal(
      await page.evaluate(() => window.__palbooModelControl.inputTarget().selection.speed),
      'fast',
    );
    await choose(page, { selectedServiceTier: null });
    assert.equal((await readAfterRefresh(page)).lastSpeed, alpha);
    await page.evaluate(() => {
      const button = document.querySelector('#native-picker button');
      const key = Object.getOwnPropertyNames(button).find((key) => key.startsWith('__reactFiber$'));
      if (button[key].alternate) button[key] = button[key].alternate;
    });
    assert.equal(
      await page.evaluate(() => window.__palbooModelControl.inputTarget().selection.speed),
      'standard',
    );
    await choose(page, { selectedServiceTier: 'unknown' });
    assert.equal(
      await page.evaluate(() => window.__palbooModelControl.inputTarget().selection),
      null,
    );
    await choose(page, { model: 'beta', selectedServiceTier: 'priority' });
    assert.equal(
      await page.evaluate(() => window.__palbooModelControl.inputTarget().selection),
      null,
      'unsupported Fast stays unknown',
    );
    await choose(page, { model: 'alpha', selectedServiceTier: null, serviceTierOptions: [] });
    assert.equal(
      await page.evaluate(() => window.__palbooModelControl.inputTarget().selection),
      null,
      'missing tier evidence does not guess standard',
    );
    assert.equal(
      await page.evaluate(async () => (await window.__palbooModelControl.snapshot(false)).current),
      null,
    );
    assert.equal(await page.evaluate(() => window.nativeCalls), 0);
    assert.equal(await page.locator('.ProseMirror').textContent(), 'Draft chat-a');
  } finally {
    await browser.close();
  }
});

async function readAfterRefresh(page) {
  await page.clock.runFor(501);
  return read(page);
}

for (const [name, oldTier, newModel, newTier] of [
  ['model', null, 'beta', null],
  ['Fast on', null, 'alpha', 'priority'],
  ['Fast off', 'priority', 'alpha', null],
])
  test(`new turn immediately after ${name} change bypasses the 500ms target cache`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await fixture(browser);
      await choose(page, { selectedServiceTier: oldTier });
      await page.clock.runFor(501);
      await stream(page, 'old', 'baseline reply');
      await finish(page, 'old');
      const old = (await read(page)).lastSpeed;
      await choose(page, { model: newModel, selectedServiceTier: newTier });
      assert.match(
        await stream(
          page,
          'new',
          'A much longer new request answer with many different words and tokens.',
        ),
        /^≈ [\d.]+ tok\/s$/,
      );
      const current = await read(page);
      assert.equal(current.model, newModel);
      assert.equal(current.fast, newTier === 'priority');
      assert.ok(current.speed > 0);
      assert.notEqual(current.lastSpeed, old);
      await finish(page, 'new');
      await choose(page, { model: 'alpha', selectedServiceTier: oldTier });
      assert.equal(
        (await readAfterRefresh(page)).lastSpeed,
        old,
        'new request cannot overwrite the previous model/mode',
      );
    } finally {
      await browser.close();
    }
  });

for (const [name, newModel, newTier] of [
  ['model', 'beta', null],
  ['Fast', 'alpha', 'priority'],
])
  test(`returning to an active chat after ${name} change preserves the original turn owner`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await fixture(browser);
      await stream(page, 'active', 'initial alpha response');
      await choose(page, { model: newModel, selectedServiceTier: newTier });
      await chat(page, 'chat-b');
      await chat(page, 'chat-a');
      assert.equal((await read(page)).lastSpeed, null);
      assert.match(
        await stream(
          page,
          'active',
          'Old alpha standard request continues after a tool call and chat switching.',
          false,
        ),
        /^— tok\/s/,
      );
      assert.equal(
        (await read(page)).lastSpeed,
        null,
        'old output cannot seed the newly chosen model/mode',
      );
      await choose(page, { model: 'alpha', selectedServiceTier: null });
      const old = (await readAfterRefresh(page)).lastSpeed;
      assert.ok(old > 0, 'old request still updates its original owner');
      await finish(page, 'active');
      await choose(page, { model: newModel, selectedServiceTier: newTier });
      assert.match(
        await stream(
          page,
          'fresh',
          'A genuine new request finally provides a valid measurement for the selected target.',
        ),
        /^≈ [\d.]+ tok\/s$/,
      );
      const fresh = (await read(page)).lastSpeed;
      await finish(page, 'fresh');
      await chat(page, 'chat-b');
      assert.equal((await read(page)).lastSpeed, fresh);
      assert.match(await render(page), /上次测速/);
      await choose(page, { model: 'alpha', selectedServiceTier: null });
      assert.equal((await readAfterRefresh(page)).lastSpeed, old);
      await choose(page, { model: newModel, selectedServiceTier: newTier });
      assert.equal((await readAfterRefresh(page)).lastSpeed, fresh);
    } finally {
      await browser.close();
    }
  });

test('unknown or unobserved turn origins are never filled from a later selection', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser);
    await choose(page, { model: 'unknown' });
    await page.clock.runFor(501);
    await stream(page, 'unknown', 'A turn that started while its model could not be confirmed.');
    await choose(page, { model: 'beta' });
    assert.match(
      await stream(
        page,
        'unknown',
        'Continued old output must not be assigned to a later model.',
        false,
      ),
      /^— tok\/s/,
    );
    assert.equal((await read(page)).lastSpeed, null);
    await finish(page, 'unknown');
    await chat(page, 'chat-b');
    assert.match(
      await stream(page, 'unobserved', 'Output from a turn whose start was not observed.', false),
      /^— tok\/s/,
    );
    assert.equal((await read(page)).lastSpeed, null);
    await finish(page, 'unobserved');
    assert.match(
      await stream(
        page,
        'known',
        'A new observed turn has valid model provenance and can be measured.',
      ),
      /^≈ [\d.]+ tok\/s$/,
    );
    const valid = (await read(page)).lastSpeed;
    await finish(page, 'known');
    await chat(page, 'chat-a');
    await chat(page, 'chat-b');
    await stream(
      page,
      'known',
      'A late completed-turn delta cannot replace the retained measurement.',
      false,
    );
    assert.equal((await read(page)).lastSpeed, valid);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.selectNative({ model: 'alpha', selectedServiceTier: 'priority' });
      window.notify('turn/started', { turnId: 'hidden-start' });
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.match(
      await stream(
        page,
        'hidden-start',
        'A hidden start cannot borrow the previous visible model.',
        false,
      ),
      /^— tok\/s/,
    );
    await choose(page, { model: 'beta', selectedServiceTier: null });
    assert.equal((await readAfterRefresh(page)).lastSpeed, valid);
  } finally {
    await browser.close();
  }
});
