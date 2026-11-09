/* [INPUT]: Reader preference hook and delayed isolated authenticated requests.
 * [OUTPUT]: Late-read protection, serial saves and network-free preview behavior.
 * [POS]: No real reader origin, files or credentials are used.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('reader preferences preserve edits during initial load and serialize newer saves', async (t) => {
  const script = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{useReaderPreference}from'./ui/reader/preferences';function App(){const[value,set]=useReaderPreference('sidebarWidth',()=>268);const[preview,changePreview]=useReaderPreference(undefined,()=>232);window.preview=changePreview;return <><input aria-label="width" value={value} onChange={e=>set(Number(e.target.value))}/><span>{preview}</span></>}createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.clock.install();
  let resolveRead,
    resolveWrite,
    reads = 0;
  const writes = [];
  let active = 0,
    maximum = 0;
  const pendingRead = new Promise((r) => (resolveRead = r)),
    pendingWrite = new Promise((r) => (resolveWrite = r));
  await page.route('https://reader.test/**', async (route) => {
    const request = route.request();
    if (!request.url().includes('/api/preferences'))
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    assert.equal(request.headers().authorization, 'Bearer synthetic');
    if (request.method() === 'GET') {
      reads++;
      await pendingRead;
      return route.fulfill({ json: { sidebarWidth: 280 } });
    }
    writes.push(request.postDataJSON());
    active++;
    maximum = Math.max(maximum, active);
    if (writes.length === 1) await pendingWrite;
    active--;
    return route.fulfill({ json: writes.at(-1) });
  });
  await page.goto('https://reader.test/#reader=synthetic');
  await page.addScriptTag({ content: script.outputFiles[0].text });
  const input = page.getByLabel('width');
  await input.fill('300');
  const loaded = page.waitForResponse(
    (r) => r.url().includes('/preferences') && r.request().method() === 'GET',
  );
  const firstSave = page.waitForRequest(
    (r) => r.url().includes('/preferences') && r.method() === 'POST',
  );
  resolveRead();
  await loaded;
  assert.equal(await input.inputValue(), '300');
  assert.deepEqual((await firstSave).postDataJSON(), { sidebarWidth: 300 });
  await input.fill('420');
  await page.clock.runFor(300);
  assert.equal(writes.length, 1, 'the second write waits for the first');
  const secondSave = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.request().postDataJSON().sidebarWidth === 420,
  );
  resolveWrite();
  await secondSave;
  assert.equal(maximum, 1);
  assert.deepEqual(writes, [{ sidebarWidth: 300 }, { sidebarWidth: 420 }]);
  assert.equal(reads, 1);
  await page.evaluate(() => window.preview(320));
  await page.getByText('320', { exact: true }).waitFor();
  await page.clock.runFor(250);
  assert.equal(reads, 1);
  assert.equal(writes.length, 2);
});
