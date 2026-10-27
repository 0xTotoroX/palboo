/* [INPUT]: Shared Bot view and synthetic metadata in an isolated browser.
 * [OUTPUT]: Disclosure, composer-action boundaries, motion and responsive geometry checks.
 * [POS]: Frontend regression only; no real Bot calls. [PROTOCOL]: See tests/AGENTS.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

test('Bot list keeps messages opt-in and animates only visible active avatars', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {BotsView} from './ui/features/bots/view';
      window.calls=[];window.state={autoSync:true,snapshot:{target:{threadId:'test',token:'safe'},catalog:{revision:'r1',stale:false},bots:[
      {id:'a',name:'大总管',occupied:false,avatar:{shape:'circle',color:'black'},preview:'这是一段仅供测试的最近消息。默认收起，点击后才展开。',current:{key:'run',status:'running'}},
      {id:'b',name:'优惠雷达',occupied:false,avatar:{shape:'circle',color:'yellow'},preview:'较长的最近消息。'.repeat(16),current:{key:'done',status:'finished'}},
      {id:'c',name:'名称很长的资料整理助手',occupied:false,avatar:{shape:'circle',color:'violet'},preview:'另一条消息',current:null},
      {id:'d',name:'工程主管',occupied:false,avatar:{shape:'circle',color:'blue'},current:{key:'error',status:'error'}}]}};
      const root=createRoot(document.getElementById('root'));
      window.render=()=>root.render(<BotsView state={window.state} disabled={false} action={v=>window.calls.push(v)}/>);window.render();`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 440, height: 700 } });
    await page.setContent(
      '<style>body{margin:0;background:#fff;color:#24262a;font:16px system-ui;--muted:#62666b;--hover:#eee;--ink:#24262a}#root{width:100%}</style><div id="root"></div>',
    );
    await page.addStyleTag({ content: readFileSync('ui/features/bots/style.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const rows = page.locator('.palboo-bot');
    await rows.first().waitFor();
    assert.equal(await page.locator('.palboo-bot-preview').count(), 0);
    assert.equal(await page.getByText('调用失败', { exact: true }).count(), 1);
    const history = page.getByRole('button', { name: '最近消息：大总管', exact: true });
    await history.focus();
    await page.keyboard.press('Enter');
    assert.equal(await history.getAttribute('aria-expanded'), 'true');
    assert.match(await page.locator('.palboo-bot-preview').textContent(), /默认收起/);
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    await page.evaluate(() => window.render());
    assert.equal(
      await history.getAttribute('aria-expanded'),
      'true',
      'refresh preserves intentional disclosure',
    );
    await page.getByRole('button', { name: '最近消息：优惠雷达', exact: true }).click();
    assert.equal(await history.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.palboo-bot-preview').count(), 1);
    for (const [width, columns] of [
      [260, 1],
      [440, 2],
      [760, 3],
    ]) {
      await page.setViewportSize({ width, height: 700 });
      assert.equal(
        await page
          .locator('.palboo-bot-group')
          .evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(' ').length),
        columns,
      );
      const geometry = await rows.evaluateAll((nodes) =>
        nodes.map((n) => {
          const label = n.querySelector('.palboo-bot-copy').getBoundingClientRect();
          const toggle = n.querySelector('.palboo-bot-history')?.getBoundingClientRect();
          const status = n.querySelector('.palboo-bot-status');
          return {
            fits: n.scrollWidth <= n.clientWidth,
            clear: !toggle || (label.right <= toggle.left && toggle.left - label.right <= 5),
            label: label.left,
            status: status
              ? status.getBoundingClientRect().left +
                parseFloat(getComputedStyle(status).paddingLeft)
              : label.left,
          };
        }),
      );
      assert.ok(geometry.every((g) => g.fits && g.clear && Math.abs(g.label - g.status) < 1));
    }
    const eye = rows.first().locator('.palboo-bot-eye').first();
    await page.waitForFunction(
      () => document.querySelector('[data-activity="working"]').dataset.moving === 'true',
    );
    assert.equal(await eye.evaluate((n) => getComputedStyle(n).animationName), 'palboo-bot-think');
    assert.deepEqual(
      await rows
        .first()
        .locator('.palboo-bot-eye')
        .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).animationDelay)),
      ['0s', '0s'],
    );
    const eyes = await rows
      .first()
      .locator('.palboo-bot-eye')
      .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).transform));
    assert.equal(eyes[0], eyes[1], 'both eyes blink together');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await eye.evaluate((n) => getComputedStyle(n).animationName), 'none');
    assert.equal(await page.getByText('处理中', { exact: true }).count(), 1);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => (document.getElementById('root').style.marginTop = '1000px'));
    await page.waitForFunction(
      () => document.querySelector('[data-activity="working"]').dataset.moving === 'false',
    );
    assert.equal(await eye.evaluate((n) => getComputedStyle(n).animationPlayState), 'paused');
    await page.evaluate(() => (document.getElementById('root').style.marginTop = '0'));
    await page.getByRole('button', { name: '最近消息：优惠雷达', exact: true }).click();
    await page.getByRole('button', { name: '大总管', exact: true }).click();
    await rows.first().getByRole('button', { name: '查看进度', exact: true }).click();
    await rows.first().getByRole('button', { name: '填入停止请求', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.calls.map((c) => c.action)), [
      'ask',
      'check',
      'stop',
    ]);
    assert.equal(await page.locator('textarea,input').count(), 0);
    await page.setViewportSize({ width: 440, height: 700 });
    mkdirSync('target/reports/bots-view', { recursive: true });
    await page.screenshot({ path: 'target/reports/bots-view/light.png' });
    await page.evaluate(() => {
      document.body.style.background = '#171719';
      document.body.style.color = '#eee';
      document.body.style.setProperty('--muted', '#b1b1b6');
      document.body.style.setProperty('--hover', '#333');
    });
    await page.screenshot({ path: 'target/reports/bots-view/dark.png' });
  } finally {
    await browser.close();
  }
});
