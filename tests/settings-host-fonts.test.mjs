/* [INPUT]: Real font hook/API and synthetic FontFace/network responses.
 * [OUTPUT]: Authenticated on-demand loading, family filtering, failure fallback and cleanup.
 * [POS]: Isolated settings document; no proprietary font bytes or real user preferences.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('host fonts load on demand with authentication and survive partial failures', async () => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{useHostFonts}from'./ui/settings/use-host-fonts';
function App({family}){useHostFonts(family);return <p>{family||'system'}</p>}
const root=createRoot(document.getElementById('root'));
window.render=family=>root.render(<App family={family}/>);
window.unmount=()=>root.unmount();`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const calls = [];
    await page.route('http://fonts.test/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!path.startsWith('/api/'))
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      calls.push({ path, authorization: request.headers().authorization, url: request.url() });
      if (path === '/api/host-fonts')
        return route.fulfill({
          json: {
            fonts: [
              { id: 'openai-sans-regular', family: 'OpenAI Sans', weight: 400, style: 'normal' },
              { id: 'openai-sans-medium', family: 'OpenAI Sans', weight: 500, style: 'normal' },
              { id: 'openai-sans-semibold', family: 'OpenAI Sans', weight: 600, style: 'normal' },
              { id: 'openai-serif-light', family: 'OpenAI Serif', weight: 300, style: 'normal' },
            ],
          },
        });
      if (path.endsWith('medium')) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: 'font/woff2', body: Buffer.alloc(64) });
    });
    await page.goto('http://fonts.test/#token=font-fixture-token');
    await page.evaluate(() => {
      window.faces = new Set();
      window.loads = [];
      window.pendingFaces = [];
      window.delayFonts = false;
      Object.defineProperty(document, 'fonts', {
        value: {
          add: (face) => window.faces.add(face),
          delete: (face) => window.faces.delete(face),
        },
      });
      window.FontFace = class {
        constructor(family, source, descriptors) {
          Object.assign(this, { family, source, ...descriptors });
        }
        load() {
          window.loads.push({
            family: this.family,
            weight: this.weight,
            binary: this.source instanceof ArrayBuffer,
          });
          if (this.weight === '600') return Promise.reject(new Error('synthetic decode failure'));
          if (window.delayFonts)
            return new Promise((resolve) => window.pendingFaces.push(() => resolve(this)));
          return Promise.resolve(this);
        }
      };
    });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => window.render('system-ui'));
    await page.getByText('system-ui', { exact: true }).waitFor();
    assert.equal(calls.length, 0, 'system fonts require no catalog or file request');
    await page.evaluate(() => window.render('"OpenAI Sans", system-ui'));
    await page.waitForFunction(() => window.faces.size === 1 && window.loads.length === 2);
    assert.equal(calls.length, 4);
    assert.ok(calls.every((call) => call.authorization === 'Bearer font-fixture-token'));
    assert.ok(calls.every((call) => !call.url.includes('token')));
    assert.ok(calls.every((call) => !call.path.includes('serif')));
    assert.deepEqual(
      await page.evaluate(() => [...window.faces].map((f) => [f.family, f.weight])),
      [['OpenAI Sans', '400']],
    );
    await page.evaluate(() => window.render('"Codex selected ArialMT", sans-serif'));
    await page.waitForFunction(
      () => window.faces.size === 1 && [...window.faces][0].family === 'Codex selected ArialMT',
    );
    assert.equal(calls.length, 4, 'local font aliases keep their existing local-only path');
    await page.evaluate(() => {
      window.delayFonts = true;
      window.render('"OpenAI Serif", serif');
    });
    await page.waitForFunction(() => window.pendingFaces.length === 1);
    await page.evaluate(() => {
      window.unmount();
      window.pendingFaces.forEach((resolve) => resolve());
    });
    assert.equal(
      await page.evaluate(() => window.faces.size),
      0,
      'late loads cannot install after cleanup',
    );
  } finally {
    await browser.close();
  }
});
