/* [INPUT]: Real SitesView and synthetic saved folders/websites.
 * [OUTPUT]: Independent folder launch IDs, search and errors in the existing feature surface.
 * [POS]: Isolated browser; never opens a real website or reader.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const compiled = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: process.cwd(),
    contents: `
import {createRoot} from 'react-dom/client';import {SitesView} from './ui/features/sites/view';import {setLocale} from './ui/shared/i18n';setLocale('zh-CN');
window.opened=[];window.fail=false;window.state={enabled:true,configured:true,folders:[{id:'notes',name:'Notes'},{id:'projects',name:'Projects'}],sites:[{id:'example',name:'Example',url:'https://example.invalid'}]};
const root=createRoot(document.querySelector('#root'));window.render=()=>root.render(<SitesView state={window.state} open={async id=>{if(window.fail)throw Error('Synthetic error');window.opened.push(id)}}/>);window.render();`,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
});
test('existing website surface exposes each folder independently and retains search/error behavior', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 260, height: 450 } });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.opened), ['folder:notes', 'folder:projects']);
    assert.equal(await page.getByRole('searchbox').count(), 0);
    await page.evaluate(() => (window.fail = true));
    await page.getByRole('button', { name: 'Example', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.evaluate(() => {
      window.fail = false;
      window.state.sites = Array.from({ length: 8 }, (_, i) => ({
        id: 'site' + i,
        name: 'Site ' + i,
        url: 'https://example.invalid',
      }));
      window.render();
    });
    await page.getByRole('searchbox').fill('Projects');
    assert.equal(await page.locator('li').count(), 1);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.opened), [
      'folder:notes',
      'folder:projects',
      'folder:projects',
    ]);
  } finally {
    await browser.close();
  }
});
