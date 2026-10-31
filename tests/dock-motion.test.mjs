/* [INPUT]: Actual dock adapter/styles and a synthetic chat row.
 * [OUTPUT]: Reversible sidebar occupancy, stable live content, immediate keyboard/reduced motion and cleanup checks.
 * [POS]: Browser-only acceptance; no real chat or native capture.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { emulateMedia } from './browser-motion.mjs';

test('sidebar reveal keeps live content stable while chat gives way and reverses cleanly', async (t) => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
import {createDock} from './ui/surfaces/embedded/dock';
import {installStyle} from './ui/surfaces/embedded/shell/install-styles';
installStyle();
const root=document.createElement('div');root.dataset.companionStepwiseRoot='true';
root.innerHTML='<textarea aria-label="面板草稿" style="width:100%;height:180px">保留草稿</textarea>';
window.original=root.firstChild;window.panel=root;
window.last=null;window.opened=false;
window.dock=createDock(value=>{window.last=value;root.style.display=value.status==='open'?'':'none'});
dock.attachRoot(root);
window.update=()=>dock.update({width:340,open:opened,detached:false});
window.toggle=()=>{opened=!opened;update()};
document.querySelector('#toggle').onclick=toggle;
update();
`,
      },
      bundle: true,
      write: false,
      loader: { '.css': 'text' },
      define: { PALBOO_DEVELOPMENT: 'true' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(
    '<button id="toggle">切换</button><div class="app-shell-main-content-frame" style="height:700px"><div id="row" style="display:flex;height:100%"><main id="chat" style="flex:1;min-width:0"><div class="thread-scroll-container" style="height:450px">合成聊天</div><div class="ProseMirror" contenteditable="true">宿主草稿</div></main></div></div>',
  );
  await page.addScriptTag({ content: script });
  const samples = await page.evaluate(async () => {
    toggle();
    const samples = [];
    while (document.querySelector('[data-dock-motion]')) {
      const slot = document.querySelector('[data-palboo-dock]').getBoundingClientRect();
      samples.push({
        slot: slot.width,
        chat: document.querySelector('#chat').getBoundingClientRect().width,
        row: document.querySelector('#row').getBoundingClientRect().width,
        body: panel.getBoundingClientRect().width,
        inert: panel.inert,
      });
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  assert.ok(
    samples.some((s) => s.slot > 1 && s.slot < 339),
    'opening has visible intermediate frames',
  );
  for (const s of samples) {
    assert.ok(Math.abs(s.chat + s.slot - s.row) < 1);
    assert.equal(s.body, 340);
    assert.equal(s.inert, true);
  }
  assert.equal(await page.getByLabel('面板草稿').inputValue(), '保留草稿');
  await page.evaluate(() => {
    toggle();
    window.setTimeout(toggle, 65);
  });
  await page.waitForFunction(
    () => opened && !document.querySelector('[data-dock-motion]') && last.status === 'open',
  );
  assert.equal(await page.evaluate(() => panel.firstChild === original && !panel.inert), true);
  await page.locator('#toggle').focus();
  await page.keyboard.press('Enter');
  assert.equal(
    await page.evaluate(
      () => last.status === 'closed' && !document.querySelector('[data-dock-motion]'),
    ),
    true,
  );
  await emulateMedia(page, { reducedMotion: 'reduce' });
  await page.locator('#toggle').click();
  assert.equal(
    await page.evaluate(
      () => last.status === 'open' && !document.querySelector('[data-dock-motion]'),
    ),
    true,
  );
  await emulateMedia(page, { reducedMotion: 'no-preference' });
  await page.locator('#toggle').click();
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.waitForFunction(
    () => last.status === 'closed' && !document.querySelector('[data-dock-motion]'),
  );
  await page.locator('#toggle').click();
  await page.evaluate(() => dock.destroy());
  await page.setViewportSize({ width: 1080, height: 780 });
  assert.equal(await page.locator('[data-palboo-dock]').count(), 0);
  assert.equal(await page.evaluate(() => panel.inert), false);
  assert.deepEqual(errors, []);
});
