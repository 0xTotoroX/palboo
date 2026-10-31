/* [INPUT]: Actual connection page, built CSS and synthetic appearance API.
 * [OUTPUT]: Startup choice persistence, isolated saves, conflicts, offline/capability gates and narrow bilingual layout.
 * [POS]: Browser regression without changing real preferences or opening native windows.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';

test('startup choices save independently and only affect the next launch', async (t) => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ConnectionSettings} from './ui/settings/connection-settings';
import {setLocale} from './ui/shared/i18n.js';import {fixtureSettings} from './tests/fixtures.mjs';
window.locale=setLocale;window.outerChanges=0;
function App(){
 const [appearance,push]=React.useState({revision:1,webRevision:1,detached:false,ui:{open:true,dockOpen:true}});
 const [live,connect]=React.useState(true);const [capable,capability]=React.useState(true);
 Object.assign(window,{push,connect,capability});
 return <div className="settings-app"><main className="settings-content"><form className="settings-form-column" onChange={()=>window.outerChanges++}>
 <input aria-label="模型草稿" defaultValue="尚未保存的配置"/>
 <ConnectionSettings live={live} view={{connection:{status:'connected',targets:[]},panelPreferences:appearance}} notify={()=>{}} editor={{form:fixtureSettings,saved:{...fixtureSettings,popoutSupported:capable},dirty:true,saving:false,remoteChanged:false,change:()=>{}}}/>
 </form></main></div>;
}createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      define: { 'import.meta.env.DEV': 'false' },
    })
  ).outputFiles[0].text;
  let saved = { revision: 1, webRevision: 1, detached: false, ui: { open: true, dockOpen: true } };
  let fail = false;
  const writes = [],
    errors = [];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 760, height: 850 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://startup.test/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/appearance') {
      if (req.method() === 'POST') {
        const patch = req.postDataJSON();
        writes.push(patch);
        if (fail || patch.expectedRevision !== saved.revision)
          return route.fulfill({ status: 409, json: { message: '外观已在其他窗口更新，请重试' } });
        saved = { ...saved, startup: patch.startup, revision: saved.revision + 1 };
      }
      return route.fulfill({ json: saved });
    }
    if (path === '/api/app-mode')
      return route.fulfill({ json: { mode: 'release', preferredMode: 'release', revision: 1 } });
    if (path === '/api/app-update')
      return route.fulfill({
        json: { currentVersion: '1.3.0', checked: false, canInstall: false },
      });
    assert.ok(!path.startsWith('/api/'), 'no window movement or model settings request');
    return route.fulfill({
      contentType: 'text/html',
      body: '<meta name="viewport" content="width=device-width"><div id="root"></div>',
    });
  });
  await page.goto('https://startup.test/#token=synthetic');
  const html = await readFile('target/web/index.html', 'utf8');
  for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
    await page.addStyleTag({ content: await readFile(`target/web${href}`, 'utf8') });
  await page.addScriptTag({ content: script });
  const mode = page.locator('#startup-mode'),
    location = page.locator('#startup-location');
  assert.equal(await mode.inputValue(), 'restore');
  assert.equal(await location.count(), 0);
  await mode.selectOption('open');
  await location.waitFor();
  assert.equal(await location.inputValue(), 'inside');
  await location.selectOption('outside');
  await page.waitForFunction(
    () =>
      document.querySelector('#startup-location').value === 'outside' &&
      !document.querySelector('#startup-mode').disabled,
  );
  assert.deepEqual(saved.startup, { mode: 'open', location: 'outside' });
  assert.deepEqual(saved.ui, { open: true, dockOpen: true });
  assert.equal(saved.detached, false);
  assert.deepEqual(Object.keys(writes.at(-1)).sort(), ['expectedRevision', 'startup']);
  assert.equal(await page.evaluate(() => outerChanges), 0);
  assert.equal(await page.getByLabel('模型草稿').inputValue(), '尚未保存的配置');
  await mode.selectOption('closed');
  await location.waitFor({ state: 'detached' });
  await mode.selectOption('open');
  await location.waitFor();
  assert.equal(await location.inputValue(), 'outside');
  fail = true;
  await location.selectOption('inside');
  await page.getByText('外观已在其他窗口更新，请重试', { exact: true }).waitFor();
  assert.equal(await location.inputValue(), 'outside');
  fail = false;
  saved = { ...saved, revision: saved.revision + 1, startup: { mode: 'open', location: 'inside' } };
  await page.evaluate((value) => push(value), saved);
  await page.evaluate(() => capability(false));
  assert.equal(await location.locator('option[value=outside]').isDisabled(), true);
  saved = {
    ...saved,
    revision: saved.revision + 1,
    startup: { mode: 'closed', location: 'outside' },
  };
  await page.evaluate((value) => push(value), saved);
  await location.waitFor({ state: 'detached' });
  await mode.selectOption('open');
  await location.waitFor();
  assert.equal(
    await location.inputValue(),
    'inside',
    'enabling on an unsupported system chooses the available location',
  );
  await page.evaluate(() => connect(false));
  assert.equal(await mode.isDisabled(), true);
  await page.evaluate(() => connect(true));
  await page.locator('#startup-mode:enabled').waitFor();
  for (const lang of ['zh-CN', 'en']) {
    await page.evaluate((lang) => locale(lang), lang);
    await page.setViewportSize({ width: 320, height: 850 });
    await mode.scrollIntoViewIfNeeded();
    for (const field of [mode, location]) {
      const box = await field.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 320, `${lang} control fits narrow page`);
    }
    await mode.focus();
    await page.keyboard.press('Tab');
    assert.equal(await location.evaluate((node) => node === document.activeElement), true);
  }
  await mkdir('target/reports/startup-visibility', { recursive: true });
  await page
    .locator('#settings-startup')
    .screenshot({ path: 'target/reports/startup-visibility/english.png' });
  assert.deepEqual(errors, []);
});
