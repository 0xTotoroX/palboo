/* [INPUT]: Actual workspace composition/CSS and synthetic mounted content.
 * [OUTPUT]: Sidebar-only compaction, reversible drag/click motion and retained nodes/readings.
 * [POS]: Isolated browser verification; no real owner, host, configuration or model requests.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { compactRows, transferRows } from '../ui/surfaces/workspace/compact-rows.js';

test('compact rows never crush a title, including very short containers', () => {
  for (let count = 2; count < 25; count++)
    for (const height of [80, 240, 600, 1800]) {
      const result = compactRows(Array(count).fill(1), height);
      assert.equal(result.length, count);
      assert.ok(
        result.every((row) => (row.collapsed ? row.height === 36 : row.height >= 120 - 1e-8)),
      );
      assert.ok(result.some((row) => !row.collapsed));
    }
  assert.deepEqual(transferRows([150, 150, 150, 150], 1, 342), [492, 36, 36, 36]);
});

test(
  'sidebar drag collapses mounted content, click restores reading; other surfaces stay unchanged',
  { timeout: 45000 },
  async () => {
    const script = (
      await build({
        stdin: {
          resolveDir: process.cwd(),
          contents: `
 import {installFeatureLayout} from './ui/surfaces/workspace/layout.js';
 const root=document.querySelector('#workbench');window.saves=[];
 const ids=['outline','next','board','terms'];
 window.items=ids.map(id=>{const node=document.createElement('div');node.style.cssText='height:100%;overflow:auto';node.dataset.readingKey=id;node.innerHTML='<input aria-label="'+id+'草稿" value="保留草稿"><div style="height:1800px">合成正文</div>';return {id,node,active:true}});
 const host=window.items[2].node;host.innerHTML='';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<div data-reading-key="board" style="height:100%;overflow:auto"><input value="shadow draft"><div style="height:1800px">shadow content</div></div>';window.shadow=shadow.firstElementChild;
 window.layout={axis:'vertical',groups:ids.map(id=>({ids:[id],active:id,weight:1}))};
 window.controller=installFeatureLayout(root,{save:async(surface,value)=>{window.layout=value;window.saves.push(surface)},error:e=>{throw e}});
 window.show=(surface='sidebar')=>window.controller.update(window.items,surface,window.layout,null,null);
 window.show();window.original=window.items[1].node;
 `,
        },
        bundle: true,
        write: false,
      })
    ).outputFiles[0].text;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } }),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setContent(
        '<div id="workbench" class="csw-workbench" style="width:420px;height:680px;--csw-text:#222;--csw-muted:#777;--csw-accent:#555;--csw-chrome-font:16px"></div>',
      );
      await page.addStyleTag({
        content: await readFile('ui/surfaces/workspace/styles.css', 'utf8'),
      });
      await page.addStyleTag({ content: '*{box-sizing:border-box}input{width:160px}' });
      await page.addScriptTag({ content: script });
      await page.waitForFunction(
        () => document.querySelectorAll('[data-compact="false"]').length === 4,
      );
      await page.evaluate(() => {
        window.original.scrollTop = 240;
        window.shadow.scrollTop = 180;
        window.original.querySelector('input').value = '未保存草稿';
      });
      const handle = page.getByRole('separator').first(),
        b = await handle.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 420, { steps: 20 });
      await page.mouse.up();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-compact="true"]').length === 3,
      );
      assert.equal(
        await page.evaluate(
          () => window.original.isConnected && window.original === window.items[1].node,
        ),
        true,
      );
      assert.equal(await page.evaluate(() => window.original.scrollTop), 240);
      await page.evaluate(() => {
        const old = Element.prototype.animate;
        window.transitions = [];
        Element.prototype.animate = function (...args) {
          const a = old.apply(this, args);
          window.transitions.push(a.effect.getTiming().duration);
          return a;
        };
      });
      await page.getByRole('tab', { name: '下一步', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('[data-pane="next"]').dataset.compact === 'false',
      );
      await page.evaluate(async () => {
        await Promise.all(
          document
            .querySelector('#workbench')
            .getAnimations({ subtree: true })
            .map((a) => a.finished.catch(() => {})),
        );
      });
      assert.equal(
        await page.evaluate(() => window.original.querySelector('input').value),
        '未保存草稿',
      );
      assert.equal(await page.evaluate(() => window.original.scrollTop), 240);
      assert.ok((await page.evaluate(() => window.transitions)).includes(200));
      // Interrupt the real grid animation before it completes, then select another row.
      await page.evaluate(() => {
        document.querySelector('[data-pane-tab="outline"]').click();
        for (const animation of document
          .querySelector('#workbench')
          .getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 70;
        }
      });
      const intermediate = await page
        .locator('[data-pane="outline"]')
        .evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(intermediate > 36 && intermediate < 500, 'expansion has an intermediate height');
      await page.evaluate(() => document.querySelector('[data-pane-tab="next"]').click());
      await page.waitForFunction(
        () => document.querySelector('#workbench').getAnimations({ subtree: true }).length === 0,
      );
      assert.equal(await page.evaluate(() => window.original.scrollTop), 240);
      const board = page.getByRole('tab', { name: '看板', exact: true });
      await board.focus();
      await board.press('Enter');
      assert.equal(await page.locator('[data-pane="board"]').getAttribute('data-compact'), 'false');
      assert.equal(await page.evaluate(() => window.shadow.scrollTop), 180);
      assert.equal(
        await page.evaluate(() => window.shadow.querySelector('input').value),
        'shadow draft',
      );
      assert.equal(
        await page.evaluate(
          () => document.querySelector('#workbench').getAnimations({ subtree: true }).length,
        ),
        0,
        'keyboard expansion is immediate',
      );
      for (const surface of ['overlay', 'desktop']) {
        await page.evaluate((surface) => window.show(surface), surface);
        assert.equal(await page.locator('[data-compact="true"]').count(), 0);
        const heights = await page
          .locator('.csw-workbench-pane')
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        assert.ok(
          heights.every((h) => h >= 179),
          'other surfaces retain their minimum',
        );
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => window.show('sidebar'));
      await page.getByRole('tab', { name: '大纲', exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => document.querySelector('#workbench').getAnimations({ subtree: true }).length,
        ),
        0,
      );
      await page.evaluate(() => window.controller.destroy());
      assert.equal(await page.locator('.csw-feature-panes').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
