/* [INPUT]: 真实功能组合层、可选测速模块与合成模型投影。
 * [OUTPUT]: 快切内的插拔、几何/主题、无额外请求和模型操作独立性。
 * [POS]: 独立浏览器验收，不接触真实模型配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
test('token module plugs into model footer and unplugs without changing model controls', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {FeatureContent} from './ui/features/content';
    const root=createRoot(document.getElementById('root').attachShadow({mode:'open'}));const reading={};window.calls=[];window.connected=true;
    window.state={revision:1,preferences:{enabled:true,pinned:['gpt-test'],presets:[{id:'p',name:'测试预设',selection:{model:'gpt-test',reasoning:'high',speed:'standard'}}]},snapshot:{target:{id:'a'},revision:'host',status:'ready',message:'',current:{model:'gpt-test',reasoning:'high',speed:'standard'},usage:[{minutes:300,remainingPercent:60,resetsAt:null},{minutes:10080,remainingPercent:86,resetsAt:null}],models:[{id:'gpt-test',label:'Test model',reasoning:['high'],fast:true}]}};
    window.render=()=>root.render(<FeatureContent id="model" reading={reading} value={window.state} locked={false} connected={window.connected} call={async(op,data)=>{window.calls.push({op,data});return window.state}} operation={async fn=>fn()} update={()=>{}}/>);window.render();
  `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    outfile: 'fixture.js',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
    await page.setContent(
      '<style>body{margin:16px;--ink:#222;--muted:#666;--paper:#fff;--hover:#eee}#root{width:100%;font:14px sans-serif}</style><div id="root"></div>',
    );
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    await page.evaluate(
      (css) => {
        const style = document.createElement('style');
        style.textContent = css;
        document.getElementById('root').shadowRoot.append(style);
      },
      readFileSync('ui/features/model/styles.css', 'utf8'),
    );
    await page.getByRole('button', { name: '测试预设', exact: true }).waitFor();
    const matrix = await page.locator('.model-matrix').boundingBox();
    assert.equal(await page.locator('.token-meter-readout').count(), 0);
    await page.evaluate(() => {
      window.state.snapshot.tokenMeter = {
        threadId: 'a',
        phase: 'streaming',
        speed: 42.1,
        scope: 'turn',
        average: null,
        official: {
          inputTokens: 1000,
          cachedInputTokens: 500,
          outputTokens: 120,
          reasoningOutputTokens: 20,
        },
      };
      window.render();
    });
    const meter = page.locator('.feature-model .token-meter-readout');
    await meter.waitFor();
    assert.equal(await meter.textContent(), '≈ 42.1 tok/s');
    assert.match(await meter.getAttribute('title'), /其中思考 20/);
    const box = await meter.boundingBox(),
      presets = await page.locator('.model-presets').boundingBox();
    const actions = await page.locator('.model-preset-actions').boundingBox();
    const usage = await page.locator('.model-usage').boundingBox();
    const iconBox = await page.locator('.model-preset-edit svg').boundingBox();
    assert.ok(Math.abs(box.y + box.height - iconBox.y - iconBox.height) < 1);
    assert.ok(Math.abs(usage.y + usage.height - iconBox.y - iconBox.height) < 1);
    assert.ok(
      Math.abs(actions.y - presets.y - presets.height - 16) < 1,
      JSON.stringify({ actions, presets, box, usage, iconBox }),
    );
    assert.ok(box.x + box.width < actions.x);
    assert.equal(await meter.getAttribute('title').then((t) => t.includes('输出 120')), true);
    assert.ok(box.y >= presets.y + presets.height - 1);
    assert.ok(Math.abs(usage.x - matrix.x) < 1);
    assert.ok(usage.x + usage.width < box.x);
    assert.equal(await page.locator('.model-usage').innerText(), '周 86%\n5小时 60%');
    assert.equal(
      await page.locator('.model-preset-edit svg').evaluate((n) => n.getBoundingClientRect().width),
      18,
    );
    assert.equal(await meter.evaluate((n) => n.scrollWidth <= n.clientWidth), true);
    assert.deepEqual(await page.locator('.model-matrix').boundingBox(), matrix);
    for (const color of ['rgb(102, 102, 102)', 'rgb(180, 180, 180)']) {
      await page.evaluate((color) => document.body.style.setProperty('--muted', color), color);
      assert.equal(await meter.evaluate((n) => getComputedStyle(n).color), color);
    }
    for (const size of [14, 18, 22]) {
      await page.evaluate(
        (size) => (document.getElementById('root').style.fontSize = `${size}px`),
        size,
      );
      assert.equal(await meter.evaluate((n) => getComputedStyle(n).fontSize), '14px');
      assert.equal(
        await page.locator('.model-usage').evaluate((n) => getComputedStyle(n).fontSize),
        '14px',
      );
    }
    await page.evaluate(() => (document.getElementById('root').style.fontSize = '14px'));
    await page.evaluate(() => {
      window.state.snapshot.tokenMeter = null;
      window.render();
    });
    await meter.waitFor({ state: 'detached' });
    assert.deepEqual(await page.locator('.model-preset-actions').boundingBox(), actions);
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    await page.getByRole('button', { name: '测试预设', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.at(-1).data.action), 'apply');
    await page.evaluate(() => {
      window.state.snapshot.tokenMeter = {
        threadId: 'a',
        phase: 'idle',
        speed: null,
        official: null,
        scope: 'call',
        average: null,
      };
      window.render();
    });
    await meter.waitFor();
    assert.equal(await meter.textContent(), '— tok/s');
    for (const width of [420, 320, 260]) {
      await page.setViewportSize({ width, height: 700 });
      const footer = page.locator('.model-status-row');
      assert.equal(await footer.evaluate((n) => n.scrollWidth <= n.clientWidth), true);
      const m = await meter.boundingBox(),
        a = await page.locator('.model-preset-actions').boundingBox();
      assert.ok(m.x + m.width <= a.x || m.y + m.height <= a.y, 'footer groups never overlap');
    }
    assert.equal(await page.locator('.token-meter-readout').count(), 1);
    await page.evaluate(() => {
      window.connected = false;
      window.render();
    });
    await meter.waitFor({ state: 'detached' });
    await page.evaluate(() => {
      window.connected = true;
      window.render();
    });
    await meter.waitFor();
    assert.equal(await page.locator('.token-meter-readout').count(), 1);
  } finally {
    await browser.close();
  }
});
