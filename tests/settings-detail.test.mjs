/* [INPUT]: Real detail page, navigation, search and form blur handling in synthetic Chromium.
 * [OUTPUT]: Draft/DOM/scroll retention, no navigation saves, nested confirmation and direct links.
 * [POS]: Isolated browser; no user configuration or credentials.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { emulateMedia } from './browser-motion.mjs';
const script = (
  await build({
    stdin: {
      loader: 'jsx',
      resolveDir: process.cwd(),
      contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{SettingsDetail}from'./ui/settings/settings-detail';
import{SettingsForm}from'./ui/settings/settings-controls';
import{useSettingsPage}from'./ui/settings/settings-outline';
import{SettingsSearch}from'./ui/settings/settings-search';
import{ConfirmationButton}from'./ui/settings/settings-confirmation';
function App(){const{page,navigate}=useSettingsPage(true);const[draft,setDraft]=useState('原始内容');window.counts??={blur:0,submit:0,delete:0};
const editor={dirty:false,saving:false,remoteChanged:false,form:{},schedule:()=>window.counts.blur++,save:()=>{window.counts.submit++;return Promise.resolve(null)}};
return <div className="settings-app"><SettingsSearch navigate={navigate}/><button data-settings-navigation onClick={()=>navigate('features','#settings-features')}>功能</button><button data-settings-navigation onClick={()=>navigate('model','#settings-model')}>系统</button><main className="settings-content"><SettingsForm editor={editor} notify={()=>{}} active><section data-settings-page="model" hidden={page!=='model'}><SettingsDetail id="settings-limits" title="高级设置"><label htmlFor="timeout">超时草稿</label><input id="timeout" required value={draft} onChange={e=>setDraft(e.target.value)}/><button type="button">普通操作</button><ConfirmationButton title="删除测试内容？" confirmLabel="确认删除" description="合成测试" onConfirm={async()=>{window.counts.delete++;return true}}>删除测试</ConfirmationButton><div style={{height:1200}}>滚动测试区域</div></SettingsDetail></section><section data-settings-page="features" hidden={page!=='features'}><SettingsDetail id="library" title="词库管理"><label htmlFor="term">术语草稿</label><input id="term" defaultValue="词条"/></SettingsDetail></section><button type="submit">提交测试</button></SettingsForm></main></div>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
).outputFiles[0].text;
const css = await readFile('ui/settings/settings-controls.css', 'utf8');
async function fixture(hash = 'settings-model') {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
  page.setDefaultTimeout(4000);
  await page.route('http://details.test/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  );
  await page.goto('http://details.test/#' + hash);
  await page.addStyleTag({
    content:
      css +
      '\n:root{--buddy-page:#fafafa;--buddy-text:#27272a;--buddy-subtle:#f1f1f2;--settings-ease:ease}body{margin:0}.settings-detail{box-sizing:border-box}',
  });
  await page.addScriptTag({ content: script });
  return { browser, page };
}
test('detail navigation keeps one native form, drafts, history, focus and reading position', async () => {
  const { browser, page } = await fixture();
  try {
    const open = page.getByRole('button', { name: '高级设置', exact: true });
    const back = page.getByRole('button', { name: '返回设置', exact: true });
    const detail = page.getByRole('region', { name: '高级设置', exact: true });
    const input = page.locator('#timeout');
    const counts = () => page.evaluate(() => window.counts);
    await open.click();
    await detail.waitFor();
    assert.equal(new URL(page.url()).hash, '#settings-model/settings-limits');
    assert.equal(await open.isVisible(), false);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await input.fill('未完成的输入');
    await input.evaluate((n) => {
      window.originalInput = n;
      window.originalForm = n.form;
    });
    await page.goBack();
    await detail.waitFor({ state: 'hidden' });
    assert.equal(await open.evaluate((n) => document.activeElement === n), true);
    await page.goForward();
    await detail.waitFor();
    assert.equal(await input.inputValue(), '未完成的输入');
    assert.equal(
      await input.evaluate((n) => n === window.originalInput && n.form === window.originalForm),
      true,
    );
    assert.equal((await counts()).blur, 0);
    await input.focus();
    await page.getByRole('button', { name: '普通操作' }).click();
    assert.equal((await counts()).blur, 1, 'ordinary blur still saves');
    await page.getByRole('button', { name: '删除测试', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await detail.isVisible(), true, 'Esc closes only the nested confirmation');
    assert.equal((await counts()).delete, 0);
    await page.evaluate(() => window.scrollTo(0, 350));
    await page.evaluate(() => document.querySelector('[data-settings-detail-back]').click());
    await open.click();
    await detail.waitFor();
    assert.equal(await page.evaluate(() => window.scrollY), 350);
    await back.click();
    await page.getByRole('button', { name: '功能', exact: true }).click();
    await page.getByRole('button', { name: '词库管理', exact: true }).click();
    await page.getByLabel('术语草稿').fill('未保存词条');
    await page.getByRole('button', { name: '系统', exact: true }).click();
    await open.click();
    await detail.waitFor();
    assert.equal(await input.inputValue(), '未完成的输入');
    assert.equal(await page.locator('[data-settings-detail-open]').count(), 1);
    await page.setViewportSize({ width: 360, height: 800 });
    await emulateMedia(page, { reducedMotion: 'reduce' });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(await detail.evaluate((n) => n.getAnimations().length), 0);
  } finally {
    await browser.close();
  }
});
test('Escape can return as soon as the detail heading receives focus', async () => {
  const { browser, page } = await fixture();
  try {
    const open = page.getByRole('button', { name: '高级设置', exact: true });
    const detail = page.getByRole('region', { name: '高级设置', exact: true });
    await page.evaluate(() => {
      function escapeAtFirstFocus(event) {
        const heading = event.target;
        if (!heading.matches?.('#settings-limits-detail [data-settings-detail-heading]')) return;
        document.removeEventListener('focusin', escapeAtFirstFocus);
        window.earlyEscapeHandled = !heading.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      }
      document.addEventListener('focusin', escapeAtFirstFocus);
    });
    await open.evaluate((button) => button.click());
    await page.waitForFunction(() => typeof window.earlyEscapeHandled === 'boolean');
    assert.equal(await page.evaluate(() => window.earlyEscapeHandled), true);
    await detail.waitFor({ state: 'hidden' });
    assert.equal(await open.evaluate((node) => node === document.activeElement), true);
    assert.equal(new URL(page.url()).hash, '#settings-model');
  } finally {
    await browser.close();
  }
});
test('initial links and search open the right detail page and retain its fields', async () => {
  const { browser, page } = await fixture('settings-model/timeout');
  try {
    await page.getByRole('region', { name: '高级设置', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'timeout');
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    const search = page.getByRole('searchbox', { name: '搜索设置' });
    await page.getByRole('button', { name: '搜索设置', exact: true }).click();
    await search.fill('术语草稿');
    await search.press('Enter');
    await page.getByRole('region', { name: '词库管理', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'term');
    await page.getByLabel('术语草稿').fill('保留词条');
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    await page.getByRole('button', { name: '搜索设置', exact: true }).click();
    await search.fill('超时草稿');
    await search.press('Enter');
    await page.getByRole('region', { name: '高级设置', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'timeout');
    assert.equal(await page.evaluate(() => window.counts.submit), 0);
  } finally {
    await browser.close();
  }
});

test('manual submit reveals invalid hidden detail fields without discarding their draft', async () => {
  const { browser, page } = await fixture();
  try {
    await page.getByRole('button', { name: '高级设置', exact: true }).click();
    await page.getByLabel('超时草稿').fill('');
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    await page.getByRole('button', { name: '功能', exact: true }).click();
    await page.getByRole('button', { name: '提交测试', exact: true }).click();
    await page.getByRole('region', { name: '高级设置', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '#settings-model/timeout');
    assert.equal(await page.getByLabel('超时草稿').inputValue(), '');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'timeout');
    assert.equal(await page.evaluate(() => window.counts.submit), 0);
    await page.getByLabel('超时草稿').fill('有效草稿');
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    await page.getByRole('button', { name: '提交测试', exact: true }).click();
    assert.equal(await page.evaluate(() => window.counts.submit), 1);
  } finally {
    await browser.close();
  }
});
