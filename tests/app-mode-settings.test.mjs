/* [INPUT]: Actual mode settings component and a synthetic authenticated API.
 * [OUTPUT]: Dirty draft protection, source selection, failure feedback and progress handoff.
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
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AppModeSettings} from './ui/settings/app-mode-settings';function App(){const[dirty,setDirty]=React.useState(true);return <><button onClick={()=>setDirty(false)}>Save fixture</button><AppModeSettings live editor={{dirty,saving:false,remoteChanged:false}}/></>}createRoot(document.getElementById('root')).render(<App/>);`,
        resolveDir: process.cwd(),
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      format: 'iife',
    })
  ).outputFiles[0].text;
  let fail = true;
  const writes = [];
  const server = createServer((req, res) => {
    if (req.url === '/api/app-mode') {
      if (req.method === 'GET')
        return res.setHeader('content-type', 'application/json').end(
          JSON.stringify({
            mode: 'release',
            preferredMode: 'release',
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
    await page.getByRole('button', { name: '开发模式', exact: true }).click();
    await page.getByLabel('源码目录', { exact: true }).fill('/tmp/fixture source');
    assert.equal(
      await page.getByRole('button', { name: '切换模式', exact: true }).isDisabled(),
      true,
    );
    assert.equal(writes.length, 0);
    await page.getByText('Save fixture').click();
    await page.getByRole('button', { name: '切换模式', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'fixture unavailable' }).waitFor();
    assert.equal(
      await page.getByLabel('源码目录', { exact: true }).inputValue(),
      '/tmp/fixture source',
    );
    assert.equal(writes[0].expectedRevision, 8);
    assert.equal(writes[0].mode, 'development');
    fail = false;
    await page.getByRole('button', { name: '切换模式', exact: true }).click();
    await page.waitForURL('**/progress');
    assert.equal(writes.length, 2);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
