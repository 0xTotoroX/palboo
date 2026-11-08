/* [INPUT]: Actual connection/site editors, settings save queue and revisioned synthetic APIs.
 * [OUTPUT]: Independent connection actions and retained website drafts cannot overwrite other edits.
 * [POS]: Isolated Chromium only; no real settings, hosts, folders or websites are accessed.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

async function bundle(contents) {
  return (
    await build({
      stdin: { contents, loader: 'tsx', resolveDir: process.cwd() },
      bundle: true,
      write: false,
      jsx: 'automatic',
      loader: { '.css': 'empty' },
      plugins: [
        {
          name: 'inline-css',
          setup(builder) {
            builder.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
              path: resolve(dirname(args.importer), args.path.split('?')[0]),
              namespace: 'inline-css',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'inline-css' }, (args) => ({
              contents: readFileSync(args.path, 'utf8'),
              loader: 'text',
            }));
          },
        },
      ],
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
    })
  ).outputFiles[0].text;
}

async function openBrowser(t) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PALBOO_CHROME_BIN || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  return page;
}

test('connection edits and reconnect do not save a retained model draft', async (t) => {
  const script = await bundle(`
    import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ConnectionSettings} from './ui/settings/connection-settings';
    import {SettingsForm} from './ui/settings/settings-controls';
    import {useSettingsForm} from './ui/settings/use-settings-form';
    function App(){
      const [page,setPage]=useState('model');
      const editor=useSettingsForm(false,undefined,({configurationRevision,generationRevision,...v})=>v,()=>{});
      useEffect(()=>{editor.load(${JSON.stringify(fixtureSettings)})},[]);window.editor=editor;
      return <><nav data-settings-navigation><button onClick={()=>setPage('connection')}>连接页面</button><button onClick={()=>setPage('model')}>模型页面</button></nav>
        <SettingsForm editor={editor} notify={()=>{}} active>
          <div hidden={page!=='model'}><input aria-label="模型草稿" value={editor.form?.model||''} onChange={e=>editor.change('model',e.target.value)}/></div>
          <div hidden={page!=='connection'}><ConnectionSettings editor={editor} live notify={()=>{}}
            view={{connection:{status:'connected',endpoint:'http://127.0.0.1:9229',targetId:'first',targets:[{id:'first',title:'窗口一'},{id:'second',title:'窗口二'}]}}}/></div>
        </SettingsForm></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `);
  const page = await openBrowser(t);
  let settings = structuredClone(fixtureSettings);
  const writes = [];
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    if (path.startsWith('/api/')) {
      if (body) writes.push({ path, body });
      if (path === '/api/settings') {
        if (body) {
          const { expectedRevision, apiKey, clearApiKey, jevApiKey, clearJevApiKey, ...patch } =
            body;
          assert.equal(expectedRevision, settings.configurationRevision);
          settings = { ...settings, ...patch, configurationRevision: expectedRevision + 1 };
        }
        return route.fulfill({ json: settings });
      }
      if (path === '/api/app-mode')
        return route.fulfill({
          json: { mode: 'release', preferredMode: 'release', revision: 1, releaseAvailable: true },
        });
      if (path === '/api/app-update')
        return route.fulfill({
          json: { currentVersion: '1.5.0', canInstall: false, checked: false },
        });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('https://settings-review.test');
  await page.clock.install();
  await page.addScriptTag({ content: script });
  await page.getByRole('textbox', { name: '模型草稿' }).fill('unsaved-synthetic-model');
  await page.getByRole('button', { name: '连接页面', exact: true }).click();
  await page.clock.runFor(250);
  assert.deepEqual(writes, [], 'navigation retains the unsaved model');
  await page.locator('#cdp-endpoint').fill('http://127.0.0.1:9333');
  await page.locator('#cdp-endpoint').press('Enter');
  await page.clock.runFor(250);
  assert.deepEqual(writes, [], 'connection Enter cannot submit the model form');
  await Promise.all([
    page.waitForResponse('**/api/connect'),
    page.getByRole('button', { name: '重新连接', exact: true }).click(),
  ]);
  await page.clock.runFor(250);
  assert.deepEqual(
    writes.map(({ path }) => path),
    ['/api/connect'],
  );
  assert.equal(writes[0].body.endpoint, 'http://127.0.0.1:9333');
  await page.locator('#target').selectOption('second');
  await page.locator('#target').blur();
  await page.clock.runFor(250);
  assert.equal(writes.length, 1, 'select change and blur stay outside model autosave');
  assert.equal(await page.evaluate(() => window.editor.dirty), true);
  await page.getByRole('button', { name: '模型页面', exact: true }).click();
  assert.equal(
    await page.getByRole('textbox', { name: '模型草稿' }).inputValue(),
    'unsaved-synthetic-model',
  );
  await page.getByRole('textbox', { name: '模型草稿' }).fill('explicit-model-edit');
  await page.getByRole('textbox', { name: '模型草稿' }).blur();
  await page.clock.runFor(250);
  await page.waitForFunction(() => window.editor.dirty === false);
  assert.equal(settings.model, 'explicit-model-edit', 'normal model blur still saves');
  assert.deepEqual(
    writes.map(({ path }) => path),
    ['/api/connect', '/api/settings'],
  );
});

async function websites(t) {
  const script = await bundle(`
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {WebLibrarySettings} from './ui/settings/web-library-settings';
    function App(){const [active,setActive]=useState(true);window.setActive=setActive;
      return <WebLibrarySettings live active={active} enablementTarget={null} onSnapshot={s=>{window.snapshot=s}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `);
  const page = await openBrowser(t);
  const service = {
    state: {
      revision: 1,
      enabled: true,
      vault: null,
      attachments: [],
      folders: [],
      sites: [{ id: 'site-a', name: '初始名称', url: 'https://old.example.invalid/' }],
    },
    writes: [],
    fail: false,
  };
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/web-library') {
      const body = route.request().postDataJSON();
      if (body) {
        service.writes.push(body);
        if (service.fail)
          return route.fulfill({ status: 500, json: { ok: false, message: '合成保存失败' } });
        if (body.expectedRevision !== service.state.revision)
          return route.fulfill({
            status: 409,
            json: { ok: false, message: '阅读与网页设置已在其他窗口更新，请刷新后重试' },
          });
        const { expectedRevision, ...patch } = body;
        service.state = { ...service.state, ...patch, revision: expectedRevision + 1 };
      }
      return route.fulfill({ json: service.state });
    }
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('https://sites-review.test');
  await page.addScriptTag({ content: script });
  await page.getByRole('button', { name: '编辑初始名称', exact: true }).waitFor();
  return { page, service };
}

async function readAgain(page, revision) {
  await page.evaluate(() => window.setActive(false));
  await page.locator('#settings-sites').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.setActive(true));
  await page.waitForFunction((revision) => window.snapshot?.revision === revision, revision);
}

test('website drafts keep their revision across navigation and can reload after a conflict', async (t) => {
  const { page, service } = await websites(t);
  await page.getByRole('button', { name: '编辑初始名称', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑网站', exact: true });
  await page.locator('#website-name').fill('本页改名草稿');
  await editor.press('Escape');
  service.state = {
    ...service.state,
    revision: 2,
    sites: [{ ...service.state.sites[0], url: 'https://other-window.example.invalid/' }],
  };
  await readAgain(page, 2);
  await page.getByRole('button', { name: '编辑网站', exact: true }).click();
  assert.equal(await page.locator('#website-name').inputValue(), '本页改名草稿');
  assert.equal(await page.locator('#website-url').inputValue(), 'https://old.example.invalid/');
  assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await editor.getByRole('alert').waitFor();
  assert.equal(service.state.sites[0].url, 'https://other-window.example.invalid/');
  assert.deepEqual(service.writes, [], 'a known stale draft cannot submit');
  assert.equal(await page.locator('#website-name').inputValue(), '本页改名草稿');
  await editor.getByRole('button', { name: '重新载入设置', exact: true }).click();
  assert.equal(await page.locator('#website-name').inputValue(), '初始名称');
  assert.equal(
    await page.locator('#website-url').inputValue(),
    'https://other-window.example.invalid/',
  );
  await page.locator('#website-name').fill('核对后改名');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => window.snapshot?.revision === 3);
  assert.equal(service.state.sites[0].name, '核对后改名');
  assert.equal(service.state.sites[0].url, 'https://other-window.example.invalid/');
});

test('unseen website conflict and save failure preserve drafts, retry and cancel remain usable', async (t) => {
  const { page, service } = await websites(t);
  await page.getByRole('button', { name: '编辑初始名称', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '编辑网站', exact: true });
  service.fail = true;
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.getByRole('alert').waitFor();
  await page.locator('#website-name').fill('失败后保留');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.getByRole('alert').waitFor();
  assert.equal(await page.locator('#website-name').inputValue(), '失败后保留');
  service.fail = false;
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => window.snapshot?.revision === 2);
  await page.getByRole('button', { name: '编辑失败后保留', exact: true }).click();
  await page.locator('#website-name').fill('被删除网站的旧草稿');
  service.state = { ...service.state, revision: 3, sites: [] };
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => window.snapshot?.revision === 3);
  assert.equal(service.writes.at(-1).expectedRevision, 2);
  assert.deepEqual(service.state.sites, []);
  assert.equal(await page.locator('#website-name').inputValue(), '被删除网站的旧草稿');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '添加网站', exact: true }).click();
  editor = page.getByRole('dialog', { name: '添加网站', exact: true });
  assert.equal(await page.locator('#website-name').inputValue(), '');
  await page.locator('#website-name').fill('新的独立网站');
  await page.locator('#website-url').fill('https://new.example.invalid/');
  await editor.getByRole('button', { name: '添加网站', exact: true }).click();
  await page.waitForFunction(() => window.snapshot?.revision === 4);
  assert.equal(service.state.sites.length, 1);
  assert.equal(service.state.sites[0].name, '新的独立网站');
});

test('website editors refresh clean fields and require confirmation before discarding another draft', async (t) => {
  const { page, service } = await websites(t);
  await page.getByRole('button', { name: '编辑初始名称', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑网站', exact: true }).press('Escape');
  service.state = {
    ...service.state,
    revision: 2,
    sites: [
      { ...service.state.sites[0], url: 'https://current.example.invalid/' },
      { id: 'site-b', name: '另一个网站', url: 'https://second.example.invalid/' },
    ],
  };
  await readAgain(page, 2);
  await page.getByRole('button', { name: '编辑网站', exact: true }).click();
  assert.equal(await page.locator('#website-url').inputValue(), 'https://current.example.invalid/');
  await page.locator('#website-name').fill('切换前保留');
  await page.getByRole('dialog', { name: '编辑网站', exact: true }).press('Escape');
  await page.getByRole('button', { name: '编辑另一个网站', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '编辑网站', exact: true }).click();
  assert.equal(await page.locator('#website-name').inputValue(), '切换前保留');
  await page.getByRole('dialog', { name: '编辑网站', exact: true }).press('Escape');
  await page.getByRole('button', { name: '编辑另一个网站', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑网站', exact: true }).waitFor();
  assert.equal(await page.locator('#website-name').inputValue(), '另一个网站');
  assert.equal(await page.locator('#website-url').inputValue(), 'https://second.example.invalid/');
  assert.deepEqual(service.writes, []);
});

test('unrelated library changes preserve a website draft and reopening the same item retains edits', async (t) => {
  const { page, service } = await websites(t);
  await page.getByRole('button', { name: '编辑初始名称', exact: true }).click();
  await page.locator('#website-name').fill('保留的草稿');
  await page.getByRole('dialog', { name: '编辑网站', exact: true }).press('Escape');
  service.state = { ...service.state, revision: 2, enabled: false };
  await readAgain(page, 2);
  await page.getByRole('button', { name: '编辑初始名称', exact: true }).click();
  assert.equal(await page.locator('#website-name').inputValue(), '保留的草稿');
  await page
    .getByRole('dialog', { name: '编辑网站', exact: true })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await page.waitForFunction(() => window.snapshot?.revision === 3);
  assert.equal(service.state.enabled, false);
  assert.equal(service.state.sites[0].name, '保留的草稿');
  assert.equal(service.writes[0].expectedRevision, 2);
});
