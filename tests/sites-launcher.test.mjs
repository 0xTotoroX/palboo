/* [INPUT]: Real rail launcher and SitesView in an isolated synthetic browser.
 * [OUTPUT]: Compact alignment, navigation, search, keyboard, failures and cleanup checks.
 * [POS]: No real host, notes, websites or native dialogs are touched.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const compiled = await build({
  stdin: {
    contents: `import {createSitesLauncher} from './ui/surfaces/embedded/sites-launcher';
      import {setLocale} from './ui/shared/i18n'; setLocale('zh-CN');
      window.locale=setLocale; window.opened=[]; window.fail=false;
      window.state={enabled:true,configured:true,sites:[{id:'a',name:'Cubox',url:'https://example.invalid'},{id:'b',name:'幕布',url:'https://example.invalid'}]};
      window.options={enabled:true,theme:'dark',request:async(id)=>{if(window.fail)throw Error('Synthetic failure');if(id)window.opened.push(id);else return window.state;},settings:()=>window.settingsOpened=true};
      const host=document.querySelector('#host');const shadow=host.attachShadow({mode:'open'});
      shadow.innerHTML='<style>button{display:flex;justify-content:center;text-align:center;width:36px;height:28px;color:inherit;border:0;background:transparent;}button:hover{background:#8882;}#eyes{margin-top:260px}</style><button id="eyes">Eyes</button>';
      window.launcher=createSitesLauncher(shadow.querySelector('#eyes'),()=>window.options);`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
});
test('rail website launcher is compact, aligned and preserves navigation and cleanup', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 420, height: 460 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.setContent(
      '<div id="host" style="width:52px;height:460px;overflow:hidden;background:#222;color:#eee"></div><button id="outside">Outside</button>',
    );
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    const entry = page.getByRole('button', { name: '阅读与网站', exact: true });
    await entry.click();
    const dialog = page.getByRole('dialog', { name: '阅读与网站' });
    await dialog.getByRole('button', { name: 'Cubox', exact: true }).waitFor();
    assert.equal(
      await dialog.getByRole('searchbox').count(),
      0,
      'few sites do not need a search field',
    );
    const rows = await dialog
      .locator('.sites-name')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().left));
    assert.ok(
      rows.every((x) => Math.abs(x - rows[0]) < 1),
      'all text starts on the same edge',
    );
    const box = await dialog.boundingBox();
    assert.ok(box.y >= 8 && box.y + box.height <= 452);
    await dialog.getByRole('button', { name: 'Cubox', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.opened), ['a']);
    await entry.press('Enter');
    await dialog.getByRole('button', { name: '幕布', exact: true }).waitFor();
    await dialog.getByRole('button', { name: '幕布', exact: true }).press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await entry.evaluate((el) => el.getRootNode().activeElement === el), true);
    await page.evaluate(() => {
      window.state.sites = Array.from({ length: 8 }, (_, i) => ({
        id: 'site' + i,
        name: 'Website ' + i,
        url: 'https://example.invalid',
      }));
    });
    await entry.click();
    await dialog.getByRole('searchbox').fill('Website 7');
    assert.equal(await dialog.locator('li').count(), 1);
    await page.locator('#outside').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.fail = true;
    });
    await entry.click();
    await dialog.getByRole('alert').waitFor();
    assert.match(await dialog.getByRole('alert').innerText(), /Synthetic failure/);
    await page.evaluate(() => {
      window.fail = false;
      window.state.configured = false;
    });
    await dialog.getByRole('button', { name: '重试', exact: true }).click();
    await dialog.getByRole('button', { name: '选择笔记文件夹', exact: true }).click();
    assert.equal(await page.evaluate(() => window.settingsOpened), true);
    await page.evaluate(() => {
      window.options.enabled = false;
      window.launcher.update();
    });
    assert.equal(await entry.isVisible(), false);
    await page.evaluate(() => {
      window.locale('en');
      window.options.enabled = true;
      window.launcher.update();
    });
    await page.getByRole('button', { name: 'Reading & websites', exact: true }).click();
    await page.getByRole('button', { name: 'Choose a notes folder', exact: true }).waitFor();
    await page.evaluate(() => window.launcher.destroy());
    assert.equal(await page.locator('.palboo-sites-launcher').count(), 0);
    assert.equal(await page.locator('.palboo-sites-popover').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
