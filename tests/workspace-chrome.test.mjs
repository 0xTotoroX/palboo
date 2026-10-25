/* [INPUT]: Shared header template, workspace CSS and synthetic source/state updates.
 * [OUTPUT]: Headers keep legacy text hidden; icon actions and drafts survive language and surface changes.
 * [POS]: Isolated browser DOM/geometry checks; no screenshots, host data or native commands.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { workbenchHeadHtml } from '../ui/surfaces/workspace/chrome.js';

test('shared header never exposes legacy source text before association initialization', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
    page.setDefaultTimeout(5000);
    const css = await readFile('ui/surfaces/workspace/styles.css', 'utf8');
    for (const desktop of [false, true]) {
      for (const source of ['Codex · 等待聊天', '合成聊天来源']) {
        await page.setContent(
          `<style>${css}</style><div class="csw-workbench">${workbenchHeadHtml(desktop)}</div>`,
        );
        // Source updates can precede legacy association setup on the shared shell path.
        await page.locator('.csw-workbench-source').evaluate((el, text) => {
          el.textContent = text;
        }, source);
        const header = page.locator('.csw-workbench-head');
        await header.hover();
        assert.equal(await header.innerText(), '', 'only icons are painted in the header');
        assert.equal(await header.locator('[title]').count(), 0, 'no native hover tooltip');
        assert.equal(await header.locator('.csw-workbench-source').isVisible(), false);
        if (desktop) {
          for (const label of ['收回聊天', '放大']) {
            const button = header.getByRole('button', { name: label, exact: true });
            await button.focus();
            assert.equal(await button.evaluate((el) => el === document.activeElement), true);
            const box = await button.boundingBox();
            assert.ok(box.width >= 28 && box.height >= 28, 'window actions keep their hit area');
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
});

test('workspace icons share names and hit areas across surfaces, model catalog and split/merge gestures', async () => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {installFeatureLayout} from './ui/surfaces/workspace/layout';
    import {ModelView} from './ui/features/model/view';
    import {setLocale} from './ui/shared/i18n';
    window.changeLocale=setLocale;
    const root=document.getElementById('workbench'); window.saves=[]; window.actions=[];
    const ids=['outline','next','board','model','terms','bots'];
    window.items=ids.map(id=>{const node=document.createElement('div');node.style.height='100%';node.innerHTML='<input aria-label="'+id+'草稿" value="保留草稿">';return {id,node,active:true}});
    const model=items.find(item=>item.id==='model'); const slot=document.createElement('span'); model.mount={headerActions:slot};
    window.layout={axis:'vertical',groups:[{ids,active:'model',weight:1}]};
    window.controller=installFeatureLayout(root,{save:async(surface,next)=>{layout=next;saves.push(next)},error:e=>{throw e}});
    window.show=(surface='sidebar')=>controller.update(items,surface,layout,null,null);show();
    const state={revision:1,preferences:{enabled:true,pinned:['a'],modelColumnWidth:100,presets:[]},snapshot:{target:{id:'fixture'},revision:'v1',status:'ready',models:[{id:'a',label:'测试模型',reasoning:['low','high'],fast:true}],current:{model:'a',reasoning:'high',speed:'standard'}}};
    createRoot(model.node).render(<div className="feature-view"><div className="feature-body"><ModelView state={state} headerActions={slot} reading={{}} busy={false} action={async(data,action)=>{actions.push({data,action});return state}}/></div></div>);
  `,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 900 },
      reducedMotion: 'reduce',
    });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(
      '<div id="workbench" class="csw-workbench" style="width:360px;height:680px;--csw-text:#222;--csw-muted:#777;--csw-accent:#555;--csw-chrome-font:16px;--ink:#222;--paper:#fff;--muted:#777"></div>',
    );
    await page.addStyleTag({
      content: (
        await Promise.all(
          [
            'ui/surfaces/workspace/content.css',
            'ui/features/model/styles.css',
            'ui/surfaces/workspace/styles.css',
          ].map((path) => readFile(path, 'utf8')),
        )
      ).join('\n'),
    });
    await page.addScriptTag({ content: script });
    const tab = (name) => page.getByRole('tab', { name, exact: true });
    await page.locator('.model-inline-heading .model-fast').waitFor();
    const checkIcons = async () => {
      const icons = await page.locator('[data-pane-tab]').evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect(),
            s = n.querySelector('svg').getBoundingClientRect();
          return {
            name: n.getAttribute('aria-label'),
            title: n.title,
            text: n.textContent.trim(),
            w: r.width,
            h: r.height,
            sw: s.width,
            sh: s.height,
            reachable: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          };
        }),
      );
      assert.deepEqual(
        icons.map((i) => i.name),
        ['大纲', '下一步', '看板', '模型切换', '术语', 'Grok Bot'],
      );
      for (const i of icons) {
        assert.equal(i.name, i.title);
        assert.equal(i.text, '');
        assert.equal(i.w, 28);
        assert.equal(i.h, 28);
        assert.equal(i.sw, 18);
        assert.equal(i.sh, 18);
        assert.ok(i.reachable, i.name);
      }
    };
    await checkIcons();
    const fast = await page.locator('.model-inline-heading .model-fast').boundingBox();
    const maxRight = await page
      .locator('[data-pane-tab]')
      .evaluateAll((nodes) => Math.max(...nodes.map((n) => n.getBoundingClientRect().right)));
    assert.ok(maxRight <= fast.x, 'wrapped icon rail leaves Fast clear');
    await page.getByRole('button', { name: '所有模型', exact: true }).click();
    await checkIcons();
    await tab('下一步').click();
    assert.equal(
      await tab('下一步').getAttribute('aria-selected'),
      'true',
      'catalog closes without swallowing the click',
    );
    await page.getByLabel('next草稿', { exact: true }).fill('图标切换后保留');
    for (const surface of ['overlay', 'desktop', 'sidebar']) {
      await page.evaluate((surface) => show(surface), surface);
      await tab('模型切换').click();
      await tab('下一步').click();
      assert.equal(
        await page.getByLabel('next草稿', { exact: true }).inputValue(),
        '图标切换后保留',
      );
    }
    await tab('下一步').press('End');
    await tab('Grok Bot').press('Enter');
    assert.equal(await tab('Grok Bot').getAttribute('aria-selected'), 'true');
    await tab('看板').dblclick();
    assert.equal(await page.locator('#workbench').getAttribute('data-composition'), 'focus');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#workbench').getAttribute('data-composition'), 'tabs');
    await page.locator('#workbench').evaluate((n) => (n.style.width = '800px'));
    const start = await tab('下一步').boundingBox(),
      target = await page.locator('.csw-workbench-pane').boundingBox();
    await page.mouse.move(start.x + 14, start.y + 14);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width - 15, target.y + target.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('.csw-workbench-pane').length === 2);
    const source = await tab('下一步').boundingBox(),
      other = await page
        .locator('.csw-workbench-pane')
        .filter({ has: tab('大纲') })
        .boundingBox();
    await page.mouse.move(source.x + 14, source.y + 14);
    await page.mouse.down();
    await page.mouse.move(other.x + other.width / 2, other.y + other.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('.csw-workbench-pane').length === 1);
    assert.equal(await page.getByLabel('next草稿', { exact: true }).inputValue(), '图标切换后保留');
    const savedLayout = await page.evaluate(() => structuredClone(layout));
    await page.evaluate(() => changeLocale('en'));
    for (const surface of ['sidebar', 'overlay', 'desktop']) {
      await page.evaluate((surface) => show(surface), surface);
      assert.deepEqual(
        await page
          .locator('[data-pane-tab]')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')).sort()),
        ['Outline', 'Next steps', 'Board', 'Model switching', 'Terms', 'Grok Bot'].sort(),
      );
      await tab('Next steps').click();
      assert.equal(
        await page.getByLabel('next草稿', { exact: true }).inputValue(),
        '图标切换后保留',
      );
      await tab('Model switching').click();
      await page.getByRole('button', { name: 'All models', exact: true }).waitFor();
      assert.equal(await page.locator('#workbench').getAttribute('lang'), 'en');
    }
    assert.deepEqual(
      await page.evaluate(() => layout.groups.map((group) => group.ids)),
      savedLayout.groups.map((group) => group.ids),
    );
    assert.deepEqual(await page.evaluate(() => actions), []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
