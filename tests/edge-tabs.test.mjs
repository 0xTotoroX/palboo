/* [INPUT]: Actual edge shell, feature mounts and synthetic guarded task/tab transport.
 * [OUTPUT]: Persisted reorder/selection, draft retention and bounded, opaque board detail checks.
 * [POS]: Browser-only fixtures; no real settings, chats or tasks. [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const script = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import {startEdge} from './ui/surfaces/edge/main';
const initial={edgeTabs:{order:[],selected:''},edgeTabsRevision:1};
window.prefs=JSON.parse(localStorage.getItem('test-tabs')||'null')||initial;
window.fail=false;window.pause=false;window.writes=[];window.messages=[];
window.features=['board','model'].map(id=>({id,placement:'edge',owner:id,open:true,pending:null,reveal:1,view:{},size:[720,600]}));
const task={id:'task',fields:{title:'测试任务',notes:'原备注',priority:0,due:null,column:'todo',completed:false},archived:false,remote:null,conflict:null};
window.tasks={store:{revision:1,boardEnabled:true,syncEnabled:false,bindings:{calendarId:''},tasks:[task],inflight:null},status:'本地看板'};
window.model={revision:1,preferences:{enabled:true,pinned:[],presets:[]},snapshot:{target:{id:'fixture'},revision:'1',status:'ready',message:'',current:{model:'a',reasoning:'high',speed:'standard'},models:[{id:'a',label:'测试模型',reasoning:['high'],fast:false}]}};
window.theme='native-glass';window.dark=false;window.expanded=true;let size={width:744,height:500};
window.geometry=()=>window.dispatchEvent(new CustomEvent('edge-native',{detail:{expanded,unfold:expanded?1:0,layoutX:20,layoutY:40,layoutWidth:size.width,layoutHeight:size.height,compactWidth:10,compactHeight:80,sceneRevision:1,theme,liquidVariant:'clear',nativeGlassAvailable:true,appearance:{hostTheme:{theme:dark?'dark':'light'}}}}));
window.ipc={postMessage:raw=>{const m=JSON.parse(raw);messages.push(m);if(m.action==='content-size')size={width:Math.min(innerWidth-40,m.width),height:Math.min(innerHeight-80,m.height)};if(m.action==='collapse')expanded=false;if(['expand','focus'].includes(m.action))expanded=true;if(['ready','content-size','expand','collapse','focus'].includes(m.action))geometry();}};
window.request=async input=>{
 if(input.op==='state')return structuredClone({...prefs,features,appearance:{themes:{edge:{theme,liquidVariant:'clear'}}}});
 if(input.op==='edge-tabs') {writes.push(input);if(pause)await new Promise(r=>window.finish=r);if(fail)throw Error('模拟保存失败');if(JSON.stringify(input.expected)!==JSON.stringify(prefs.edgeTabs))throw Error('标签冲突');prefs={edgeTabs:input.tabs,edgeTabsRevision:prefs.edgeTabsRevision+1};localStorage.setItem('test-tabs',JSON.stringify(prefs));return structuredClone(prefs);}
 const entry=features.find(e=>e.id===input.id);
 if(input.op==='read'&&!['board','model'].includes(input.id))throw Error('未连接的测试功能');
 if(input.op==='read')return structuredClone({...input.id==='board'?tasks:model,appearance:{theme:dark?'dark':'light',surface:{theme,liquidVariant:'clear'}}});
 if(input.op==='save'){entry.view=input.view;return {};}
 if(input.op==='action'&&input.id==='board'){writes.push(input);task.fields=input.data.fields;tasks.store.revision++;return structuredClone(tasks);}
 return {};
};startEdge(request);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'inline-css',
        setup(b) {
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
async function fixture(t, viewport = { width: 1050, height: 920 }) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(8000);
  await page.route('http://edge.test/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div><script>' + script + '</script>',
    }),
  );
  await page.goto('http://edge.test');
  await page.locator('.card-title').waitFor();
  return page;
}
const labels = (page) =>
  page
    .locator('#edge-panel > header > nav > button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
test('edge tabs drag and keyboard reorder, persist selection, retain drafts and reject failed saves', async (t) => {
  const page = await fixture(t);
  const nav = page.locator('#edge-panel > header > nav');
  await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
  await page.getByLabel('新任务标题', { exact: true }).fill('未保存草稿');
  const board = nav.getByRole('button', { name: '看板', exact: true }),
    model = nav.getByRole('button', { name: '模型切换', exact: true });
  // A real drag to the leading half of the first tab.
  await model.dragTo(board, { targetPosition: { x: 2, y: 12 } });
  await page.waitForFunction(() => prefs.edgeTabs.order[0] === 'model');
  assert.deepEqual(await labels(page), ['模型切换', '看板']);
  assert.equal(await board.getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(260);
  await model.click();
  await page.waitForFunction(() => prefs.edgeTabs.selected === 'model');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.edgeTab), 'model');
  await board.click();
  assert.equal(await page.getByLabel('新任务标题', { exact: true }).inputValue(), '未保存草稿');
  await model.click();
  await page.waitForFunction(() => prefs.edgeTabs.selected === 'model');
  await page.reload();
  await page.locator('[data-feature="model"]').waitFor();
  assert.deepEqual(await labels(page), ['模型切换', '看板']);
  assert.equal(await model.getAttribute('aria-pressed'), 'true');
  await model.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForFunction(() => prefs.edgeTabs.order[0] === 'board');
  await page.evaluate(() => {
    fail = true;
  });
  await board.click();
  await page.locator('#edge-error').filter({ hasText: '未保存' }).waitFor();
  assert.equal(await model.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => prefs.edgeTabs.selected), 'model');
  assert.equal(await page.evaluate(() => writes.some((w) => w.op === 'action')), false);
});
test('edge board uses columns and an opaque detail surface within native bounds with reachable save', async (t) => {
  const page = await fixture(t);
  const board = page.locator('[data-feature="board"]');
  await page.waitForFunction(
    () => document.querySelector('.edge-view').getBoundingClientRect().width >= 720,
  );
  assert.equal(await board.locator('.board-column:visible').count(), 3);
  const boardSize = await board.boundingBox();
  assert.ok(boardSize.height >= 440, 'few tasks retain a full reading surface');
  await board.getByRole('button', { name: '任务详情：测试任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '任务详情' });
  await dialog.waitFor();
  await page.getByLabel('备注', { exact: true }).fill('详情草稿');
  mkdirSync('target/reports/edge-tabs', { recursive: true });
  for (const theme of ['matte', 'frosted', 'native-glass', 'black']) {
    await page.evaluate((theme) => {
      window.theme = theme;
      geometry();
    }, theme);
    await page.waitForTimeout(700);
    const metrics = await dialog.evaluate((n) => {
      const r = n.getBoundingClientRect(),
        host = n.getRootNode().host,
        b = host.getBoundingClientRect(),
        c = getComputedStyle(n);
      return {
        r: { x: r.x, y: r.y, width: r.width, height: r.height },
        b: { x: b.x, y: b.y, width: b.width, height: b.height },
        background: c.backgroundColor,
      };
    });
    for (const key of ['x', 'y', 'width', 'height'])
      assert.ok(Math.abs(metrics.r[key] - metrics.b[key]) < 1, JSON.stringify(metrics));
    assert.ok(
      !metrics.background.startsWith('rgba') && !metrics.background.includes(' / '),
      metrics.background,
    );
    if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
      await page.screenshot({ path: 'target/reports/edge-tabs/board-' + theme + '.png' });
  }
  // Short display: every field and save remain reachable within the clipped native panel.
  await page.setViewportSize({ width: 800, height: 460 });
  await page.evaluate(() => {
    messages = [];
    window.dispatchEvent(new Event('resize'));
    geometry();
  });
  // Force native screen height clamping through the existing content-size message.
  await page.evaluate(() =>
    ipc.postMessage(JSON.stringify({ action: 'content-size', width: 744, height: 900 })),
  );
  const save = dialog.getByRole('button', { name: '保存', exact: true });
  await save.scrollIntoViewIfNeeded();
  const d = await dialog.boundingBox(),
    b = await save.boundingBox();
  assert.ok(b.y >= d.y && b.y + b.height <= d.y + d.height + 1);
  await page.getByLabel('优先级', { exact: true }).selectOption('5');
  await save.click();
  await page.waitForFunction(() => tasks.store.tasks[0].fields.notes === '详情草稿');
  assert.equal(await page.evaluate(() => tasks.store.tasks[0].fields.priority), 5);
});

test('edge tab saves serialize rapid selection and preserve absent feature preferences', async (t) => {
  const page = await fixture(t);
  const nav = page.locator('#edge-panel > header > nav');
  const board = nav.getByRole('button', { name: '看板', exact: true });
  const model = nav.getByRole('button', { name: '模型切换', exact: true });
  await page.evaluate(() => {
    pause = true;
  });
  await model.click();
  await board.click();
  assert.equal(await page.evaluate(() => writes.filter((w) => w.op === 'edge-tabs').length), 1);
  await page.evaluate(() => {
    pause = false;
    finish();
  });
  await page.waitForFunction(
    () => prefs.edgeTabsRevision === 3 && prefs.edgeTabs.selected === 'board',
  );
  await model.click();
  await page.waitForFunction(() => prefs.edgeTabs.selected === 'model');
  await page.evaluate(() => (features[1].open = false));
  await model.waitFor({ state: 'hidden' });
  assert.equal(await board.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => prefs.edgeTabs.selected), 'model');
  await page.evaluate(() => (features[1].open = true));
  await page.waitForFunction(
    () =>
      document.querySelector('[data-edge-tab="model"]')?.getAttribute('aria-pressed') === 'true',
  );
  // Stale tab snapshots must not overwrite another writer's persisted order.
  await page.evaluate(() => {
    prefs.edgeTabs = { order: ['model', 'board'], selected: 'board' };
    prefs.edgeTabsRevision++;
  });
  await board.click();
  await page.locator('#edge-error').filter({ hasText: '标签冲突' }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-edge-tab="board"]')?.getAttribute('aria-pressed') === 'true',
  );
  assert.deepEqual(await labels(page), ['模型切换', '看板']);
});

test('board keeps its reading size as tasks grow and uses tabs on a constrained display', async (t) => {
  const page = await fixture(t);
  const panel = page.locator('#edge-panel');
  await page.waitForFunction(() => document.querySelector('#edge-panel').offsetHeight >= 480);
  const initial = await panel.boundingBox();
  await page.evaluate(() => {
    const original = tasks.store.tasks[0];
    tasks.store.tasks = Array.from({ length: 18 }, (_, i) => ({
      ...original,
      id: `task-${i}`,
      fields: {
        ...original.fields,
        title: `长任务 ${i}：保留完整说明，检查不同窗口与分组内的可读性。`,
      },
    }));
    tasks.store.revision++;
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.edge-view').shadowRoot.querySelectorAll('.task-card').length === 18,
  );
  assert.equal((await panel.boundingBox()).height, initial.height);
  assert.ok(await page.locator('.board-grid').evaluate((n) => n.scrollHeight > n.clientHeight));
  await page.setViewportSize({ width: 420, height: 600 });
  await page.evaluate(() =>
    ipc.postMessage(JSON.stringify({ action: 'content-size', width: 744, height: 498 })),
  );
  await page.locator('.board-grid.narrow').waitFor();
  assert.equal(await page.locator('.board-column:visible').count(), 1);
  assert.equal(await page.locator('.stage-tabs button').count(), 3);
  const rect = await panel.boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 420 && rect.y + rect.height <= 600);
});

test('six icon tabs remain reachable beside model headings and catalog controls in a narrow panel', async (t) => {
  const page = await fixture(t, { width: 420, height: 920 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const nav = page.locator('#edge-panel > header > nav');
  await page.evaluate(() => {
    model.preferences.pinned = ['a'];
    model.preferences.modelColumnWidth = 100;
    model.snapshot.models[0].reasoning = ['low', 'high'];
    model.snapshot.models[0].fast = true;
    features.push(
      ...['outline', 'next', 'terms', 'bots'].map((id) => ({
        ...features[0],
        id,
        owner: id,
        view: {},
      })),
    );
  });
  await nav.getByRole('button', { name: 'Grok Bot', exact: true }).waitFor();
  await nav.getByRole('button', { name: '模型切换', exact: true }).click();
  await page
    .locator('.model-inline-heading:not([hidden]) [data-reasoning-label]')
    .first()
    .waitFor();
  const inspect = () =>
    nav.locator('button').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const svg = node.querySelector('svg').getBoundingClientRect();
        return {
          id: node.dataset.edgeTab,
          icon: node.querySelector('svg').dataset.icon,
          label: node.getAttribute('aria-label'),
          title: node.title,
          text: node.textContent,
          box: box.toJSON(),
          svg: svg.toJSON(),
          reachable: node.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          ),
        };
      }),
    );
  const icons = await inspect();
  assert.deepEqual(
    icons.map((item) => item.icon),
    [
      'feature-board',
      'feature-model',
      'feature-outline',
      'feature-next',
      'feature-terms',
      'feature-bots',
    ],
  );
  for (const icon of icons) {
    assert.equal(icon.text.trim(), '');
    assert.equal(icon.label, icon.title);
    assert.equal(icon.box.width, 28);
    assert.equal(icon.box.height, 28);
    assert.equal(icon.svg.width, 18);
    assert.equal(icon.svg.height, 18);
    assert.ok(icon.reachable, icon.id + ' is directly clickable');
  }
  const fast = await page.locator('header .model-fast').boundingBox();
  assert.ok(
    icons.every((icon) => icon.box.right <= fast.x),
    'icons leave the Fast column clear',
  );
  const head = await page.locator('#edge-panel > header').boundingBox();
  const body = await page.locator('#edge-views').boundingBox();
  assert.ok(Math.max(...icons.map((icon) => icon.box.bottom)) <= head.y + head.height);
  assert.ok(body.y >= head.y + head.height, 'wrapping is included in native content height');
  await page.getByRole('button', { name: '所有模型', exact: true }).click();
  await page.locator('.model-catalog-title').waitFor();
  assert.ok(
    (await inspect()).every((icon) => icon.reachable),
    'catalog retains every feature switch',
  );
  const title = await page.locator('.model-catalog-title').boundingBox();
  const catalogIcons = await inspect();
  assert.ok(title.x >= Math.max(...catalogIcons.map((icon) => icon.box.right)));
  for (const label of ['Grok Bot', '术语', '下一步', '大纲', '看板', '模型切换']) {
    await nav.getByRole('button', { name: label, exact: true }).click();
    assert.equal(
      await nav.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'),
      'true',
      `${label}: ${JSON.stringify(await page.evaluate(() => ({ prefs, writes })))}`,
    );
  }
  assert.equal(await page.evaluate(() => writes.some((write) => write.op === 'action')), false);
  assert.deepEqual(errors, []);
});
