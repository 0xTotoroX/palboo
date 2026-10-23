/* [INPUT]: Shared model view, settings material preview, built CSS and synthetic snapshots.
 * [OUTPUT]: Local model selection/presets, material follow-through and tonal control checks.
 * [POS]: Isolated browser fixture; no product service or real settings.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
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
import{NativeSelect}from'./ui/settings/components/ui/native-select';
import{FeatureSwitch}from'./ui/settings/settings-controls';
const features={mainPlacement:'sidebar',features:[{id:'outline',open:true,placement:'sidebar'}],layouts:{}};
window.requests=[];window.fetch=(...args)=>{window.requests.push(args);throw Error('No service calls in previews')};
function App(){const[surfaces,setSurfaces]=useState({preferences:{themes:Object.fromEntries(['sidebar','overlay','desktop','edge'].map(id=>[id,{theme:'matte'}])),edge:{edge:'right',position:.5}}});
return <div className="settings-app"><LayoutPreview appearance features={features} surfaces={surfaces} live/>
<button onClick={()=>setSurfaces(s=>({...s,preferences:{...s.preferences,themes:{...s.preferences.themes,desktop:{theme:'frosted'}}}}))}>更改桌面磨砂</button>
<button onClick={()=>setSurfaces(s=>({...s,preferences:{...s.preferences,themes:{...s.preferences.themes,desktop:{theme:'native-glass',liquidVariant:'regular'}}}}))}>更改桌面液态</button>
<button onClick={()=>setSurfaces(s=>({...s,preferences:{...s.preferences,themes:{...s.preferences.themes,desktop:{theme:'native-glass',liquidVariant:'clear'}}}}))}>更改桌面Clear</button>
<button onClick={()=>setSurfaces(s=>({...s,preferences:{...s.preferences,themes:{...s.preferences.themes,edge:{theme:'black'}}}}))}>更改贴边纯黑</button>
<div className="preview-demo"><ModelPreview model={null}/></div>
<FeatureSwitch name="大纲" checked disabled onChange={()=>{}}/>
<label htmlFor="choice">示例选择</label><NativeSelect id="choice" defaultValue="a"><option value="a">选项 A</option><option value="b">选项 B</option></NativeSelect>
<div className="settings-choice"><button aria-pressed="true">已选</button><button aria-pressed="false">未选</button></div>
</div>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
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
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${theme} ${width} no page overflow`,
        );
      }
    }
    assert.deepEqual(await page.evaluate(() => window.requests), []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
