/* [INPUT]: Real direction controls/save queue, built CSS and an isolated synthetic settings API.
 * [OUTPUT]: Selection/library separation, categorized search, keyboard/focus, save counts and viewport bounds.
 * [POS]: Browser regression only; never reads or changes live preferences.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

test(
  'direction picker selects existing entries without editing the library or saving navigation',
  { timeout: 45000 },
  async () => {
    const script = (
      await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'jsx',
          contents: `
import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';
import{DirectionSettings}from'./ui/settings/direction-settings';
import{SettingsForm}from'./ui/settings/settings-controls';import{Input}from'./ui/settings/components/ui/input';
import{useSettingsForm}from'./ui/settings/use-settings-form';
function App(){const e=useSettingsForm(false,undefined,({configurationRevision,generationRevision,...v})=>v,()=>{});
useEffect(()=>{e.load(window.fixture);window.reloadFixture=()=>e.load(window.fixture)},[]);
return <div className="settings-app" style={{maxWidth:720,margin:'20px auto',padding:16}}>
<SettingsForm editor={e} notify={()=>{}} active>
<Input aria-label="保留草稿" value={e.form?.model||''} onChange={event=>e.change('model',event.target.value)}/>
{e.form&&<DirectionSettings editor={e}/>}<button type="button" data-settings-navigation>其他操作</button>
</SettingsForm></div>};createRoot(document.getElementById('root')).render(<App/>);`,
        },
        bundle: true,
        write: false,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
      })
    ).outputFiles[0].text;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 904, height: 900 },
        reducedMotion: 'reduce',
      });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const extra = Array.from({ length: 9 }, (_, index) => ({
        id: `builtin-${index}`,
        name: `内置方向 ${index}`,
        instruction: `测试说明 ${index}`,
        enabled: true,
      }));
      const custom = {
        id: 'custom-one',
        name: '我的检查清单',
        instruction: '检查可交付内容',
        enabled: true,
      };
      let settings = {
        ...structuredClone(fixtureSettings),
        directionSource: 'manual',
        builtInDirections: [...fixtureSettings.builtInDirections, ...extra],
        directionLibrary: [...fixtureSettings.directionLibrary, ...extra, custom],
        selectedDirections: ['advance', 'gaps'],
      };
      const originalLibrary = structuredClone(settings.directionLibrary);
      const writes = [];
      await page.route('https://directions.test/**', async (route) => {
        if (new URL(route.request().url()).pathname === '/api/settings') {
          const body = route.request().postDataJSON();
          if (body) {
            writes.push(body);
            const { expectedRevision, apiKey, clearApiKey, jevApiKey, clearJevApiKey, ...patch } =
              body;
            assert.equal(expectedRevision, settings.configurationRevision);
            settings = {
              ...settings,
              ...patch,
              configurationRevision: settings.configurationRevision + 1,
            };
          }
          return route.fulfill({ json: settings });
        }
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      });
      await page.goto('https://directions.test/');
      const html = await readFile('target/web/index.html', 'utf8');
      for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
        await page.addStyleTag({ content: await readFile(`target/web${href}`, 'utf8') });
      await page.evaluate((value) => (window.fixture = value), settings);
      await page.addScriptTag({ content: script });
      const trigger = page.getByRole('button', { name: '选择方向', exact: true });
      const popup = page.getByRole('dialog', { name: '选择方向', exact: true });
      const search = popup.getByRole('combobox', { name: '搜索方向' });
      const selected = page.getByRole('group', { name: '已选方向' });
      const options = popup.getByRole('option');
      const save = async (action) => {
        const response = page.waitForResponse(
          (r) => r.url().endsWith('/api/settings') && r.request().method() === 'POST',
        );
        await action();
        await response;
        await page
          .locator('.settings-save[data-save-state="saved"]')
          .waitFor({ state: 'attached' });
      };
      await page.getByRole('textbox', { name: '保留草稿' }).fill('尚未保存的模型');
      await trigger.click();
      assert.equal(
        await popup
          .getByRole('button', { name: '我的方向', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(await search.evaluate((node) => node === document.activeElement), true);
      assert.deepEqual(await options.allTextContents(), [custom.name]);
      await popup.getByRole('button', { name: '内置方向', exact: true }).click();
      assert.equal(await options.count(), 10);
      assert.equal(await popup.getByRole('option', { name: '整体推进', exact: true }).count(), 0);
      const list = popup.getByRole('listbox');
      assert.equal(
        await list.evaluate(
          (node) => node.scrollHeight > node.clientHeight && node.clientHeight <= 210,
        ),
        true,
      );
      await search.fill(' 检查 ');
      assert.deepEqual(
        await options.allTextContents(),
        [custom.name],
        'search includes custom entries while builtin category was active',
      );
      await search.fill('理解');
      assert.deepEqual(await options.allTextContents(), ['理解解释']);
      await search.fill('不存在的方向');
      await search.press('Enter');
      assert.equal(await popup.getByRole('status').innerText(), '没有匹配的方向');
      await search.press('Escape');
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      await trigger.click();
      await page.getByRole('heading', { name: '建议生成', exact: true }).click();
      await popup.waitFor({ state: 'hidden' });
      await trigger.click();
      await search.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await popup.waitFor({ state: 'hidden' });
      assert.equal(
        await page
          .getByRole('button', { name: '其他操作' })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await page.waitForTimeout(300);
      assert.equal(writes.length, 0, 'search/category/dismissal do not save an unrelated draft');
      assert.equal(
        await page.getByRole('textbox', { name: '保留草稿' }).inputValue(),
        '尚未保存的模型',
      );
      await page.evaluate(() => window.reloadFixture());

      await trigger.press('ArrowDown');
      await search.press('ArrowDown');
      await save(() => search.press('Enter'));
      assert.equal(writes.length, 1);
      assert.deepEqual(settings.selectedDirections, ['advance', 'gaps', 'custom-one']);
      assert.deepEqual(settings.directionLibrary, originalLibrary);
      await popup.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      await trigger.click();
      assert.equal(
        await popup
          .getByRole('button', { name: '内置方向', exact: true })
          .getAttribute('aria-pressed'),
        'true',
        'fall back to builtins when all custom entries are selected',
      );
      await search.fill('解释');
      await save(() => popup.getByRole('option', { name: '理解解释', exact: true }).click());
      assert.equal(writes.length, 2, 'click selects and saves once without a second confirmation');
      assert.deepEqual(settings.selectedDirections, [
        'advance',
        'gaps',
        'custom-one',
        'understand',
      ]);
      await save(() =>
        selected.getByRole('button', { name: '移除方向位置 3', exact: true }).click(),
      );
      assert.deepEqual(
        settings.directionLibrary,
        originalLibrary,
        'removing a selected slot never deletes its library entry',
      );
      await trigger.click();
      assert.deepEqual(await options.allTextContents(), [custom.name]);
      await search.press('Escape');
      const rows = selected.locator('.direction-slot');
      assert.equal(await selected.getByRole('button', { name: /[上下]移方向/ }).count(), 0);
      assert.deepEqual(
        await rows.evaluateAll((nodes) =>
          nodes.map((node) => node.querySelectorAll('button').length),
        ),
        [1, 1, 1],
      );
      const dragWrites = writes.length;
      await rows.first().dragTo(page.getByRole('heading', { name: '建议生成', exact: true }));
      await page.waitForTimeout(250);
      assert.equal(writes.length, dragWrites, 'dropping outside the list does not save');
      assert.equal(await selected.locator('[data-dragging="true"], [data-drop-edge]').count(), 0);
      await rows.first().dragTo(rows.nth(1), { targetPosition: { x: 40, y: 2 } });
      await page.waitForTimeout(250);
      assert.equal(writes.length, dragWrites, 'dropping back in the same position is a no-op');
      await save(() => rows.first().dragTo(rows.nth(1), { targetPosition: { x: 40, y: 36 } }));
      assert.equal(writes.length, dragWrites + 1, 'drag commits only once on drop');
      assert.deepEqual(settings.selectedDirections, ['gaps', 'advance', 'understand']);
      await save(() => rows.last().dragTo(rows.first(), { targetPosition: { x: 40, y: 2 } }));
      assert.deepEqual(settings.selectedDirections, ['understand', 'gaps', 'advance']);
      await save(() => rows.first().press('Alt+ArrowDown'));
      assert.deepEqual(settings.selectedDirections, ['gaps', 'understand', 'advance']);
      assert.equal(await rows.nth(1).evaluate((node) => node === document.activeElement), true);
      assert.deepEqual(settings.directionLibrary, originalLibrary);

      await page.setViewportSize({ width: 360, height: 520 });
      await trigger.click();
      await popup.getByRole('button', { name: '内置方向', exact: true }).click();
      const bounds = await popup.boundingBox();
      assert.ok(
        bounds.x >= 0 &&
          bounds.x + bounds.width <= 360 &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= 520,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(await popup.getAttribute('data-above'), 'true');
      await search.press('ArrowUp');
      assert.equal(
        await list.evaluate((node) => node.scrollTop > 0),
        true,
        'keyboard navigation scrolls the local list only',
      );
      assert.equal(await popup.isVisible(), true);
      if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
        await page.screenshot({ path: 'target/reports/stepwise-picker-mobile.png' });
      await search.press('Escape');
      const finalWrites = writes.length;
      await page.waitForTimeout(300);
      assert.equal(writes.length, finalWrites);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
