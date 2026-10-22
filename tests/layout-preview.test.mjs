/* [INPUT]: Actual integrated settings preview, shared workspace and synthetic saved snapshots.
 * [OUTPUT]: Zero-write demonstration, dynamic catalog, retained drafts and screen-motion checks.
 * [POS]: Browser fixture only; never connects to a product service or real conversation.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test(
  'settings layout demonstration shares actual compaction without writing settings',
  { timeout: 60000 },
  async () => {
    const script = (
      await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'jsx',
          contents: `
 import React from 'react';import {createRoot} from 'react-dom/client';import {LayoutPreview} from './ui/settings/layout-preview';
 const features={mainPlacement:'sidebar',features:['outline','next','board','terms','model'].map(id=>({id,open:true,placement:id==='model'?'edge':'sidebar'})),layouts:{sidebar:{axis:'vertical',groups:['outline','next','board','terms'].map(id=>({ids:[id],active:id,weight:1}))}}};
 const surfaces={preferences:{themes:Object.fromEntries(['sidebar','overlay','desktop','edge'].map(id=>[id,{theme:'matte'}])),edge:{edge:'right',position:.5}}};
 window.requests=[];window.fetch=(...args)=>{window.requests.push(args);throw Error('Sample must never request a service')};
 createRoot(document.getElementById('root')).render(<div className="settings-app" data-settings-category="surfaces"><LayoutPreview features={features} surfaces={surfaces} live={true}/></div>);
 `,
        },
        bundle: true,
        write: false,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
      })
    ).outputFiles[0].text;
    const html = await readFile('target/web/index.html', 'utf8');
    let css = '';
    for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
      css += await readFile(`target/web${href}`, 'utf8');
    const document = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}body{padding:24px}#root{max-width:1100px;margin:auto}</style><div id="root"></div><script>${script.replace(/<\/script/gi, '<\\/script')}</script>`;
    await mkdir('target/reports', { recursive: true });
    await writeFile('target/reports/layout-preview.html', document);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1240, height: 1050 } }),
        errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(document);
      const pane = page.locator('.csw-workbench-pane');
      await page.waitForFunction(
        () => document.querySelectorAll('.csw-workbench-pane').length === 4,
      );
      await page.getByLabel('下一步示例草稿', { exact: true }).fill('保留的示例草稿');
      const separator = page.getByRole('separator').first(),
        b = await separator.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + 250, { steps: 20 });
      await page.mouse.up();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-compact="true"]').length === 3,
      );
      if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
        await page.screenshot({
          path: 'target/reports/sidebar-layout-preview.png',
          fullPage: true,
        });
      await page.getByRole('tab', { name: '下一步', exact: true }).click();
      assert.equal(
        await page.getByLabel('下一步示例草稿', { exact: true }).inputValue(),
        '保留的示例草稿',
      );
      await page.getByRole('button', { name: '＋ 添加示例功能', exact: true }).click();
      await page.getByRole('tab', { name: '笔记', exact: true }).waitFor();
      assert.equal(await pane.count(), 5);
      await page.getByRole('button', { name: '演示移到副屏', exact: true }).click();
      const frames = await page.locator('.layout-demo-window').evaluate(async (el) => {
        const values = [];
        for (let i = 0; i < 70; i++) {
          values.push({ x: el.x.baseVal.value, width: el.width.baseVal.value });
          await new Promise(requestAnimationFrame);
        }
        return values;
      });
      assert.ok(
        frames.some((frame) => frame.x > 470 && frame.x < 730),
        'travel has intermediate positions',
      );
      await page.waitForFunction(
        () => document.querySelector('.layout-demo-window').x.baseVal.value === 754,
      );
      if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
        await page.screenshot({
          path: 'target/reports/sidebar-layout-secondary.png',
          fullPage: true,
        });
      await page.getByRole('button', { name: '演示侧栏', exact: true }).click();
      await page.getByRole('button', { name: '演示页面浮层', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('.layout-demo-window').x.baseVal.value === 402,
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: '演示移到副屏', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('.layout-demo-window').x.baseVal.value === 754,
      );
      await page.getByRole('button', { name: '恢复已保存配置', exact: true }).click();
      await page.getByRole('tab', { name: '笔记', exact: true }).waitFor({ state: 'detached' });
      for (const width of [390, 760, 1360]) {
        await page.setViewportSize({ width, height: 1050 });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
      }
      assert.deepEqual(await page.evaluate(() => window.requests), []);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
