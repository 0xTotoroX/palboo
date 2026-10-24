/* [INPUT]: Actual selects, suggestion input, field layout and compiled settings CSS.
 * [OUTPUT]: Stable width tiers, matching menus, large-type wrapping and unchanged native events.
 * [POS]: Isolated browser fixture; never reads or writes user preferences.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test(
  'settings selects fit their content category and match their menus across themes and text sizes',
  { timeout: 60000 },
  async () => {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'jsx',
        contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Field,Toggle} from './ui/settings/settings-controls';import {NativeSelect} from './ui/settings/components/ui/native-select';import {Input} from './ui/settings/components/ui/input';import {SuggestionInput} from './ui/settings/components/ui/suggestion-input';
window.changes=[];window.requests=[];window.fetch=(...args)=>{window.requests.push(args);throw Error('unexpected request')};
function App(){const [material,setMaterial]=useState('black');const [model,setModel]=useState('');return <div className="settings-app"><main className="settings-content"><div className="settings-form-column">
<Field label="背景材质" id="material"><NativeSelect id="material" controlWidth="short" value={material} onChange={e=>{setMaterial(e.target.value);window.changes.push(e.target.value)}}><option value="matte">哑光</option><option value="frosted">磨砂</option><option value="glass">液态</option><option value="black">纯黑</option><option value="custom">自定义</option></NativeSelect></Field>
<Field label="方向来源" id="direction"><NativeSelect id="direction" controlWidth="short" defaultValue="smart"><option value="auto">自动探索</option><option value="smart">智能挑选（实验）</option></NativeSelect></Field>
<Field label="执行方式" id="mode"><NativeSelect id="mode" controlWidth="medium" defaultValue="hybrid"><option value="fill">仅填入</option><option value="hybrid">单击填入 · 双击发送</option></NativeSelect></Field>
<Field label="显示器" id="screen"><NativeSelect id="screen" defaultValue="display"><option value="auto">自动选择</option><option value="display">外接显示器 · Studio Display (2560 × 1440)</option></NativeSelect></Field>
<Field label="服务地址" id="address"><Input id="address" defaultValue="https://example.test/v1"/></Field>
<Field label="模型" id="model"><SuggestionInput id="model" value={model} onValueChange={setModel} options={['GPT example with a long model name','Claude example']}/></Field>
<Field label="液态外观" id="theme"><div className="settings-control-pair"><NativeSelect id="theme" controlWidth="short"><option>液态</option><option>磨砂</option></NativeSelect><NativeSelect id="variant" aria-label="液态变体" controlWidth="compact"><option>Regular</option><option>Clear</option></NativeSelect></div></Field>
<Toggle label="保持展开" checked={false} onChange={()=>{}}/>
</div></main></div>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
    });
    const html = await readFile('target/web/index.html', 'utf8');
    let css = '';
    for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
      css += await readFile(`target/web${href}`, 'utf8');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setContent('<div id="root"></div>');
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      for (const width of [360, 390, 641, 740, 1360])
        for (const base of [16, 17.6, 20, 32])
          for (const theme of ['light', 'dark']) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(
              ({ base, theme }) => {
                document.documentElement.style.fontSize = base + 'px';
                document.documentElement.style.setProperty('--buddy-type-size', base + 'px');
                document.documentElement.dataset.settingsTheme = theme;
              },
              { base, theme },
            );
            const geometry = await page.evaluate(() => {
              const rect = (s) => {
                const r = document.querySelector(s).getBoundingClientRect();
                return { right: r.right, top: r.top, width: r.width, height: r.height };
              };
              return {
                short: rect('#material'),
                medium: rect('#mode'),
                full: rect('#screen'),
                input: rect('#address'),
                toggle: rect('[role=switch]'),
                material: rect('#theme'),
                variant: rect('#variant'),
                overflow: document.documentElement.scrollWidth > innerWidth,
                clipped: [...document.querySelectorAll('select')]
                  .filter((e) => e.scrollHeight > e.clientHeight + 2)
                  .map((e) => e.id),
              };
            });
            assert.equal(geometry.overflow, false, `${width}/${base}/${theme}`);
            assert.deepEqual(geometry.clipped, [], JSON.stringify(geometry));
            for (const name of ['short', 'medium', 'full', 'input'])
              assert.ok(
                Math.abs(geometry[name].right - geometry.toggle.right) < 1,
                JSON.stringify(geometry),
              );
            if (width === 1360 && base < 32) {
              assert.ok(geometry.short.width < geometry.medium.width);
              assert.ok(geometry.medium.width < geometry.full.width);
            }
            assert.equal(geometry.input.width, geometry.full.width);
            assert.ok(geometry.variant.width < geometry.short.width, JSON.stringify(geometry));
            assert.ok(
              Math.abs(geometry.variant.right - geometry.toggle.right) < 1,
              JSON.stringify(geometry),
            );
            if ((width <= 390 && base <= 17.6) || (width === 390 && base === 20))
              assert.ok(
                Math.abs(geometry.material.top - geometry.variant.top) < 1,
                'compact liquid controls fit on one row: ' + JSON.stringify(geometry),
              );
            for (const id of ['material', 'mode', 'screen', 'variant']) {
              const select = page.locator('#' + id);
              await select.click();
              await page.waitForFunction((id) => document.getElementById(id).matches(':open'), id);
              const menu = await select.evaluate((e) => {
                const s = getComputedStyle(e, '::picker(select)');
                const o = e.querySelector('option').getBoundingClientRect();
                const r = e.getBoundingClientRect();
                return {
                  width: parseFloat(s.width),
                  control: r.width,
                  color: s.backgroundColor,
                  optionLeft: o.left,
                  optionRight: o.right,
                  controlLeft: r.left,
                  controlRight: r.right,
                };
              });
              assert.ok(
                Math.abs(menu.width - menu.control) < 1,
                JSON.stringify({ width, base, id, menu }),
              );
              assert.ok(
                menu.optionLeft >= menu.controlLeft && menu.optionRight <= menu.controlRight + 1,
                JSON.stringify(menu),
              );
              assert.equal(
                menu.color,
                theme === 'light' ? 'rgb(244, 244, 246)' : 'rgb(33, 33, 36)',
              );
              await page.keyboard.press('Escape');
              assert.equal(await select.evaluate((e) => document.activeElement === e), true);
            }
          }
      const before = await page
        .locator('#material')
        .evaluate((e) => e.getBoundingClientRect().width);
      await page.locator('#material').selectOption('custom');
      assert.equal(await page.locator('#material').inputValue(), 'custom');
      assert.deepEqual(await page.evaluate(() => window.changes), ['custom']);
      assert.equal(
        await page.locator('#material').evaluate((e) => e.getBoundingClientRect().width),
        before,
      );
      await page.locator('#model').fill('GPT');
      const suggestions = page.getByRole('listbox');
      await suggestions.waitFor();
      const match = await suggestions.evaluate((e) => {
        const r = e.getBoundingClientRect(),
          input = document.querySelector('#model').getBoundingClientRect();
        return { color: getComputedStyle(e).backgroundColor, width: r.width, input: input.width };
      });
      assert.equal(match.color, 'rgb(33, 33, 36)');
      assert.ok(Math.abs(match.width - match.input) < 1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#model').inputValue(), 'GPT');
      assert.deepEqual(await page.evaluate(() => window.requests), []);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
