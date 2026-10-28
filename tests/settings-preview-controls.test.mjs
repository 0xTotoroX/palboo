/* [INPUT]: Shared model view, settings material preview, built CSS and synthetic snapshots.
 * [OUTPUT]: Local model selection/presets, material follow-through and tonal control checks.
 * [POS]: Isolated browser fixture; no product service or real settings.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { chromium } from 'playwright';

test('settings previews show actionable models and visible materials without service writes', async () => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'jsx',
        contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{LayoutPreview}from'./ui/settings/layout-preview';
import{ModelPreview}from'./ui/settings/model-preview';
import{SettingsPreview}from'./ui/settings/settings-preview';
import{NativeSelect}from'./ui/settings/components/ui/native-select';
import{FeatureSwitch}from'./ui/settings/settings-controls';
const features={mainPlacement:'sidebar',features:[{id:'outline',open:true,placement:'sidebar'}],layouts:{}};
window.requests=[];window.fetch=(...args)=>{window.requests.push(args);throw Error('No service calls in previews')};
function App(){const[model,setModel]=useState(null);const[surfaces,setSurfaces]=useState({preferences:{themes:Object.fromEntries(['sidebar','overlay','desktop','edge'].map(id=>[id,{theme:'matte'}])),edge:{edge:'right',position:.5}}});
return <div className="settings-app"><LayoutPreview appearance features={features} surfaces={surfaces} live/>
<button onClick={()=>setSurfaces(s=>({...s,preferences:{...s.preferences,themes:{...s.preferences.themes,desktop:{theme:'frosted'}}}}))}>更改桌面磨砂</button>
<button onClick={()=>setSurfaces(s=>({...s,preferences:{...s.preferences,themes:{...s.preferences.themes,desktop:{theme:'native-glass',liquidVariant:'regular'}}}}))}>更改桌面液态</button>
<button onClick={()=>setSurfaces(s=>({...s,preferences:{...s.preferences,themes:{...s.preferences.themes,desktop:{theme:'native-glass',liquidVariant:'clear'}}}}))}>更改桌面Clear</button>
<button onClick={()=>setSurfaces(s=>({...s,preferences:{...s.preferences,themes:{...s.preferences.themes,edge:{theme:'black'}}}}))}>更改贴边纯黑</button>
<div className="preview-demo"><ModelPreview model={model}/></div>
<button onClick={()=>setModel({preferences:{pinned:[],showUsage:true},snapshot:{models:[],usage:[{minutes:300,remainingPercent:83,resetsAt:null},{minutes:10080,remainingPercent:41,resetsAt:null}]}})}>读取额度</button>
<button onClick={()=>setModel(s=>({...s,preferences:{...s.preferences,showUsage:!s.preferences.showUsage}}))}>切换额度</button>
<button onClick={()=>setModel(s=>({...s,snapshot:{...s.snapshot,usage:[{minutes:10080,remainingPercent:38,resetsAt:null}]}}))}>更新额度</button>
<button onClick={()=>setModel(s=>({...s,snapshot:{...s.snapshot,usage:null}}))}>清空额度</button>
<SettingsPreview page="board" form={null} tasks={{store:{boardEnabled:true}}} live/>
<SettingsPreview page="bots" form={{grokbotEnabled:true}} live/>
<SettingsPreview page="next" form={{maxItems:2}} live/>
<FeatureSwitch name="大纲" checked disabled onChange={()=>{}}/>
<label htmlFor="choice">示例选择</label><NativeSelect id="choice" defaultValue="a"><option value="a">选项 A</option><option value="b">选项 B</option></NativeSelect>
<div className="settings-choice"><button aria-pressed="true">已选</button><button aria-pressed="false">未选</button></div>
</div>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
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
  const html = await readFile('target/web/index.html', 'utf8');
  let css = '';
  for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
    css += await readFile(`target/web${href}`, 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 904, height: 1041 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const fixture = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script>${script.replace(/<\/script/gi, '<\\/script')}</script>`;
    // Match the product's secure localhost context, including crypto.randomUUID for presets.
    await page.route('http://127.0.0.1:49390/', (route) =>
      route.fulfill({ contentType: 'text/html', body: fixture }),
    );
    await page.goto('http://127.0.0.1:49390/');
    const material = page.locator('[data-preview-workspace]');
    await material.waitFor();
    const readMaterial = () =>
      material.evaluate((n) => {
        const s = getComputedStyle(n);
        return {
          color: s.backgroundColor,
          blur: s.backdropFilter,
          shadow: s.boxShadow,
          rect: n.getBoundingClientRect().toJSON(),
        };
      });
    const matte = await readMaterial();
    assert.ok(
      matte.rect.width >= 400 && matte.rect.height >= 200,
      'material sample is readable at normal scale',
    );
    assert.equal(matte.blur, 'none');
    await page.getByRole('button', { name: '更改桌面磨砂', exact: true }).click();
    await page.locator('[data-demo-placement="desktop"]').waitFor();
    const frosted = await readMaterial();
    assert.match(frosted.blur, /blur\(18px\)/);
    assert.notEqual(frosted.color, matte.color);
    await page.getByRole('button', { name: '更改桌面液态', exact: true }).click();
    const regular = await readMaterial();
    assert.notEqual(regular.blur, frosted.blur);
    assert.notEqual(regular.shadow, frosted.shadow);
    await page.getByRole('button', { name: '更改桌面Clear', exact: true }).click();
    assert.notEqual((await readMaterial()).color, regular.color);
    await page.getByRole('button', { name: '更改贴边纯黑', exact: true }).click();
    await page.locator('[data-demo-placement="edge"]').waitFor();
    assert.equal((await readMaterial()).color, 'rgb(0, 0, 0)');
    assert.equal(
      await page.getByRole('tab', { name: '大纲', exact: true }).count(),
      1,
      'empty placement still has a material sample',
    );
    await page.getByRole('button', { name: '重置预览', exact: true }).click();
    await page.locator('[data-demo-placement="sidebar"]').waitFor();
    assert.equal((await readMaterial()).color, matte.color);
    const preview = page.getByRole('group', { name: '模型切换预览' });
    assert.equal(await preview.locator('.model-usage').textContent(), '周 —5小时 —');
    const measurePreview = () =>
      preview.evaluate((node) => {
        const rect = (selector) => node.querySelector(selector).getBoundingClientRect();
        return {
          height: node.getBoundingClientRect().height,
          gap: rect('.model-status-row').top - rect('.model-favorites').bottom,
          bottom: node.getBoundingClientRect().bottom - rect('.model-status-row').bottom,
        };
      });
    const compact = await measurePreview();
    assert.ok(compact.height < 220, `two-model preview fits content: ${compact.height}`);
    assert.ok(compact.gap <= 16, `no blank presets spacer: ${compact.gap}`);
    assert.ok(compact.bottom <= 4, `no fixed-height bottom space: ${compact.bottom}`);
    const choice = preview.getByRole('button', { name: '示例模型 B · High', exact: true });
    await choice.click();
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    assert.equal(
      await preview
        .getByRole('button', { name: '示例模型 A · Low', exact: true })
        .getAttribute('aria-pressed'),
      'false',
    );
    await preview.getByRole('button', { name: '添加预设', exact: true }).click();
    await preview.getByRole('button', { name: '示例模型 B', exact: true }).waitFor();
    await page.getByRole('button', { name: '读取额度', exact: true }).click();
    assert.equal(await preview.locator('.model-usage').textContent(), '周 41%5小时 83%');
    await page.getByRole('button', { name: '切换额度', exact: true }).click();
    assert.equal(await preview.locator('.model-usage').count(), 0);
    await page.getByRole('button', { name: '切换额度', exact: true }).click();
    await page.getByRole('button', { name: '更新额度', exact: true }).click();
    assert.equal(await preview.locator('.model-usage').textContent(), '周 38%');
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    assert.equal(await preview.getByRole('button', { name: '示例模型 B', exact: true }).count(), 1);
    await page.getByRole('button', { name: '清空额度', exact: true }).click();
    assert.equal(await preview.locator('.model-usage').textContent(), '周 —5小时 —');
    assert.equal(await page.locator('.settings-row label').textContent(), '大纲');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => (document.documentElement.dataset.settingsTheme = t), theme);
      const colors = await page.locator('#choice').evaluate((n) => ({
        background: getComputedStyle(n).backgroundColor,
        selected: getComputedStyle(document.querySelector('.settings-choice [aria-pressed="true"]'))
          .backgroundColor,
        unselected: getComputedStyle(
          document.querySelector('.settings-choice [aria-pressed="false"]'),
        ).backgroundColor,
      }));
      assert.notEqual(colors.background, 'rgb(255, 255, 255)');
      assert.equal(colors.background, colors.unselected);
      assert.notEqual(colors.selected, colors.unselected);
      for (const width of [360, 550, 904, 1360]) {
        await page.setViewportSize({ width, height: 1041 });
        const modelWidth = await preview.evaluate((e) => ({
          client: e.clientWidth,
          scroll: e.scrollWidth,
        }));
        assert.ok(
          modelWidth.scroll <= modelWidth.client + 1,
          `${width}px model controls fit the preview`,
        );
        if (width === 360) {
          const tabs = page.locator('[data-settings-feature=board] .stage-tabs');
          await tabs.getByRole('button', { name: '进行中' }).click();
          const visible = page.locator('[data-settings-feature=board] .board-column:visible');
          assert.equal(await visible.count(), 1);
          assert.equal(
            await tabs.getByRole('button', { name: '进行中' }).getAttribute('aria-pressed'),
            'true',
          );
          assert.match(await visible.textContent(), /完成首页布局/);
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${theme} ${width} no page overflow`,
        );
      }
    }
    const bots = page.locator('[data-preview-kind=bots] [data-settings-feature=bots]');
    assert.equal(await bots.locator('.palboo-bot').count(), 3);
    assert.equal(await bots.locator('.palboo-bot-toolbar').count(), 0);
    const history = bots.getByRole('button', { name: '最近消息', exact: true });
    assert.equal((await history.textContent()).trim(), '');
    await history.click();
    await bots.locator('.palboo-bot-message').first().waitFor();
    await bots.getByRole('button', { name: '返回 Bot 列表', exact: true }).click();
    const reviewer = bots.getByRole('group', { name: '代码审查', exact: true });
    await reviewer.hover();
    await reviewer.getByRole('button', { name: '填入停止请求' }).click();
    assert.equal(await reviewer.getByRole('button', { name: '追问', exact: true }).count(), 1);
    const next = page.locator('[data-preview-kind=next] [data-settings-feature=next]');
    assert.equal(await next.locator('.csw-row').count(), 2);
    await next.locator('.csw-row').first().click();
    await page.locator('[data-preview-kind=next] .preview-draft').waitFor();
    assert.deepEqual(await page.evaluate(() => window.requests), []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
