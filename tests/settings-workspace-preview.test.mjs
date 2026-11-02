/* [INPUT]: Shared settings previews, saved website snapshots and built styles.
 * [OUTPUT]: Website snapshot forwarding, useful extra panes and continuous device/draft checks.
 * [POS]: Synthetic browser fixture; preview interactions never write settings or navigate the host.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { chromium } from 'playwright';

test(
  'workspace previews share saved sites, preserve local drafts and fit their device',
  { timeout: 60000 },
  async () => {
    const script = (
      await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'jsx',
          contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{SettingsPreview}from'./ui/settings/settings-preview';
import{WebLibrarySettings}from'./ui/settings/web-library-settings';
import{setLocale}from'./ui/shared/i18n.js';
const features={mainPlacement:'sidebar',features:['outline','sites'].map(id=>({id,open:true,placement:'sidebar'})),layouts:{sidebar:{axis:'auto',groups:[{ids:['outline','sites'],active:'sites',weight:1}]}}};
const surfaces={preferences:{themes:{},edge:{}}};
window.requests=[];window.fetch=async(path,options)=>{window.requests.push({path,method:options.method});if(path!=='/api/web-library'||options.method!=='GET')throw Error('Unexpected preview write');return new Response(JSON.stringify({revision:1,enabled:true,vault:'/synthetic/vault',attachments:[],sites:[{id:'docs',name:'参考文档',url:'https://example.com/docs'},...Array.from({length:6},(_,i)=>({id:'site-'+i,name:'资料 '+i,url:'https://example.com/'+i}))]}),{headers:{'Content-Type':'application/json'}})};
function App(){const[sites,setSites]=useState(null);const[page,setPage]=useState('surfaces');const[dark,setDark]=useState(false);return <div className={'settings-app '+(dark?'dark':'')} style={{maxWidth:900,margin:'auto',padding:24}}>
<nav><button onClick={()=>setPage('surfaces')}>布局页</button><button onClick={()=>setPage('appearance')}>外观页</button><button onClick={()=>setDark(!dark)}>主题</button><button onClick={()=>setLocale('en')}>English</button></nav>
<SettingsPreview page={page} sites={sites} form={null} view={null} tasks={null} model={null} bots={null} features={features} surfaces={surfaces} dirty={false} live/>
<WebLibrarySettings live active={false} previewActive onSnapshot={setSites} enablementTarget={null}/>
</div>};createRoot(document.getElementById('root')).render(<App/>);`,
        },
        bundle: true,
        format: 'esm',
        write: false,
        jsx: 'automatic',
        plugins: [
          {
            name: 'styles',
            setup(b) {
              b.onResolve({ filter: /\.css\?inline$/ }, (a) => ({
                path: resolve(dirname(a.importer), a.path.split('?')[0]),
                namespace: 'inline-css',
              }));
              b.onLoad({ filter: /.*/, namespace: 'inline-css' }, (a) => ({
                contents: readFileSync(a.path, 'utf8'),
                loader: 'text',
              }));
              b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
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
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`;
    const dir = 'target/reports/site-settings-review';
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/workspace.html`, html);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1080, height: 1000 },
        reducedMotion: 'reduce',
        locale: 'zh-CN',
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('http://127.0.0.1:49392/', (route) =>
        route.fulfill({ contentType: 'text/html', body: html }),
      );
      await page.goto('http://127.0.0.1:49392/');
      const preview = page.locator('.settings-preview');
      const sites = preview.locator('[data-feature=sites]');
      await sites.getByRole('button', { name: '参考文档', exact: true }).waitFor();
      assert.equal(
        await sites.getByRole('button', { name: 'Obsidian', exact: true }).isEnabled(),
        true,
      );
      assert.equal(await preview.locator('.demo-host-rail').count(), 1);
      const geometry = await preview.locator('.layout-demo-scene').evaluate((n) => ({
        width: n.viewBox.baseVal.width,
        screen: n.querySelector('.demo-screen').getBoundingClientRect().width,
        scene: n.getBoundingClientRect().width,
      }));
      assert.equal(geometry.width, 736);
      // The 16:10 device is letterboxed inside the existing 16:9 preview frame.
      assert.ok(geometry.screen > geometry.scene * 0.7, 'single device uses the available preview');
      await sites.getByRole('button', { name: '参考文档', exact: true }).click();
      await sites.getByRole('searchbox').fill('参考');
      const chatDraft = preview.getByLabel('聊天输入框', { exact: true });
      await chatDraft.fill('保留预览草稿');
      await page.screenshot({ path: `${dir}/settings-layout.png` });
      await preview.getByRole('button', { name: '演示移到副屏', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('.layout-demo-window').x.baseVal.value === 754,
      );
      const radius = await preview.locator('[data-device-viewport]').evaluate((n) => ({
        screen: Number(n.dataset.screenRadius),
        content: parseFloat(getComputedStyle(n).borderRadius),
        overflow: getComputedStyle(n).overflow,
      }));
      assert.ok(radius.screen > 10);
      assert.ok(Math.abs(radius.content - radius.screen * 1.75) < 0.01);
      assert.equal(radius.overflow, 'hidden');
      assert.equal(await sites.getByRole('searchbox').inputValue(), '参考');
      assert.equal(await chatDraft.inputValue(), '保留预览草稿');
      await page.screenshot({ path: `${dir}/settings-tablet.png` });
      await preview.getByRole('button', { name: '演示侧栏', exact: true }).click();
      await preview.getByRole('button', { name: '＋ 添加示例功能', exact: true }).click();
      const note = preview.getByLabel('笔记示例草稿', { exact: true });
      await note.fill('临时笔记不能丢失');
      await preview.getByRole('button', { name: '标签', exact: true }).click();
      await preview.getByRole('tab', { name: '笔记', exact: true }).click();
      assert.equal(await note.inputValue(), '临时笔记不能丢失');
      await preview.getByRole('button', { name: '重置预览', exact: true }).click();
      await page.getByRole('button', { name: '外观页', exact: true }).click();
      await sites.getByRole('button', { name: '参考文档', exact: true }).waitFor();
      await sites.getByRole('button', { name: '参考文档', exact: true }).click();
      await page.getByRole('button', { name: '主题', exact: true }).click();
      await page.screenshot({ path: `${dir}/settings-appearance.png` });
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('button', { name: '布局页', exact: true }).click();
      for (const width of [390, 760, 1080]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
      }
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.screenshot({ path: `${dir}/settings-mobile.png` });
      assert.deepEqual(await page.evaluate(() => window.requests), [
        { path: '/api/web-library', method: 'GET' },
      ]);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
