/* [INPUT]: Current configuration fixtures and shared settings/feature components.
 * [OUTPUT]: Live preview linkage, board layouts and isolated preview edits across viewport sizes.
 * [POS]: Synthetic browser test; never connects to a user service or sends a Bot/model request.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { chromium } from 'playwright';

test('task read recovery clears connection errors but retains failed edits', async () => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'jsx',
        contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{useTasks}from'./ui/features/board/api';
let unavailable=true;
const request=async path=>{if(path==='tasks/command')throw Error('保留保存错误');if(unavailable)throw Error('临时断线');return {store:{revision:1,tasks:[]}}};
function App(){const state=useTasks(false,request);return <><output>{state.error}</output><button onClick={()=>{unavailable=false;void state.reload()}}>重连</button><button onClick={()=>state.command({op:'view',viewMode:'expanded'})}>失败保存</button></>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: script });
    await page.getByText('临时断线', { exact: true }).waitFor();
    await page.getByRole('button', { name: '重连', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output').textContent === '');
    await page.getByRole('button', { name: '失败保存', exact: true }).click();
    await page.getByText('保留保存错误', { exact: true }).waitFor();
    await page.getByRole('button', { name: '重连', exact: true }).click();
    assert.equal(await page.locator('output').textContent(), '保留保存错误');
  } finally {
    await browser.close();
  }
});

test(
  'current previews follow board, model and Bot configuration while edits remain local',
  { timeout: 60000 },
  async () => {
    const script = (
      await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'jsx',
          contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{SettingsPreview}from'./ui/settings/settings-preview';
import{TaskSettings}from'./ui/settings/task-settings';
import{createDemoTasks}from'./ui/shared/demo-state';
import{setLocale}from'./ui/shared/i18n.js';
const tasks=await createDemoTasks().request('tasks/state');tasks.store.columns=[{id:'todo',title:'准备发布'},{id:'doing',title:'开发验证'},{id:'done',title:'已交付'}];
const models=Array.from({length:5},(_,i)=>({id:'model-'+i,label:'当前模型 '+i,reasoning:['low','high'],fast:true}));
const initialModel={revision:3,snapshot:{target:{privateIdentity:'never pass through'},revision:'real-revision',status:'ready',message:'',models,current:{model:'model-2',reasoning:'high',speed:'fast'}},preferences:{enabled:true,showUsage:false,pinned:['model-2','model-0','model-4'],modelOrder:['model-4','model-2','model-0','model-1','model-3'],groups:[{id:'work',name:'工作模型'}],modelOverrides:{'model-2':{groupId:'work'}},presets:[{id:'preset-1',name:'日常检查',selection:{model:'model-2',reasoning:'high',speed:'fast'}}]}};
const initialBots={stale:false,sidebar:{version:1,groups:[{id:'pinned',kind:'pinned',name:'置顶',botIds:['b']},{id:'section',kind:'section',name:'我的助手',botIds:['a','hidden']}]},bots:[{id:'a',name:'当前审查助手',available:true,avatar:{shape:'circle',color:'green'}},{id:'b',name:'当前资料助手',available:true,avatar:{shape:'circle',color:'violet'}},{id:'hidden',name:'不显示的助手',available:true,hidden:true}]};
initialBots.bots[0].preview='本机已有的合成回复';
const initialFeatures={mainPlacement:'sidebar',features:['board','model','bots','terms','next','prompts'].map(id=>({id,open:true,placement:'sidebar'})),layouts:{sidebar:{axis:'auto',groups:[{ids:['board','model','bots','terms','next','prompts'],active:'board',weight:1}]}}};
window.network=[];window.commands=[];window.fetch=(...args)=>{window.network.push(args);throw Error('No real transport')};
function App(){const[page,setPage]=useState('board');const[state,setTasks]=useState(tasks);const[model,setModel]=useState(initialModel);const[bots,setBots]=useState(initialBots);const[features,setFeatures]=useState(initialFeatures);const[dark,setDark]=useState(false);
const command=async data=>{window.commands.push(data);setTasks(s=>({...s,store:{...s.store,revision:s.store.revision+1,viewMode:data.viewMode}}));return {}};
return <div className={'settings-app '+(dark?'dark':'')} style={{maxWidth:900,margin:'auto',padding:24}}>
<nav>{['board','model-control','bots','surfaces','appearance'].map(id=><button key={id} onClick={()=>setPage(id)}>{id}</button>)}<button onClick={()=>setDark(!dark)}>主题</button><button onClick={()=>setLocale('en')}>English</button></nav>
<SettingsPreview page={page} tasks={state} model={model} bots={bots} form={{maxItems:2,quickPrompts:[{label:'已保存',prompt:'已保存的指令'}],grokbotEnabled:true}} features={features} surfaces={{preferences:{themes:{},edge:{}}}} view={null} dirty={false} live/>
{page==='board'&&<TaskSettings tasks={{state,error:'',busy:false,command}}/>}
<button onClick={()=>{setTasks(s=>({...s,store:{...s.store,tasks:s.store.tasks.map((t,i)=>i? t:{...t,fields:{...t.fields,title:'已同步任务'}})}}));setModel(m=>({...m,preferences:{...m.preferences,pinned:['model-1'],presets:[]}}));setBots(b=>({...b,bots:b.bots.map(t=>t.id==='a'?{...t,name:'已同步助手'}:t)}));}}>同步配置</button>
<button onClick={()=>setTasks(s=>({...s,store:{...s.store,boardEnabled:!s.store.boardEnabled}}))}>启停测试</button><output data-task-count>{state.store.tasks.length}</output>
<button onClick={()=>{setFeatures({...initialFeatures,layouts:{sidebar:{axis:'vertical',groups:[{ids:['bots'],active:'bots',weight:1,collapsed:true},{ids:['board','model','terms','next','prompts'],active:'board',weight:1}]}}});setBots({stale:false,bots:Array.from({length:12},(_,i)=>({id:'long-'+i,name:'预览助手 '+i,available:true}))});}}>多分栏测试</button>
</div>};createRoot(document.getElementById('root')).render(<App/>);`,
        },
        bundle: true,
        format: 'esm',
        write: false,
        jsx: 'automatic',
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
        define: { 'process.env.NODE_ENV': '"production"' },
      })
    ).outputFiles[0].text;
    const index = await readFile('target/web/index.html', 'utf8');
    let css = '';
    for (const [, href] of index.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
      css += await readFile(`target/web${href}`, 'utf8');
    const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1080, height: 1000 },
        locale: 'zh-CN',
        reducedMotion: 'reduce',
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('http://127.0.0.1:49391/', (route) =>
        route.fulfill({ contentType: 'text/html', body: html }),
      );
      await page.goto('http://127.0.0.1:49391/');
      const preview = page.locator('.settings-preview');
      const board = preview.locator('[data-settings-feature=board]');
      await board.getByRole('button', { name: '准备发布', exact: true }).waitFor();
      assert.equal(await board.locator('.board-column').count(), 1);
      await page.getByLabel('看板视图', { exact: true }).selectOption('expanded');
      await board.locator('[data-view-mode=expanded]').waitFor();
      assert.equal(await board.locator('.board-column').count(), 3);
      await page.getByRole('button', { name: '启停测试', exact: true }).click();
      await board.getByText('任务看板已停用，请在设置页开启。', { exact: true }).waitFor();
      await page.getByRole('button', { name: '启停测试', exact: true }).click();
      await board.locator('.board-grid.stacked').waitFor();
      assert.deepEqual(await page.evaluate(() => window.commands), [
        { op: 'view', viewMode: 'expanded' },
      ]);
      await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
      await board.getByLabel('新任务标题', { exact: true }).fill('仅预览任务');
      await board.getByRole('button', { name: '添加', exact: true }).click();
      await board.getByText('仅预览任务', { exact: true }).waitFor();
      assert.equal(
        await page.locator('[data-task-count]').textContent(),
        '6',
        'preview does not change real task store',
      );
      await page.getByRole('button', { name: 'model-control', exact: true }).click();
      const model = preview.locator('.preview-model-control');
      await model.locator('.model-row').first().waitFor();
      assert.equal(await model.locator('.model-row').count(), 3, 'all pinned models, not only two');
      assert.equal(
        await model
          .locator('.model-preset-tag button.model-preset-choice')
          .getAttribute('aria-label'),
        '日常检查 · High · Fast',
      );
      assert.equal(
        await model
          .getByRole('button', { name: '当前模型 2 · High', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      await page.getByRole('button', { name: 'bots', exact: true }).click();
      const bots = preview.locator('[data-settings-feature=bots]');
      assert.deepEqual(await bots.locator('.palboo-bot-copy').allTextContents(), [
        '当前资料助手',
        '当前审查助手',
      ]);
      await bots.getByRole('button', { name: '当前审查助手', exact: true }).click();
      assert.match(
        await preview
          .locator('.preview-scene[data-active=true] .preview-composer textarea')
          .inputValue(),
        /当前审查助手/,
      );
      await bots.getByRole('button', { name: '当前审查助手', exact: true }).focus();
      await bots.getByRole('button', { name: '追问', exact: true }).click();
      assert.match(
        await preview
          .locator('.preview-scene[data-active=true] .preview-composer textarea')
          .inputValue(),
        /追问「当前审查助手」：$/,
      );
      await page.getByRole('button', { name: '同步配置', exact: true }).click();
      await bots.getByRole('button', { name: '已同步助手', exact: true }).waitFor();
      await page.getByRole('button', { name: 'model-control', exact: true }).click();
      assert.equal(await model.locator('.model-row').count(), 1);
      assert.equal(await model.locator('.model-preset-tag').count(), 0);
      await page.getByRole('button', { name: 'board', exact: true }).click();
      await board.getByText('已同步任务', { exact: true }).waitFor();
      assert.equal(await board.getByText('仅预览任务', { exact: true }).count(), 0);
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await board.locator('.board-column').count(), 3);
        for (const mode of ['merged', 'expanded']) {
          await page.getByLabel('看板视图', { exact: true }).selectOption(mode);
          await board.locator(`[data-view-mode=${mode}]`).waitFor();
          assert.equal(await board.locator('.board-column').count(), mode === 'merged' ? 1 : 3);
          if (mode === 'expanded') {
            await board.locator('.board-grid.stacked').waitFor();
            const columns = await board.locator('.board-column').evaluateAll((nodes) =>
              nodes.map((node) => {
                const { x, y, height } = node.getBoundingClientRect();
                return { x, y, height };
              }),
            );
            assert.ok(
              columns
                .slice(1)
                .every((column, index) => column.y >= columns[index].y + columns[index].height),
            );
            assert.ok(columns.every((column) => Math.abs(column.x - columns[0].x) < 1));
            await board.getByRole('button', { name: '新建任务', exact: true }).last().click();
            await board.getByLabel('新任务标题').press('Escape');
            assert.ok(
              await board.getByRole('button', { name: '搜索任务', exact: true }).isVisible(),
            );
          }
        }
        await page.getByRole('button', { name: '主题', exact: true }).click();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
      }
      await page.setViewportSize({ width: 1080, height: 1000 });
      await mkdir('target/reports/settings-live-previews', { recursive: true });
      await preview.screenshot({
        path: 'target/reports/settings-live-previews/board-preview.png',
      });
      await page.screenshot({
        path: 'target/reports/settings-live-previews/board.png',
        fullPage: true,
      });
      for (const section of ['surfaces', 'appearance']) {
        await page.getByRole('button', { name: section, exact: true }).click();
        const workspace = preview.locator('[data-preview-workspace]');
        await workspace.getByRole('tab', { name: '看板', exact: true }).click();
        await workspace.getByText('已同步任务', { exact: true }).waitFor();
        await workspace.getByRole('tab', { name: '模型切换', exact: true }).click();
        await workspace.locator('.model-row:visible').waitFor();
        assert.equal(
          await workspace.locator('.csw-feature-pane-head:visible').count(),
          1,
          'one shared header',
        );
        await workspace.getByRole('tab', { name: 'Grok Bot', exact: true }).click();
        await workspace.getByRole('button', { name: '已同步助手', exact: true }).waitFor();
        assert.equal(
          await workspace.locator('[data-settings-feature=bots] .csw-feature-pane-head').count(),
          0,
          'no nested header',
        );
      }
      await page.screenshot({
        path: 'target/reports/settings-live-previews/appearance.png',
        fullPage: true,
      });
      await preview.screenshot({
        path: 'target/reports/settings-live-previews/appearance-preview.png',
      });
      await page.getByRole('button', { name: '多分栏测试', exact: true }).click();
      const longBots = preview.locator('[data-settings-feature=bots]');
      const closedBotTab = preview.locator(
        '[role=tab][aria-label="Grok Bot"][aria-expanded=false]',
      );
      await closedBotTab.click();
      await longBots.getByRole('button', { name: '预览助手 11', exact: true }).waitFor();
      const bounds = await longBots.evaluate((host) => {
        const frame = host.closest('.layout-demo-content');
        const content = host.shadowRoot.querySelector('.feature-view');
        return {
          frame: frame.getBoundingClientRect().height,
          content: content.getBoundingClientRect().height,
          background: getComputedStyle(content).backgroundColor,
        };
      });
      assert.ok(
        Math.abs(bounds.content - bounds.frame) <= 1,
        `content stays inside its pane: ${JSON.stringify(bounds)}`,
      );
      assert.equal(bounds.background, 'rgba(0, 0, 0, 0)', 'workspace material stays visible');
      await longBots.getByRole('button', { name: '预览助手 11', exact: true }).click();
      assert.match(
        await preview.locator('.preview-composer textarea:visible').inputValue(),
        /预览助手 11/,
      );
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('button', { name: 'board', exact: true }).click();
      await page.getByLabel('Board view', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.network), []);
      assert.deepEqual(errors, []);
      await writeFile('target/reports/settings-live-previews/fixture.html', html);
    } finally {
      await browser.close();
    }
  },
);
