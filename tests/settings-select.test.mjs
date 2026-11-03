/* [INPUT]: Actual selects, suggestion input, field layout and compiled settings CSS.
 * [OUTPUT]: Aligned controls/chevrons through downward/upward opening and closing, wrapping and native events.
 * [POS]: Isolated browser fixture; never reads or writes user preferences.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

async function assertCenteredArrow(select, state, selector = ':scope > .buddy-icon') {
  const geometry = await select.evaluate((element, selector) => {
    const control = element.getBoundingClientRect();
    const icon = element.parentElement.querySelector(selector).getBoundingClientRect();
    return {
      id: element.id,
      dy: icon.y + icon.height / 2 - control.y - control.height / 2,
      right: control.right - icon.right,
    };
  }, selector);
  assert.ok(Math.abs(geometry.dy) < 1, `${state}: ${JSON.stringify(geometry)}`);
  return geometry;
}

test(
  'settings selects share one aligned column and match their menus across themes and text sizes',
  { timeout: 120000 },
  async (t) => {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'jsx',
        contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Field,Toggle} from './ui/settings/settings-controls';import {NativeSelect} from './ui/settings/components/ui/native-select';import {Input} from './ui/settings/components/ui/input';import {SuggestionInput} from './ui/settings/components/ui/suggestion-input';import {Icon} from './ui/shared/icons/react';
window.changes=[];window.requests=[];window.fetch=(...args)=>{window.requests.push(args);throw Error('unexpected request')};
function App(){const [material,setMaterial]=useState('black');const [model,setModel]=useState('');return <div className="settings-app"><main className="settings-content"><div className="settings-form-column">
<Field label="背景材质" id="material"><NativeSelect id="material" controlWidth="short" value={material} onChange={e=>{setMaterial(e.target.value);window.changes.push(e.target.value)}}><option value="matte">哑光</option><option value="frosted">磨砂</option><option value="glass">液态</option><option value="black">纯黑</option><option value="custom">自定义</option></NativeSelect></Field>
<Field label="方向来源" id="direction"><NativeSelect id="direction" controlWidth="short" defaultValue="smart"><option value="auto">自动探索</option><option value="smart">智能挑选（实验）</option></NativeSelect></Field>
<Field label="执行方式" id="mode"><NativeSelect id="mode" controlWidth="medium" defaultValue="hybrid"><option value="fill">仅填入</option><option value="hybrid">单击填入 · 双击发送</option></NativeSelect></Field>
<Field label="显示器" id="screen"><NativeSelect id="screen" defaultValue="display"><option value="auto">自动选择</option><option value="display">外接显示器 · Studio Display (2560 × 1440)</option></NativeSelect></Field>
<Field label="服务地址" id="address"><Input id="address" defaultValue="https://example.test/v1"/></Field>
<Field label="模型" id="model"><SuggestionInput id="model" value={model} onValueChange={setModel} options={['GPT example with a long model name','Claude example']} dropdown={{label:'选择模型',onOpen:()=>{}}}/></Field>
<Field label="液态外观" id="theme"><div className="settings-control-pair"><NativeSelect id="theme" controlWidth="short"><option>液态</option><option>磨砂</option></NativeSelect><NativeSelect id="variant" aria-label="液态变体" controlWidth="compact"><option>Regular</option><option>Clear</option></NativeSelect></div></Field>
<Field label="带操作的材质" id="action"><NativeSelect id="action" action={<button type="button" className="settings-liquid-toggle" aria-label="Clear"><Icon name="star"/></button>}><option>液态</option><option>磨砂</option></NativeSelect></Field>
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
      const placements = { above: 0, below: 0 };
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
                arrows: [...document.querySelectorAll('.settings-native-select')].map((wrapper) => {
                  const select = wrapper.querySelector('select').getBoundingClientRect();
                  const icon = wrapper
                    .querySelector(':scope > .buddy-icon')
                    .getBoundingClientRect();
                  return Math.abs(select.y + select.height / 2 - icon.y - icon.height / 2);
                }),
              };
            });
            assert.equal(geometry.overflow, false, `${width}/${base}/${theme}`);
            assert.deepEqual(geometry.clipped, [], JSON.stringify(geometry));
            assert.ok(
              geometry.arrows.every((offset) => offset < 1),
              'select chevrons remain vertically centered: ' + JSON.stringify(geometry),
            );
            for (const name of ['short', 'medium', 'full', 'input'])
              assert.ok(
                Math.abs(geometry[name].right - geometry.toggle.right) < 1,
                JSON.stringify(geometry),
              );
            assert.equal(geometry.short.width, geometry.medium.width);
            assert.equal(geometry.medium.width, geometry.full.width);
            assert.ok(geometry.input.width >= geometry.full.width);
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
            for (const id of ['material', 'mode', 'screen', 'variant', 'action']) {
              const select = page.locator('#' + id);
              const closed = await assertCenteredArrow(select, `${width}/${base}/${theme}/closed`);
              await select.click();
              await page.waitForFunction((id) => document.getElementById(id).matches(':open'), id);
              const opened = await assertCenteredArrow(select, `${width}/${base}/${theme}/open`);
              assert.ok(
                Math.abs(opened.right - closed.right) < 1,
                'opening does not shift the arrow sideways',
              );
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
                  placement: o.top < r.top ? 'above' : 'below',
                };
              });
              placements[menu.placement]++;
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
              await page.waitForFunction((id) => !document.getElementById(id).matches(':open'), id);
              const dismissed = await assertCenteredArrow(
                select,
                `${width}/${base}/${theme}/closed again`,
              );
              assert.ok(
                Math.abs(dismissed.right - closed.right) < 1,
                'closing restores the same arrow center',
              );
              assert.equal(await select.evaluate((e) => e.matches(':open')), false);
              assert.equal(await select.evaluate((e) => document.activeElement === e), true);
            }
            t.diagnostic(`${width}/${base}/${theme}: centered before, during and after opening`);
          }
      assert.ok(placements.above > 0 && placements.below > 0, JSON.stringify(placements));
      console.log('Native picker placements:', placements);

      // Isolate both viewport edges so normal motion and reduced motion cover the same popup states.
      await page.setViewportSize({ width: 740, height: 600 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '16px';
        document.documentElement.style.setProperty('--buddy-type-size', '16px');
      });
      for (const reducedMotion of ['no-preference', 'reduce']) {
        await page.emulateMedia({ reducedMotion });
        for (const edge of ['top', 'bottom']) {
          await page.locator('#material').evaluate((element, edge) => {
            element.parentElement.style.cssText = `position:fixed;${edge}:24px;right:24px;width:260px;z-index:10`;
          }, edge);
          const select = page.locator('#material');
          for (let cycle = 0; cycle < 2; cycle++) {
            await assertCenteredArrow(select, `${reducedMotion}/${edge}/closed`);
            await select.press('Space');
            await page.waitForFunction(() => document.getElementById('material').matches(':open'));
            const above = await select.evaluate(
              (e) =>
                e.querySelector('option').getBoundingClientRect().top <
                e.getBoundingClientRect().top,
            );
            assert.equal(
              above,
              edge === 'bottom',
              `${reducedMotion}/${edge}: actual popup direction`,
            );
            await assertCenteredArrow(select, `${reducedMotion}/${edge}/opened`);
            await page.keyboard.press('Escape');
            await assertCenteredArrow(select, `${reducedMotion}/${edge}/dismissed`);
          }
        }
      }
      await page
        .locator('#material')
        .evaluate((element) => element.parentElement.removeAttribute('style'));
      // The model picker centers its button separately from the rotating child icon.
      await page.evaluate(() => {
        document.documentElement.dataset.settingsStyle = 'chatgpt';
      });
      const model = page.locator('#model');
      const modelArrow = '.settings-suggestion-trigger [data-icon="chevron-down"]';
      for (const reducedMotion of ['no-preference', 'reduce']) {
        await page.emulateMedia({ reducedMotion });
        for (const edge of ['top', 'bottom']) {
          await model.evaluate((element, edge) => {
            element.parentElement.style.cssText = `position:fixed;${edge}:24px;right:24px;width:260px;z-index:10`;
          }, edge);
          const closed = await assertCenteredArrow(
            model,
            `${reducedMotion}/${edge}/model closed`,
            modelArrow,
          );
          await page.getByRole('button', { name: '选择模型', exact: true }).click();
          await page.waitForFunction(
            () =>
              document
                .querySelector('.settings-suggestion-trigger')
                .getAttribute('aria-expanded') === 'true',
          );
          await page.waitForFunction(
            (above) => document.querySelector('[role="listbox"]').dataset.above === String(above),
            edge === 'bottom',
          );
          const opened = await assertCenteredArrow(
            model,
            `${reducedMotion}/${edge}/model open`,
            modelArrow,
          );
          assert.ok(Math.abs(opened.right - closed.right) < 1);
          await model.press('Escape');
          await assertCenteredArrow(model, `${reducedMotion}/${edge}/model dismissed`, modelArrow);
        }
      }
      await model.evaluate((element) => element.parentElement.removeAttribute('style'));
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
