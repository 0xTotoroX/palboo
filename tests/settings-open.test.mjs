/* [INPUT]: Real settings coordinator, request wrapper and launcher on a synthetic host.
 * [OUTPUT]: Shared requests, bounded waits, cancellation and visible failure feedback.
 * [POS]: No real host, credentials, models or screenshots.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const compiled = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
import {openSettings,cancelSettingsOpening} from './ui/codex/runtime/settings-sync.js';
import {runtimeState,bridgeCall} from './ui/codex/runtime/state.js';
import {INSTANCE_ID} from './ui/shared/constants.js';
import {syncLauncher,stopLauncher} from './ui/surfaces/embedded/launcher.js';
import {onSignal} from './ui/codex/runtime/signals.js';
window.__companionFloatingPanel={instanceId:INSTANCE_ID};
Object.assign(runtimeState,{runtimeActive:true,runtimeGeneration:1,destroyed:false});
Object.assign(window,{openSettings,cancelSettingsOpening,runtimeState,bridgeCall,stopLauncher});
window.requests=[];
window.__companionDesktopRequest=(path,payload,options)=>{window.requests.push({path,payload});return window.reply(options);};
window.reply=async()=>({error:'fixture backend unavailable'});
window.renderLauncher=()=>syncLauncher({open:false,root:null,click:()=>void openSettings(),pointerDown:()=>{},keyDown:()=>{},settings:()=>void openSettings(),settingsBrowser:()=>void openSettings(),settingsStatus:runtimeState.settingsOpenStatus,settingsBusy:runtimeState.settingsOpening,dismissSettingsStatus:()=>{runtimeState.settingsOpenStatus='';window.renderLauncher();},action:async()=>{const r=await openSettings();if(!r.ok&&!r.cancelled)throw Error(r.message);}});
onSignal('render',window.renderLauncher);window.renderLauncher();
`,
  },
  bundle: true,
  write: false,
  define: { PALBOO_DEVELOPMENT: 'true' },
});
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function fixture(t) {
  const page = await browser.newPage({
    viewport: { width: 900, height: 650 },
    reducedMotion: 'reduce',
  });
  t.after(() => page.close());
  await page.setContent(
    '<style>nav{display:flex;flex-direction:column;align-items:center;width:64px;height:500px;overflow:hidden}.thread-scroll-container{position:absolute;left:200px;top:20px;width:300px;height:300px}</style><nav class="group/sidebar-rail"><div style="flex:1"></div><button>Profile</button></nav><div data-conversation-id="fixture-A"><div class="thread-scroll-container">Synthetic chat</div></div>',
  );
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  return page;
}
test('backend failure is returned and visible for right-click, default click and menu; retry succeeds as a new request', async (t) => {
  const page = await fixture(t);
  const eye = page.getByRole('button', { name: 'Palboo', exact: true });
  await eye.click({ button: 'right' });
  const feedback = page.locator('.settings-feedback');
  await feedback.waitFor({ state: 'visible' });
  assert.match(await feedback.textContent(), /fixture backend unavailable/);
  const box = await feedback.boundingBox();
  assert.ok(box.width > 100 && box.x >= 0 && box.x + box.width <= 900);
  assert.equal(await eye.getAttribute('aria-busy'), 'false');
  await page.getByRole('button', { name: '关闭设置提示' }).click();
  assert.equal(await feedback.isVisible(), false);
  await eye.click();
  await feedback.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '关闭设置提示' }).click();
  await eye.focus();
  await eye.press('ArrowRight');
  await page.getByRole('menuitem', { name: '打开设置' }).click();
  await feedback.waitFor({ state: 'visible' });
  assert.match(await feedback.textContent(), /fixture backend unavailable/);
  assert.equal(await page.evaluate(() => window.requests.length), 3);
  assert.equal(await page.locator('[data-palboo-launcher-menu] [role="status"]').count(), 0);
  assert.equal(await page.locator('[data-palboo-launcher-menu]').getAttribute('data-open'), '');
  await page.getByRole('button', { name: '关闭设置提示' }).click();
  assert.equal(await feedback.isVisible(), false);
  assert.equal(await page.locator('[data-palboo-launcher] [title]').count(), 0);
});
test('concurrent callers share the same pending promise and receive the same failure', async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    window.reply = () => new Promise((resolve) => (window.complete = resolve));
    const a = window.openSettings(),
      b = window.openSettings();
    const shared = a === b;
    await Promise.resolve();
    await Promise.resolve();
    window.complete({ error: 'fixture shared failure' });
    return { shared, results: await Promise.all([a, b]), count: window.requests.length };
  });
  assert.equal(result.shared, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.results, [
    { ok: false, message: 'fixture shared failure' },
    { ok: false, message: 'fixture shared failure' },
  ]);
});
test('outer wrapper expires a legacy nonresponsive bridge and allows retry without waiting for generation timeout', async (t) => {
  const page = await fixture(t);
  await page.clock.install();
  await page.evaluate(() => {
    window.reply = () => new Promise((resolve) => (window.late = resolve));
    window.pending = window.openSettings();
  });
  await page.clock.runFor(10001);
  const result = await page.evaluate(() => window.pending);
  assert.match(result.message, /未收到响应/);
  assert.equal(await page.evaluate(() => window.runtimeState.settingsOpening), false);
  assert.deepEqual(
    await page.evaluate(async () => {
      window.reply = async () => ({ error: 'fixture retry' });
      const r = await window.openSettings();
      window.late({ status: 'ok', target: 'web', url: 'http://127.0.0.1:12345/' });
      return r;
    }),
    { ok: false, message: 'fixture retry' },
  );
  assert.equal(await page.evaluate(() => window.requests.length), 2);
});
test('cancel aborts the underlying bridge, releases shared state and prevents late success', async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    window.reply = ({ signal }) =>
      new Promise((resolve) => {
        window.complete = resolve;
        signal.addEventListener('abort', () => (window.aborted = true));
      });
    const pending = window.openSettings();
    await Promise.resolve();
    await Promise.resolve();
    window.cancelSettingsOpening();
    window.runtimeState.runtimeGeneration++;
    const cancelled = await pending;
    window.complete({ status: 'ok', target: 'web', url: 'http://127.0.0.1:12345/' });
    await Promise.resolve();
    return { cancelled, aborted: window.aborted, status: window.runtimeState.settingsOpenStatus };
  });
  assert.deepEqual(result, {
    cancelled: { ok: false, cancelled: true },
    aborted: true,
    status: '',
  });
});
test('chat switch while backend responds cannot open browser on the new chat', async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    window.reply = () => new Promise((resolve) => (window.complete = resolve));
    const pending = window.openSettings();
    await Promise.resolve();
    await Promise.resolve();
    document
      .querySelector('[data-conversation-id]')
      .setAttribute('data-conversation-id', 'fixture-B');
    window.complete({ status: 'ok', target: 'web', url: 'http://127.0.0.1:12345/' });
    return pending;
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /聊天正在切换/);
});
