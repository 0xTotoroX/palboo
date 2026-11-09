/* [INPUT]: Actual startup settings, built CSS and synthetic authenticated update responses.
 * [OUTPUT]: Explicit checks, install handoff, draft/concurrency protection and bilingual narrow layout.
 * [POS]: Browser regression; never downloads or replaces an App or contacts GitHub.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const script = build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ConnectionSettings} from './ui/settings/connection-settings';import {GeneralSettings} from './ui/settings/general-settings';import {setLocale} from './ui/shared/i18n.js';import {fixtureSettings} from './tests/fixtures.mjs';
    const view={connection:{status:'connected',message:'已连接桌面 Codex',endpoint:'http://127.0.0.1:9229',targetId:'fixture',targets:[]}};
    window.locale=setLocale;function App(){const[flags,change]=React.useState({dirty:false,saving:false,remoteChanged:false});const[live,setLive]=React.useState(true);window.connection=setLive;window.flags=change;return <div className="settings-app"><main className="settings-content"><div className="settings-form-column"><ConnectionSettings live={live} view={view} notify={()=>{}} editor={{...flags,form:fixtureSettings,saved:fixtureSettings,change:()=>{}}}/><GeneralSettings live={live} view={view} editor={{...flags,form:fixtureSettings,saved:fixtureSettings,change:()=>{}}}/></div></main></div>}createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  loader: { '.css': 'empty' },
  format: 'iife',
  define: { 'import.meta.env.DEV': 'false' },
}).then((result) => result.outputFiles[0].text);
const base = {
  currentVersion: '1.2.0',
  revision: 4,
  canInstall: true,
  reason: null,
  checked: false,
};
const release = {
  id: 11,
  version: '1.3.0',
  url: 'https://github.com/0xTotoroX/palboo/releases/tag/v1.3.0',
  asset: { id: 12 },
};
async function fixture(t, options = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(5000);
  const writes = [],
    reads = [],
    errors = [];
  const behavior = { check: { ...base, checked: true, hasUpdate: true, release }, ...options };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    assert.equal(
      url.origin,
      'https://update.test',
      'the browser must never fetch the release asset',
    );
    if (!url.pathname.startsWith('/api/'))
      return route.fulfill({
        contentType: 'text/html',
        body: '<meta name="viewport" content="width=device-width"><div id="root"></div>',
      });
    if (req.method() === 'POST') writes.push({ path: url.pathname, body: req.postDataJSON() });
    else reads.push(url.pathname);
    if (url.pathname === '/api/performance')
      return route.fulfill({
        json: {
          preferences: { integrationEnabled: true, monitoringEnabled: false, revision: 1 },
          connectionStatus: 'connected',
          sample: null,
        },
      });
    if (url.pathname === '/api/app-mode')
      return route.fulfill({
        json: {
          mode: 'release',
          preferredMode: 'release',
          revision: 4,
          source: null,
          node: null,
          releaseAvailable: true,
        },
      });
    if (url.pathname === '/api/app-update/check') {
      if (behavior.holdCheck) await behavior.holdCheck;
      return route.fulfill({
        status: behavior.checkError ? 502 : 200,
        json: behavior.checkError ? { ok: false, message: behavior.checkError } : behavior.check,
      });
    }
    assert.equal(url.pathname, '/api/app-update');
    if (req.method() === 'GET') {
      if (behavior.holdInitial) await behavior.holdInitial;
      return route.fulfill({ json: behavior.initial || base });
    }
    if (behavior.holdInstall) await behavior.holdInstall;
    return route.fulfill({
      status: behavior.installError ? 409 : 200,
      json: behavior.installError
        ? { ok: false, message: behavior.installError }
        : { url: 'https://update.test/progress' },
    });
  });
  await page.goto('https://update.test/#token=synthetic');
  const html = await readFile('target/web/index.html', 'utf8');
  for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
    await page.addStyleTag({ content: await readFile(`target/web${href}`, 'utf8') });
  await page.addScriptTag({ content: await script });
  const card = page.locator('#settings-app-update');
  await card.getByRole('button', { name: '检查更新', exact: true }).waitFor();
  t.after(() => assert.deepEqual(errors, []));
  return {
    page,
    card,
    writes,
    reads,
    behavior,
    check: () => card.getByRole('button', { name: '检查更新', exact: true }).click(),
  };
}

test('checks are explicit; stale initial reads and duplicate clicks cannot overwrite a checked release', async (t) => {
  let initial, check;
  const f = await fixture(t, {
    holdInitial: new Promise((r) => {
      initial = r;
    }),
    holdCheck: new Promise((r) => {
      check = r;
    }),
  });
  assert.deepEqual(f.writes, []);
  await f.card.getByRole('button', { name: '检查更新', exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });
  await f.card.getByRole('button', { name: '正在检查…', exact: true }).waitFor();
  assert.equal(f.writes.length, 1);
  check();
  await f.page
    .locator('#settings-feedback-center')
    .getByRole('status')
    .filter({ hasText: '发现新版本 v1.3.0' })
    .waitFor();
  initial();
  await f.page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/app-update') && response.request().method() === 'GET',
  );
  assert.match(
    await f.page.locator('#settings-feedback-center').getByRole('status').innerText(),
    /v1.3.0/,
  );
  assert.equal(f.writes.length, 1);
});

test('drafts and edited modes block installation; failures keep the release and retries send only identity', async (t) => {
  const f = await fixture(t, { installError: '运行模式已更改，请重新检查更新' });
  await f.check();
  const install = f.card.getByRole('button', { name: '更新并重启', exact: true });
  await install.waitFor();
  for (const flag of ['dirty', 'saving', 'remoteChanged']) {
    await f.page.evaluate(
      (flag) => window.flags({ dirty: false, saving: false, remoteChanged: false, [flag]: true }),
      flag,
    );
    await f.page
      .locator('#settings-feedback-center')
      .getByText('请先保存或还原当前设置，再更新。')
      .waitFor();
    assert.equal(await install.isDisabled(), true);
  }
  await f.page.evaluate(() => window.flags({ dirty: false, saving: false, remoteChanged: false }));
  await f.page.locator('#settings-app-mode > summary').click();
  await f.page.getByLabel('启动时使用', { exact: true }).selectOption('development');
  assert.equal(await install.isDisabled(), true);
  await f.page.getByLabel('启动时使用', { exact: true }).selectOption('release');
  await install.click();
  await f.page.locator('#settings-feedback-center').getByRole('alert').waitFor();
  assert.deepEqual(f.writes.at(-1).body, {
    releaseId: 11,
    assetId: 12,
    version: '1.3.0',
    currentVersion: '1.2.0',
    expectedRevision: 4,
  });
  assert.equal(await install.isEnabled(), true);
  f.behavior.installError = null;
  let complete;
  f.behavior.holdInstall = new Promise((r) => {
    complete = r;
  });
  await install.evaluate((button) => {
    button.click();
    button.click();
  });
  await f.card.getByRole('button', { name: '正在准备…', exact: true }).waitFor();
  assert.equal(f.writes.filter((v) => v.path === '/api/app-update').length, 2);
  complete();
  await f.page.waitForURL('**/progress');
});

test('source-only, development and read-only installations show accurate actions and recover from network failure', async (t) => {
  const f = await fixture(t, { checkError: 'GitHub 更新检查失败' });
  await f.check();
  await f.page.locator('#settings-feedback-center').getByRole('alert').waitFor();
  assert.equal(await f.card.getByRole('button', { name: '检查更新' }).isEnabled(), true);
  f.behavior.checkError = null;
  f.behavior.check = {
    ...base,
    checked: true,
    hasUpdate: true,
    release: { ...release, asset: null },
  };
  await f.check();
  await f.page
    .locator('#settings-feedback-center')
    .getByText(/此版本仅提供源码/)
    .waitFor();
  assert.equal(await f.card.getByRole('button', { name: '更新并重启' }).count(), 0);
  assert.equal(
    await f.card.getByRole('link', { name: '更新说明' }).getAttribute('href'),
    release.url,
  );
  for (const reason of [
    '请先切回正式模式，再更新已安装的 App。',
    'App 所在位置不可写，请先将完整 App 移到可写的应用程序目录。',
  ]) {
    f.behavior.check = {
      ...base,
      checked: true,
      hasUpdate: true,
      release,
      canInstall: false,
      reason,
    };
    await f.check();
    await f.page.locator('#settings-feedback-center').getByText(reason, { exact: true }).waitFor();
    assert.equal(await f.card.getByRole('button', { name: '更新并重启' }).isDisabled(), true);
  }
  f.behavior.check = { ...base, checked: true, hasUpdate: false, release };
  await f.check();
  await f.page.locator('#settings-feedback-center').getByText('当前无需更新。').waitFor();
  assert.equal(await f.card.getByRole('link').count(), 0);
});

test('startup updates fit a narrow layout in both languages with keyboard access', async (t) => {
  const f = await fixture(t);
  await f.check();
  await f.card.getByRole('button', { name: '更新并重启' }).waitFor();
  for (const language of ['zh-CN', 'en']) {
    await f.page.evaluate((language) => window.locale(language), language);
    const button = f.card.getByRole('button', {
      name: language === 'en' ? 'Update and restart' : '更新并重启',
      exact: true,
    });
    await button.waitFor();
    await f.page.setViewportSize({ width: 320, height: 700 });
    await button.focus();
    assert.equal(await button.evaluate((element) => element === document.activeElement), true);
    const geometry = await f.card.evaluate((card) => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
      left: card.getBoundingClientRect().left,
      right: card.getBoundingClientRect().right,
      labels: [...card.querySelectorAll('button,a')].map((e) => ({
        text: e.textContent,
        left: e.getBoundingClientRect().left,
        right: e.getBoundingClientRect().right,
      })),
    }));
    assert.ok(geometry.page <= geometry.viewport + 1, JSON.stringify(geometry));
    assert.ok(
      geometry.labels.every((v) => v.left >= 0 && v.right <= geometry.viewport + 1),
      JSON.stringify(geometry),
    );
    if (!(await f.page.locator('#settings-app-mode').evaluate((node) => node.open)))
      await f.page.locator('#settings-app-mode > summary').click();
    await f.page.locator('#app-mode').selectOption('development');
    await f.page
      .getByRole('button', {
        name: language === 'en' ? 'Development settings' : '开发设置',
        exact: true,
      })
      .press('Enter');
    const drawer = f.page.getByRole('dialog');
    await drawer.locator('#app-mode-source').fill('/tmp/a long development source folder/palboo');
    const source = await drawer.locator('#app-mode-source').elementHandle();
    assert.ok(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    await mkdir('target/reports/settings-connection', { recursive: true });
    await f.page.screenshot({
      path: `target/reports/settings-connection/development-${language}.png`,
    });
    await f.page.keyboard.press('Escape');
    await f.page
      .getByRole('button', {
        name: language === 'en' ? 'Development settings' : '开发设置',
        exact: true,
      })
      .press('Enter');
    assert.equal(
      await drawer.locator('#app-mode-source').evaluate((node, old) => node === old, source),
      true,
    );
    assert.equal(
      await drawer.locator('#app-mode-source').inputValue(),
      '/tmp/a long development source folder/palboo',
    );
    await drawer.locator('#app-mode-source').fill('');
    await f.page.keyboard.press('Escape');
    await f.page.locator('#app-mode').selectOption('release');
  }
});

test('disconnect invalidates versions and late checks; reconnect reads the installed App again', async (t) => {
  let finish;
  const f = await fixture(t, {
    holdCheck: new Promise((resolve) => {
      finish = resolve;
    }),
  });
  await f.card.getByText('v1.2.0', { exact: true }).waitFor();
  await f.check();
  await f.page.evaluate(() => window.connection(false));
  await f.card.locator('#app-update-version').filter({ hasText: '—' }).waitFor();
  finish();
  await f.card.getByRole('button', { name: '检查更新', exact: true }).waitFor();
  await f.page
    .locator('#settings-connection')
    .getByText('本地服务未连接', { exact: true })
    .waitFor();
  assert.equal(await f.page.getByText('已连接桌面 Codex', { exact: true }).count(), 0);
  assert.equal(
    await f.page.getByRole('button', { name: '持续暂停', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await f.card.getByRole('button', { name: '检查更新', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await f.card.getByRole('button', { name: '更新并重启', exact: true }).count(), 0);
  assert.equal(await f.card.getByText('v1.2.0', { exact: true }).count(), 0);
  f.behavior.initial = { ...base, currentVersion: '1.3.0', revision: 5 };
  await f.page.evaluate(() => window.connection(true));
  await f.card.getByText('v1.3.0', { exact: true }).waitFor();
  assert.equal(f.writes.length, 1, 'reconnection never repeats a check or starts installation');
});
