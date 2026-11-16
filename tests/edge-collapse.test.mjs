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
window.ipc={postMessage:raw=>{const m=JSON.parse(raw);messages.push(m);if(m.action==='collapse'){geometry.expanded=false;geometry.unfold=0;sync();}if(m.action==='content-size'&&window.applySize){geometry.layoutWidth=m.width;geometry.layoutHeight=m.height;sync();}}};
startEdge(async data=>{reads++;if(data.op==='edge-tabs')window.savedTabs=data.tabs;return {
  edgeTabs:window.savedTabs||{order:window.featureIds||[window.featureId],selected:window.featureId},edgeTabsRevision:1,appearance:{language:'zh-CN'},
  features:(window.featureIds||[window.featureId]).map(id=>({id,owner:'fixture',placement:'edge',open:true,pending:null,reveal:0,view:{},size:[400,300]}))
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
            contents: `export function mountFeature(node,entry){
              window.mounts++;
              const shadow=node.attachShadow({mode:'open'});window.feature??=shadow;
              shadow.innerHTML='<button>操作</button><textarea>保留草稿</textarea><span data-busy="false"></span><dialog>对话框</dialog>';
              return {update(){},measure:()=>window.sizes?.[entry.id]||({width:400,height:300}),dispose(){window.disposals++;}};
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

async function fixture(t, id = 'model') {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.clock.install({ time: 0 });
  // 尚未挂载计时器，先冻结到未来时刻，避免繁忙机器上CDP传输超过1ms。
  await page.clock.pauseAt(60_000);
  await page.route('http://edge-collapse.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  );
  await page.goto('http://edge-collapse.test');
  await page.evaluate((id) => (window.featureId = id), id);
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
  await page.clock.runFor(2099);
  assert.equal(await collapsed(page), 0, 'the model retry waits 1500ms after the next state poll');
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
    await page.clock.runFor(2100);
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
  await page.clock.runFor(1499);
  assert.equal(await collapsed(page), 0);
  await page.clock.runFor(1);
  assert.equal(await collapsed(page), 1);
});

test('other edge features retain their shorter leave delay', async (t) => {
  const page = await fixture(t, 'board');
  await page.evaluate(() => pointer(false));
  await page.clock.runFor(449);
  assert.equal(await collapsed(page), 0);
  await page.clock.runFor(1);
  assert.equal(await collapsed(page), 1);
});

test('native hover reveals controls before focus even when WebKit hover is absent', async (t) => {
  const page = await fixture(t, 'board');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const actions = document.createElement('span');
    actions.className = 'edge-feature-actions';
    actions.innerHTML = '<button aria-label="合成操作">操作</button>';
    document.querySelector('#edge-panel > header').append(actions);
  });
  await page.mouse.move(1000, 700);
  await page.evaluate(() => pointer(true));
  await page.clock.runFor(160);
  assert.equal(await page.locator('#edge-panel').evaluate((n) => n.matches(':hover')), false);
  assert.equal(
    await page
      .getByRole('button', { name: '合成操作' })
      .evaluate((n) => getComputedStyle(n).opacity),
    '1',
  );
  await page.evaluate(() => pointer(false));
  await page.clock.runFor(160);
  assert.equal(
    await page
      .getByRole('button', { name: '合成操作' })
      .evaluate((n) => getComputedStyle(n).opacity),
    '0',
  );
});

test('an editor in the shared header holds the edge open until focus leaves', async (t) => {
  const page = await fixture(t, 'board');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'header-editor';
    document.querySelector('#edge-panel > header').append(input);
    input.focus();
    pointer(false);
  });
  await page.clock.runFor(1000);
  assert.equal(await collapsed(page), 0);
  await page.evaluate(() => document.querySelector('#header-editor').blur());
  await page.clock.runFor(1100);
  assert.equal(await collapsed(page), 1);
});

for (const scope of ['header', 'shadow']) {
  test(`an explicitly idle ${scope} editor blurs and releases mouse departure after keyboard input`, async (t) => {
    const page = await fixture(t, 'board');
    await page.evaluate((scope) => {
      const input = document.createElement('input');
      input.id = 'idle-editor';
      input.dataset.editing = 'false';
      input.addEventListener('blur', () => (window.idleBlurred = true));
      (scope === 'header' ? document.querySelector('#edge-panel > header') : feature).append(input);
      geometry.keyboard = true;
      sync();
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, composed: true }),
      );
      pointer(false);
    }, scope);
    await page.clock.runFor(449);
    assert.equal(await collapsed(page), 0);
    await page.clock.runFor(1);
    assert.equal(await collapsed(page), 1);
    assert.equal(await page.evaluate(() => window.idleBlurred), true);
  });
}

test('nonempty or composing transient editors retain the hold until they become idle', async (t) => {
  const page = await fixture(t, 'board');
  await page.evaluate(() => {
    const input = feature.querySelector('textarea');
    input.dataset.editing = 'true';
    input.focus();
    pointer(false);
  });
  await page.clock.runFor(1800);
  assert.equal(await collapsed(page), 0);
  await page.evaluate(() => (feature.querySelector('textarea').dataset.editing = 'false'));
  await page.clock.runFor(1100);
  assert.equal(await collapsed(page), 1);
});

test('an idle field does not cancel keyboard opening when the pointer never entered', async (t) => {
  const page = await fixture(t, 'board');
  await page.evaluate(() => {
    geometry.keyboard = true;
    sync();
    pointer(false);
    const input = feature.querySelector('textarea');
    input.dataset.editing = 'false';
    input.focus();
  });
  await page.clock.runFor(1800);
  assert.equal(await collapsed(page), 0);
});

test('switching to smaller content keeps the open footprint and releases it after collapse', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.applySize = true;
    window.featureIds = ['model', 'board'];
    window.sizes = { model: { width: 820, height: 500 }, board: { width: 456, height: 300 } };
    sync();
  });
  await page.clock.runFor(650);
  const large = await page.evaluate(() => ({
    width: geometry.layoutWidth,
    height: geometry.layoutHeight,
  }));
  assert.equal(large.width, 844);
  await page.locator('[data-edge-tab="board"]').click();
  await page.clock.runFor(100);
  assert.deepEqual(
    await page.evaluate(() => ({ width: geometry.layoutWidth, height: geometry.layoutHeight })),
    large,
  );
  await page.evaluate(() => pointer(geometry.layoutWidth >= 800));
  await page.clock.runFor(1000);
  assert.equal(await collapsed(page), 0, 'the former panel area remains inside after switching');
  await page.evaluate(() => pointer(false));
  await page.clock.runFor(449);
  assert.equal(await collapsed(page), 0);
  await page.clock.runFor(101);
  assert.equal(await collapsed(page), 1);
  const small = await page.evaluate(() => ({
    width: geometry.layoutWidth,
    height: geometry.layoutHeight,
  }));
  assert.equal(small.width, 480);
  assert.ok(small.height < large.height);
  await page.evaluate(() => {
    geometry.expanded = true;
    geometry.unfold = 1;
    sync();
    pointer(true);
  });
  await page.clock.runFor(100);
  assert.equal(await page.evaluate(() => geometry.layoutWidth), small.width);
  assert.deepEqual(await page.evaluate(() => ({ mounts, disposals })), { mounts: 2, disposals: 0 });
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
