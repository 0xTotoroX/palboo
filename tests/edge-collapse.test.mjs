/* [INPUT]: Real edge shell/navigation and synthetic feature content/native events.
 * [OUTPUT]: Busy/editing/interaction holds retry after release, preserve drafts, and cancel on reentry or exit.
 * [POS]: Isolated Chromium fixture; no real host, native window, model or settings.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const script = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import {startEdge} from './ui/surfaces/edge/main';
window.messages=[];window.reads=0;window.disposals=0;window.mounts=0;
window.geometry={expanded:true,keyboard:false,keepOpen:false,sceneRevision:1,unfold:1,layoutWidth:480,layoutHeight:480,theme:'matte'};
window.sync=()=>window.dispatchEvent(new CustomEvent('edge-native',{detail:{...geometry}}));
window.pointer=(inside,buttons=0)=>window.dispatchEvent(new CustomEvent('edge-pointer',{detail:{inside,buttons}}));
window.ipc={postMessage:raw=>{const m=JSON.parse(raw);messages.push(m);if(m.action==='collapse'){geometry.expanded=false;geometry.unfold=0;sync();}}};
startEdge(async()=>{reads++;return {
  edgeTabs:{order:['model'],selected:'model'},edgeTabsRevision:1,appearance:{language:'zh-CN'},
  features:[{id:'model',owner:'fixture',placement:'edge',open:true,pending:null,reveal:0,view:{},size:[400,300]}]
}});
sync();pointer(true);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [
      {
        name: 'synthetic-content',
        setup(b) {
          b.onResolve({ filter: /workspace\/mount$/ }, () => ({
            path: 'mount',
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `export function mountFeature(node){
              window.mounts++;
              window.feature=node.attachShadow({mode:'open'});
              feature.innerHTML='<button>操作</button><textarea>保留草稿</textarea><span data-busy="false"></span><dialog>对话框</dialog>';
              return {update(){},measure:()=>({width:400,height:300}),dispose(){window.disposals++;}};
            }`,
          }));
          b.onResolve({ filter: /\.css\?inline$/ }, (a) => ({
            path: resolve(dirname(a.importer), a.path.split('?')[0]),
            namespace: 'inline-css',
          }));
          b.onLoad({ filter: /.*/, namespace: 'inline-css' }, (a) => ({
            contents: readFileSync(a.path, 'utf8'),
            loader: 'text',
          }));
        },
      },
    ],
  })
).outputFiles[0].text;

async function fixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1);
  await page.route('http://edge-collapse.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  );
  await page.goto('http://edge-collapse.test');
  await page.addScriptTag({ content: script });
  await page.evaluate(() => {
    if (!window.feature) throw Error('synthetic feature was not mounted');
  });
  return page;
}
const collapsed = (page) =>
  page.evaluate(() => messages.filter((message) => message.action === 'collapse').length);

test('edge retries a busy operation after it finishes without another pointer event', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    geometry.keyboard = true;
    sync();
    feature
      .querySelector('button')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    feature.querySelector('[data-busy]').dataset.busy = 'true';
    pointer(false);
  });
  await page.clock.runFor(1800);
  assert.equal(await collapsed(page), 0);
  await page.evaluate(() => (feature.querySelector('[data-busy]').dataset.busy = 'false'));
  await page.clock.runFor(1049);
  assert.equal(await collapsed(page), 0, 'the retry still waits 450ms after the next state poll');
  await page.clock.runFor(1);
  assert.equal(await collapsed(page), 1);
  await page.clock.runFor(1800);
  assert.equal(await collapsed(page), 1, 'collapsed windows do not keep sending collapse');
  assert.deepEqual(
    await page.evaluate(() => ({
      mounts,
      disposals,
      draft: feature.querySelector('textarea').value,
    })),
    { mounts: 1, disposals: 0, draft: '保留草稿' },
  );
});

for (const hold of ['dialog', 'editing', 'dragging', 'buttons', 'keepOpen', 'keyboard']) {
  test(`edge preserves the ${hold} hold and retries once it is released`, async (t) => {
    const page = await fixture(t);
    await page.evaluate((hold) => {
      if (hold === 'dialog') feature.querySelector('dialog').show();
      if (hold === 'editing') feature.querySelector('textarea').focus();
      if (hold === 'dragging') document.querySelector('nav').dataset.dragging = 'true';
      if (hold === 'keepOpen') geometry.keepOpen = true;
      if (hold === 'keyboard') geometry.keyboard = true;
      sync();
      pointer(false, hold === 'buttons' ? 1 : 0);
    }, hold);
    await page.clock.runFor(1800);
    assert.equal(await collapsed(page), 0);
    await page.evaluate((hold) => {
      if (hold === 'dialog') feature.querySelector('dialog').close();
      if (hold === 'editing') feature.querySelector('textarea').blur();
      if (hold === 'dragging') delete document.querySelector('nav').dataset.dragging;
      if (hold === 'buttons') pointer(false, 0);
      if (hold === 'keepOpen') {
        geometry.keepOpen = false;
        sync();
      }
      if (hold === 'keyboard')
        document.querySelector('#edge-panel').dispatchEvent(new PointerEvent('pointerdown'));
    }, hold);
    await page.clock.runFor(1050);
    assert.equal(await collapsed(page), 1);
  });
}

test('pointer reentry cancels a deferred collapse and a new leave keeps the normal delay', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    feature.querySelector('[data-busy]').dataset.busy = 'true';
    pointer(false);
  });
  await page.clock.runFor(600);
  await page.evaluate(() => {
    pointer(true);
    feature.querySelector('[data-busy]').dataset.busy = 'false';
  });
  await page.clock.runFor(1800);
  assert.equal(await collapsed(page), 0);
  await page.evaluate(() => pointer(false));
  await page.clock.runFor(449);
  assert.equal(await collapsed(page), 0);
  await page.clock.runFor(1);
  assert.equal(await collapsed(page), 1);
});

test('page exit clears the deferred retry, pending timeout and state poll', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    feature.querySelector('[data-busy]').dataset.busy = 'true';
    pointer(false);
  });
  await page.clock.runFor(600);
  await page.evaluate(() => (feature.querySelector('[data-busy]').dataset.busy = 'false'));
  await page.clock.runFor(600);
  const reads = await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    pointer(false);
    return window.reads;
  });
  await page.clock.runFor(3000);
  assert.equal(await collapsed(page), 0);
  assert.deepEqual(await page.evaluate(() => ({ reads, disposals })), { reads, disposals: 1 });
});
