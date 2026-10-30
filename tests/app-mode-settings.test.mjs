/* [INPUT]: Actual mode settings component and a synthetic authenticated API.
 * [OUTPUT]: Drawer draft/focus retention, offline protection, source selection, failure feedback and progress handoff.
 * [POS]: Browser regression without starting any Palboo or Codex process.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('release settings can select development, retain edits on failure and hand over only after saving', async () => {
  const js = (
    await build({
      stdin: {
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AppModeSettings} from './ui/settings/app-mode-settings';function App(){const[dirty,setDirty]=React.useState(true);const[live,setLive]=React.useState(true);window.connection=setLive;return <><button onClick={()=>setDirty(false)}>Save fixture</button><AppModeSettings live={live} editor={{dirty,saving:false,remoteChanged:false}}/></>}createRoot(document.getElementById('root')).render(<App/>);`,
        resolveDir: process.cwd(),
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      format: 'iife',
    })
  ).outputFiles[0].text;
  let fail = true;
  let preferredMode = 'release';
  let modeRead;
  const writes = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/api/app-update')
      return res.setHeader('content-type', 'application/json').end(
        JSON.stringify({
          currentVersion: '1.3.0',
          revision: 8,
          checked: false,
          canInstall: true,
        }),
      );
    if (req.url === '/api/app-mode') {
      if (req.method === 'GET' && modeRead) await modeRead;
      if (req.method === 'GET')
        return res.setHeader('content-type', 'application/json').end(
          JSON.stringify({
            mode: 'release',
            preferredMode,
            revision: 8,
            source: null,
            node: null,
            releaseAvailable: true,
          }),
        );
      let body = '';
      req.on('data', (v) => (body += v));
      req.on('end', () => {
        writes.push(JSON.parse(body));
        res
          .writeHead(fail ? 400 : 200, { 'content-type': 'application/json' })
          .end(
            JSON.stringify(
              fail
                ? { ok: false, message: 'fixture unavailable' }
                : { url: `http://127.0.0.1:${server.address().port}/progress` },
            ),
          );
      });
      return;
    }
    if (req.url === '/progress') return res.end('Progress fixture');
    res
      .setHeader('content-type', 'text/html')
      .end('<div id="root"></div><script>' + js.replaceAll('</script', '<\\/script') + '</script>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/#token=synthetic`);
    await page.getByLabel('启动时使用', { exact: true }).selectOption('development');
    await page.getByRole('button', { name: '开发设置', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '开发设置', exact: true });
    await page.getByLabel('源码目录', { exact: true }).fill('/tmp/fixture source');
    await page.getByLabel('Node.js', { exact: true }).fill('/tmp/fixture node');
    assert.equal(
      await drawer.getByRole('button', { name: '切换模式', exact: true }).isDisabled(),
      true,
    );
    assert.equal(writes.length, 0);
    await page.keyboard.press('Escape');
    assert.equal(
      await page
        .getByRole('button', { name: '开发设置', exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
    );
    await page.getByText('Save fixture').click();
    let finishRead;
    modeRead = new Promise((resolve) => {
      finishRead = resolve;
    });
    await page.evaluate(() => window.connection(false));
    await page.locator('#app-mode:disabled').waitFor();
    assert.equal(await page.getByLabel('启动时使用', { exact: true }).isDisabled(), true);
    assert.equal(
      await page.getByRole('button', { name: '切换模式', exact: true }).isDisabled(),
      true,
    );
    await page.evaluate(() => window.connection(true));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(
      await page.getByLabel('启动时使用', { exact: true }).isDisabled(),
      true,
      'reconnection waits for a fresh mode read',
    );
    finishRead();
    await page.getByRole('button', { name: '开发设置', exact: true }).click();
    assert.equal(
      await page.getByLabel('源码目录', { exact: true }).inputValue(),
      '/tmp/fixture source',
    );
    assert.equal(
      await page.getByLabel('Node.js', { exact: true }).inputValue(),
      '/tmp/fixture node',
    );
    await drawer.getByRole('button', { name: '切换模式', exact: true }).click();
    await drawer.getByRole('alert').filter({ hasText: 'fixture unavailable' }).waitFor();
    assert.equal(
      await page.getByLabel('源码目录', { exact: true }).inputValue(),
      '/tmp/fixture source',
    );
    assert.equal(writes[0].expectedRevision, 8);
    assert.equal(writes[0].mode, 'development');
    assert.equal(writes[0].node, '/tmp/fixture node');
    fail = false;
    await drawer.getByRole('button', { name: '切换模式', exact: true }).click();
    await page.waitForURL('**/progress');
    assert.equal(writes.length, 2);
    preferredMode = 'development';
    await page.goto(`http://127.0.0.1:${server.address().port}/#token=synthetic`);
    await page.getByText('Save fixture').click();
    await page.getByRole('button', { name: '切换模式', exact: true }).click();
    await page.waitForURL('**/progress');
    assert.equal(writes.at(-1).mode, 'release');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
