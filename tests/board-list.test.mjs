/* [INPUT]: Actual feature shell, Board/TaskSettings and an isolated revision-checked task service.
 * [OUTPUT]: List selection, data identity, save-confirmed completion motion, icon recovery and simple rendered layout.
 * [POS]: Synthetic browser regression; never reads user tasks or uses EventKit.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{mountFeature}from'./ui/surfaces/workspace/mount';
import{TaskSettings}from'./ui/settings/task-settings';import{useTasks}from'./ui/features/board/api';
import{setLocale}from'./ui/shared/i18n';import{iconSvg}from'./ui/shared/icons';
const task=(id,title,column='todo',completed=false,archived=false)=>({id,fields:{title,column,completed,notes:'notes-'+id,priority:3,due:{year:2026,month:12,day:1,hour:9,minute:30,timeZone:'Asia/Shanghai'}},archived,remote:null,remoteMissing:false,conflict:null,deleteRequested:false});
window.state={status:'ready',store:{revision:1,displayMode:'list',viewMode:'expanded',boardEnabled:true,syncEnabled:false,bindings:{calendarId:''},columns:[{id:'todo',title:'待办'},{id:'doing',title:'进行中'},{id:'custom',title:'自定义分组'},{id:'done',title:'完成'}],tasks:[task('a','整理本周笔记'),task('b','确认 Palboo 更新','doing'),task('c','回复设计反馈','custom'),task('d','合成完成记录','todo',true),task('e','历史归档记录','doing',false,true)],inflight:null},appearance:{theme:'dark',colors:{text:'#eee',muted:'#aaa',accent:'#a67df2','surface-opaque':'#000'}}};
window.writes=[];window.entry={id:'board',owner:'fixture',open:true,placement:'sidebar',pending:null,reveal:1,view:{},size:[380,460]};
const snapshot=()=>structuredClone(window.state);
async function command(data){window.writes.push(structuredClone(data));if(window.waitSave)await new Promise(r=>window.releaseSave=r);if(window.failSave)throw Error('合成保存失败');if(data.revision!==state.store.revision)throw Error('合成修订冲突');
 if(data.op==='view'){if(data.displayMode)state.store.displayMode=data.displayMode;if(data.viewMode)state.store.viewMode=data.viewMode;}
 else if(data.op==='update'){const t=state.store.tasks.find(t=>t.id===data.id);if(JSON.stringify(t)!==JSON.stringify(data.expectedTask))throw Error('合成任务已更新');t.fields=structuredClone(data.fields);if(typeof data.archived==='boolean')t.archived=data.archived;}
 else if(data.op==='create')state.store.tasks.push({...task('new','new'),fields:structuredClone(data.fields)});
 else if(data.op==='remove')state.store.tasks=state.store.tasks.filter(t=>t.id!==data.id);
 else throw Error('Unexpected task command');state.store.revision++;return snapshot();}
const taskRequest=async(path,data)=>data?command(data):snapshot();
function Settings(){const tasks=useTasks(true,taskRequest);return <TaskSettings tasks={tasks}/>;}createRoot(document.getElementById('settings')).render(<Settings/>);
const request=async data=>{if(data.op==='read')return snapshot();if(data.op==='action')return command(data.data);if(data.op==='save')entry.view=structuredClone(data.view);return {};};
document.querySelector('nav button').innerHTML=iconSvg('feature-board');let mounted;window.measure=()=>mounted.measure();window.remount=()=>{mounted?.dispose();document.querySelector('.csw-feature-content').innerHTML='<div id="mount" style="height:100%"></div>';mounted=mountFeature(document.getElementById('mount'),entry,'fixture',window.placement||'sidebar',request,()=>{});document.getElementById('actions').replaceChildren(mounted.headerActions);};
window.language=language=>{state.appearance.language=language;setLocale(language);window.dispatchEvent(new Event('focus'));};window.remount();
`,
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    plugins: [
      {
        name: 'inline-css',
        setup(b) {
          b.onResolve({ filter: /\.css\?inline$/ }, (a) => ({
            path: resolve(dirname(a.importer), a.path.split('?')[0]),
            namespace: 'css-text',
          }));
          b.onLoad({ filter: /.*/, namespace: 'css-text' }, (a) => ({
            contents: readFileSync(a.path, 'utf8'),
            loader: 'text',
          }));
        },
      },
    ],
  })
).outputFiles[0].text;
async function fixture(t, reducedMotion = 'reduce', options = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1100, height: 760 },
    reducedMotion,
    ...options,
  });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('http://board-list.test/', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<meta charset="utf-8"><main class="csw-workbench csw-workbench-pane" style="display:flex;flex-direction:column;width:380px;height:460px;background:#000;color:#eee;--csw-text:#eee;--csw-muted:#aaa;--csw-accent:#a67df2"><header class="csw-feature-pane-head"><nav class="csw-workbench-tabs" data-icon-tabs><button aria-label="任务看板">任务</button></nav><div class="csw-feature-header-actions" id="actions"></div></header><div class="csw-feature-content"><div id="mount" style="height:100%"></div></div></main><aside id="settings" style="margin-top:40px"></aside>',
    }),
  );
  await page.goto('http://board-list.test/');
  await page.addStyleTag({ content: readFileSync('ui/surfaces/workspace/styles.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-view-mode="list"]').waitFor();
  return page;
}
test('board and list share task identity and saved layout through settings and remount', async (t) => {
  const page = await fixture(t);
  const before = await page.evaluate(() => structuredClone(state.store.tasks));
  assert.deepEqual(
    await page.locator('[data-list-task]').evaluateAll((ns) => ns.map((n) => n.dataset.listTask)),
    ['a', 'b', 'c'],
  );
  assert.equal(await page.locator('.stage-tabs,.column-heading,.task-list summary').count(), 0);
  const select = page.getByLabel('显示方式', { exact: true });
  await select.selectOption('board');
  await page.locator('[data-view-mode="expanded"]').waitFor();
  assert.equal(await page.locator('#board-view-mode').isVisible(), true);
  await select.selectOption('list');
  await page.locator('[data-view-mode="list"]').waitFor();
  assert.equal(await page.locator('#board-view-mode').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => state.store.tasks), before);
  assert.equal(await page.evaluate(() => state.store.viewMode), 'expanded');
  await page.getByRole('button', { name: '添加待办', exact: true }).click();
  await page.getByRole('textbox', { name: '添加待办', exact: true }).fill('交接前未提交草稿');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.remount());
  await page.getByRole('textbox', { name: '添加待办', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('textbox', { name: '添加待办', exact: true }).inputValue(),
    '交接前未提交草稿',
  );
  assert.deepEqual(await page.evaluate(() => writes.map((w) => w.op)), ['view', 'view']);
});
test('completion waits for saving, hides with motion, and icon recovery preserves the original task', async (t) => {
  const page = await fixture(t, 'no-preference');
  const before = await page.evaluate(() =>
    structuredClone(state.store.tasks.find((t) => t.id === 'b')),
  );
  await page.evaluate(() => (window.waitSave = true));
  await page.getByRole('checkbox', { name: '完成任务：确认 Palboo 更新', exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseSave === 'function');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-list-task="b"][data-completing]').isVisible(), true);
  assert.equal(
    await page.getByRole('button', { name: '查看已完成', exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => {
    window.waitSave = false;
    window.releaseSave();
  });
  await page.locator('[data-list-task="b"]').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '查看已完成', exact: true }).click();
  await page.getByRole('button', { name: '恢复任务：确认 Palboo 更新', exact: true }).waitFor();
  await page.getByRole('button', { name: '恢复任务：确认 Palboo 更新', exact: true }).click();
  await page.locator('[data-list-task="b"]').waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => state.store.tasks.find((t) => t.id === 'b')), before);
  await page.getByRole('button', { name: '恢复任务：历史归档记录', exact: true }).click();
  await page.locator('[data-list-task="e"]').waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => state.store.tasks.find((t) => t.id === 'e').archived),
    false,
  );
  await page.getByRole('button', { name: '返回待办', exact: true }).click();
  await page.evaluate(() => (window.failSave = true));
  await page.getByRole('checkbox', { name: '完成任务：回复设计反馈', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '合成保存失败' }).first().waitFor();
  await page.locator('[data-list-task="c"]:not([data-completing])').waitFor();
  assert.equal(
    await page
      .getByRole('checkbox', { name: '完成任务：回复设计反馈', exact: true })
      .getAttribute('aria-checked'),
    'false',
  );
  assert.equal(await page.evaluate(() => state.store.tasks.length), 5);
  assert.ok(await page.evaluate(() => writes.every((w) => w.op !== 'remove')));
});
test('list stays flat, aligned and keyboard accessible in narrow and short actual shells', async (t) => {
  const page = await fixture(t);
  const measurements = [];
  await page.getByRole('button', { name: '添加待办', exact: true }).click();
  for (const language of ['zh-CN', 'en']) {
    await page.evaluate((language) => window.language(language), language);
    for (const width of [240, 380]) {
      await page
        .locator('main.csw-workbench-pane')
        .evaluate((n, width) => (n.style.width = width + 'px'), width);
      const add = page.locator('.task-list-add input');
      const layout = await add.evaluate((input) => {
        const root = input.closest('.board-app'),
          title = root.querySelector('.task-list-title');
        const s = getComputedStyle(input),
          form = getComputedStyle(input.parentElement);
        return {
          aligned:
            Math.abs(input.getBoundingClientRect().left - title.getBoundingClientRect().left) < 1,
          shadow: s.boxShadow,
          inputLeft: input.getBoundingClientRect().left,
          titleLeft: title.getBoundingClientRect().left,
          formShadow: form.boxShadow,
          background: s.backgroundColor,
          overflow: root.scrollWidth > root.clientWidth,
          hit: root.querySelector('.task-list-toggle').getBoundingClientRect().width,
        };
      });
      assert.equal(layout.aligned, true, JSON.stringify(layout));
      assert.equal(layout.shadow, 'none');
      assert.equal(layout.formShadow, 'none');
      assert.equal(layout.background, 'rgba(0, 0, 0, 0)');
      assert.equal(layout.overflow, false);
      assert.ok(layout.hit >= 28);
      measurements.push(layout);
    }
  }
  await page.getByRole('checkbox').first().focus();
  await page.keyboard.press('Space');
  await page.locator('[data-list-task="a"]').waitFor({ state: 'detached' });
  assert.equal(
    await page
      .getByRole('checkbox')
      .first()
      .evaluate((n) => n.getRootNode().activeElement === n),
    true,
  );
  const input = page.getByRole('textbox', { name: 'Add a task', exact: true });
  await input.fill('Keyboard task');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Task details: Keyboard task', exact: true }).waitFor();
  assert.equal(await input.count(), 0);
  mkdirSync('target/reports/board-list', { recursive: true });
  await page
    .locator('main.csw-workbench-pane')
    .screenshot({ path: 'target/reports/board-list/list.png' });
});

test('edge list uses natural content size while retaining the original board size', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.placement = 'edge';
    window.remount();
  });
  await page.locator('[data-view-mode=list]').waitFor();
  const list = await page.evaluate(() => window.measure());
  assert.ok(list.width < 920 && list.height < 620, JSON.stringify(list));
  await page.getByLabel('显示方式', { exact: true }).selectOption('board');
  await page.locator('[data-view-mode=expanded]').waitFor();
  const board = await page.evaluate(() => window.measure());
  assert.equal(board.width, 920);
  assert.ok(board.height >= 620);
});

test('search and task entry open only after an explicit icon action and retain their own handoff state', async (t) => {
  const page = await fixture(t);
  const addIcon = page.getByRole('button', { name: '添加待办', exact: true });
  await page.mouse.move(1000, 700);
  assert.equal(await addIcon.evaluate((n) => getComputedStyle(n).opacity), '0');
  await page.mouse.move(150, 120);
  assert.equal(await addIcon.evaluate((n) => getComputedStyle(n).opacity), '1');
  await page.mouse.move(1000, 700);
  await addIcon.focus();
  assert.equal(await addIcon.evaluate((n) => getComputedStyle(n).opacity), '1');
  assert.equal(await page.locator('.board-search,.task-list-add').count(), 0);
  await page.evaluate(() => {
    entry.view = {
      board: {
        search: 'obsolete query',
        quickAdd: { column: 'todo', title: '' },
        stage: 'todo',
        tab: 'board',
      },
    };
    window.remount();
  });
  await page.locator('[data-list-task="a"]').waitFor();
  assert.equal(await page.locator('.board-search').count(), 0);
  assert.equal(
    await page.locator('.task-list-add').count(),
    0,
    'an old empty draft is not an explicit add action',
  );
  assert.equal(
    await page.locator('[data-list-task]').count(),
    3,
    'an old hidden query does not filter tasks',
  );
  const firstRow = await page.locator('[data-list-task="a"]').boundingBox();
  await page.getByRole('button', { name: '搜索任务', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索任务', exact: true });
  assert.equal(await page.locator('#actions .board-search-control').count(), 1);
  assert.equal(await page.locator('.board-search-row').count(), 0);
  assert.ok(
    Math.abs((await page.locator('[data-list-task="a"]').boundingBox()).y - firstRow.y) < 1,
  );
  await search.fill('Palboo');
  assert.equal(await page.locator('[data-list-task]').count(), 1);
  const rect = await search.boundingBox();
  assert.ok(rect.height <= 34 && rect.width <= 320, JSON.stringify(rect));
  await page.evaluate(() => window.remount());
  await search.waitFor();
  assert.equal(await search.inputValue(), 'Palboo');
  await search.press('Escape');
  assert.equal(await search.count(), 0);
  assert.equal(await page.locator('[data-list-task]').count(), 3);
  assert.equal(
    await page
      .getByRole('button', { name: '搜索任务', exact: true })
      .evaluate((n) => document.activeElement === n),
    true,
  );
  await page.getByRole('button', { name: '添加待办', exact: true }).click();
  const add = page.getByRole('textbox', { name: '添加待办', exact: true });
  await add.fill('仅是待办草稿');
  await page.evaluate(() => window.remount());
  await add.waitFor();
  assert.equal(await add.inputValue(), '仅是待办草稿');
  await add.press('Escape');
  assert.equal(await add.count(), 0);
  assert.equal(await page.evaluate(() => writes.length), 0);
});

test('touch keeps the icon entry reachable without exposing an idle task input', async (t) => {
  const page = await fixture(t, 'reduce', { hasTouch: true });
  const add = page.getByRole('button', { name: '添加待办', exact: true });
  assert.equal(await add.evaluate((n) => getComputedStyle(n).opacity), '1');
  assert.equal(await page.locator('.task-list-add').count(), 0);
  await add.tap();
  await page.getByRole('textbox', { name: '添加待办', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => writes.length), 0);
});

test('one checklist fills narrow and wide embedded, desktop and edge allocations without forcing overflow', async (t) => {
  const page = await fixture(t);
  const results = [];
  await page.evaluate(() => {
    state.store.tasks[0].fields.title =
      '核对跨项目的清单与浮窗布局适配，以及较长的 MyOncode 项目名称';
    entry.view = {};
  });
  for (const placement of ['sidebar', 'desktop', 'edge']) {
    await page.evaluate((placement) => {
      window.placement = placement;
      window.remount();
    }, placement);
    await page.locator('[data-view-mode="list"]').waitFor();
    for (const width of [240, 760]) {
      await page
        .locator('main.csw-workbench-pane')
        .evaluate((node, width) => (node.style.width = width + 'px'), width);
      const layout = await page.locator('[data-list-task="a"]').evaluate((node) => {
        const app = node.closest('.board-app'),
          title = node.querySelector('.task-list-title'),
          span = title.querySelector('span');
        return {
          overflow: app.scrollWidth > app.clientWidth,
          lines: span.getClientRects().length,
          titleWidth: title.getBoundingClientRect().width,
        };
      });
      assert.equal(layout.overflow, false, JSON.stringify({ placement, width, layout }));
      if (width === 760)
        assert.equal(layout.lines, 1, JSON.stringify({ placement, width, layout }));
      const beforeSearchY = (await page.locator('[data-list-task="a"]').boundingBox()).y;
      await page.getByRole('button', { name: '搜索任务', exact: true }).click();
      const search = page.getByRole('searchbox', { name: '搜索任务', exact: true });
      const searchLayout = await search.evaluate((input) => {
        const root = document.querySelector('main.csw-workbench-pane').getBoundingClientRect();
        const form = input.closest('form').getBoundingClientRect(),
          css = getComputedStyle(input);
        return {
          right: form.right,
          limit: root.right,
          outline: css.outlineStyle,
          topBorder: css.borderTopWidth,
          height: input.getBoundingClientRect().height,
        };
      });
      assert.ok(
        searchLayout.right <= searchLayout.limit + 1,
        JSON.stringify({ placement, width, searchLayout }),
      );
      assert.equal(searchLayout.outline, 'none');
      assert.equal(searchLayout.topBorder, '0px');
      assert.ok(
        Math.abs((await page.locator('[data-list-task="a"]').boundingBox()).y - beforeSearchY) < 1,
      );
      if (placement === 'edge') {
        mkdirSync('target/reports/edge-interaction', { recursive: true });
        await page
          .locator('main.csw-workbench-pane')
          .screenshot({ path: `target/reports/edge-interaction/search-${width}.png` });
      }
      await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
      results.push({ placement, allocationWidth: width, ...layout });
    }
  }
  const natural = await page.evaluate(() => window.measure());
  assert.ok(natural.width > 456 && natural.width <= 976, JSON.stringify(natural));
  mkdirSync('target/reports/board-list', { recursive: true });
  await page
    .locator('main.csw-workbench-pane')
    .screenshot({ path: 'target/reports/board-list/wide.png' });
  await page.evaluate(() => {
    state.store.tasks[0].fields.title = '极长标题'.repeat(100);
    window.remount();
  });
  await page.locator('[data-list-task="a"]').waitFor();
  assert.equal((await page.evaluate(() => window.measure())).width, 976);
  mkdirSync('target/reports/board-list', { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    'target/reports/board-list/surface-layout.json',
    JSON.stringify({ results, natural }, null, 2),
  );
});
