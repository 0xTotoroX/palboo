/* [INPUT]: Current debug native window, production App entry and a synthetic local page/controller.
 * [OUTPUT]: Stable native controls throughout moves/resizes, App identity, minimize/reveal and zoom/fullscreen restore with unchanged draft/PID.
 * [POS]: Isolated temporary data and self-owned window, no screenshots or real host data.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { prepareTestBinary } from '../scripts/verify.mjs';
import { nativeApp } from './native-app.mjs';
const root = resolve(import.meta.dirname, '..'),
  dir = await mkdtemp(join(tmpdir(), 'buddy-window-controls-'));
const app = nativeApp(dir, prepareTestBinary('debug').binary);
const binary = join(app, 'Contents/MacOS/palboo');
const readyFile = join(dir, 'window.pid');
let latest,
  commands = [],
  child,
  nativePid;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (
  await build({
    stdin: {
      resolveDir: root,
      contents: `
import {windowControlsHtml,installWindowControls} from './ui/surfaces/workspace/window-controls.js';
document.body.innerHTML='<header>'+windowControlsHtml()+'</header><input id="draft" readonly tabindex="-1" value="未保存的合成草稿">';
let ready=false,returned=false,state=null;
const post=value=>window.ipc.postMessage(JSON.stringify(value));
window.__companionPopout={presented(){},motionFinished(){ready=true;},returned(ok){returned=ok;},resized(){},moved(){},dock(){returned=true;}};
const controller=installWindowControls(document.body,{post,dock:async()=>post({kind:'return',anchor:null}),error:e=>window.failure=String(e)});
const update=controller.update;controller.update=value=>{state=value;update(value);};
post({kind:'show',anchor:null});
async function poll(){
 try{const response=await fetch('/probe',{method:'POST',body:JSON.stringify({ready,returned,state,chromeProbe:window.__companionNativeChromeProbe,draft:document.querySelector('#draft').value,width:innerWidth,height:innerHeight,error:window.failure,webControls:document.querySelectorAll('[data-window-control]').length,transient:controller.geometryTransient()})});
 for(const action of await response.json()){
  if(action==='hide'||action==='reveal'||action==='window-state'||action==='native-chrome-probe')post({kind:action});
  else if(action==='close')post({kind:'close'});
  else if(action==='maximize')post({kind:'toggle-maximize'});
  else if(action==='fullscreen')post({kind:'native-fullscreen'});
  else post({kind:'native-window-button',button:action==='close-window'?'close':action});
 }
 }finally{setTimeout(poll,80)}
}poll();
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
  })
).outputFiles[0].text;
const html = `<!doctype html><meta charset="utf-8"><style>body{background:white;color:black;font-family:system-ui}button{width:32px;height:32px}svg{width:18px;height:18px}input{display:block;margin:20px}</style><script type="module">${js.replaceAll('</script', '<\\/script')}</script>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/probe') {
      let data = '';
      for await (const chunk of req) data += chunk;
      latest = JSON.parse(data);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(commands.splice(0)));
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    }
  } catch (error) {
    if (!req.aborted || error.code !== 'ECONNRESET') throw error;
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
async function wait(read, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (child?.exitCode !== null && child) throw Error('window exited');
    if (latest?.error) throw Error(latest.error);
    const value = read();
    if (value) return value;
    await delay(80);
  }
  throw Error(label + ': ' + JSON.stringify(latest));
}
function bounds() {
  return latest?.state?.visible && !latest.state.minimized ? latest.state.frame : undefined;
}
function near(a, b) {
  for (const k of ['X', 'Y', 'Width', 'Height'])
    assert.ok(Math.abs(a[k] - b[k]) <= 2, `${k} differs`);
}
function restored(original) {
  const current = bounds();
  return (
    current &&
    ['X', 'Y', 'Width', 'Height'].every((key) => Math.abs(current[key] - original[key]) <= 2)
  );
}
try {
  await writeFile(
    join(dir, 'runtime.json'),
    JSON.stringify({
      pid: process.pid,
      port: server.address().port,
      token: 'fixture',
      version: '0.9.0',
      executable: binary,
    }),
  );
  await writeFile(
    join(dir, 'panel.json'),
    JSON.stringify({
      alwaysOnTop: true,
      ui: { width: 500, height: 420 },
      position: { x: 240, y: 260 },
    }),
  );
  child = spawn(
    '/usr/bin/open',
    [
      '-n',
      '-W',
      '--env',
      'PALBOO_DEV_GENIE=0',
      '--env',
      `PALBOO_WINDOW_READY_FILE=${readyFile}`,
      app,
      '--args',
      '--palboo-window',
      binary,
      '--data-dir',
      dir,
      'panel-window',
      '--lease',
      'fixture',
    ],
    {
      stdio: 'pipe',
      env: { ...process.env, PALBOO_DEV_GENIE: '0' },
    },
  );
  await wait(
    () => latest?.ready && latest?.state && !latest.state.hidden && bounds(),
    'initial visible',
  );
  const original = bounds(),
    pid = latest.state.nativeChrome.processId;
  nativePid = pid;
  assert.equal(latest.state.nativeChrome.bundleIdentifier, 'local.palboo.launcher');
  assert.equal(
    latest.state.nativeChrome.bundlePath.replace(/^\/private/, ''),
    app.replace(/^\/private/, ''),
  );
  commands.push('window-state');
  await wait(
    () => latest?.state?.nativeChrome?.buttons.every((button) => button.enabled),
    'native controls enabled',
  );
  assert.equal(latest.webControls, 0, 'native window has no duplicate web buttons');
  assert.equal(latest.state.nativeChrome.activationPolicy, 0, 'normal app in Dock/Cmd+Tab');
  assert.equal(latest.state.nativeChrome.hasAppIcon, true);
  assert.equal(
    latest.state.nativeChrome.headerContentReachable,
    true,
    'native titlebar does not cover the pin button',
  );
  assert.equal(latest.state.nativeChrome.buttons.length, 3);
  for (const button of latest.state.nativeChrome.buttons) {
    assert.ok(
      button.visible && button.reachable && button.width > 0 && button.height > 0,
      JSON.stringify(button),
    );
    assert.ok(button.x >= 24 && button.x + button.width < 100, JSON.stringify(button));
    assert.ok(
      button.y >= 20 && button.y + button.height <= 48,
      'traffic lights fit the existing header: ' + JSON.stringify(button),
    );
  }
  const originalButtons = latest.state.nativeChrome.buttons;
  commands.push('native-chrome-probe');
  await wait(() => latest?.chromeProbe?.length === 25, 'continuous native move/resize');
  let maxChromeDrift = 0;
  for (const sample of latest.chromeProbe) {
    assert.equal(sample.headerContentReachable, true, 'window menu stays reachable during resize');
    assert.equal(sample.buttons.length, 3);
    for (const [index, button] of sample.buttons.entries()) {
      assert.ok(button.visible && button.reachable && button.enabled, JSON.stringify(button));
      for (const key of ['x', 'y', 'width', 'height']) {
        maxChromeDrift = Math.max(
          maxChromeDrift,
          Math.abs(button[key] - originalButtons[index][key]),
        );
        assert.ok(
          Math.abs(button[key] - originalButtons[index][key]) <= 0.5,
          `native ${key} must stay fixed during resize: ${JSON.stringify(button)}`,
        );
      }
    }
  }
  commands.push('minimize');
  await wait(() => latest?.state?.minimized && !bounds(), 'native yellow button minimizes');
  assert.equal(latest.transient, true, 'minimized geometry cannot overwrite normal size');
  execFileSync('/usr/bin/open', [app]);
  await wait(
    () => latest?.state && !latest.state.minimized && bounds(),
    'restore minimized window',
  );
  near(bounds(), original);
  commands.push('hide');
  await wait(() => latest?.state?.hidden && !bounds(), 'hidden');
  assert.equal(latest.draft, '未保存的合成草稿');
  execFileSync('/usr/bin/open', [app]);
  await wait(
    () => latest?.state && !latest.state.hidden && bounds(),
    'Dock reopen reveals existing window',
  );
  near(bounds(), original);
  commands.push('maximize');
  await wait(() => latest?.state?.maximized && bounds()?.Width > original.Width, 'maximized');
  await delay(600);
  const large = bounds();
  commands.push('hide');
  await wait(() => latest?.state?.hidden && !bounds(), 'maximized hidden');
  commands.push('reveal');
  await wait(() => latest?.state && !latest.state.hidden && bounds(), 'maximized revealed');
  await delay(300);
  near(bounds(), large);
  commands.push('maximize');
  await wait(() => latest?.state && !latest.state.maximized && restored(original), 'restored');
  near(bounds(), original);
  assert.equal(latest.draft, '未保存的合成草稿');
  assert.equal(latest.state.nativeChrome.processId, pid);
  commands.push('zoom');
  await wait(() => latest?.state?.maximized, 'native green button');
  await delay(800);
  commands.push('zoom');
  await wait(
    () =>
      latest?.state && !latest.state.maximized && !latest.state.fullscreen && restored(original),
    'restore native green action',
  );
  near(bounds(), original);
  commands.push('fullscreen');
  await wait(() => latest?.state?.fullscreen && latest?.transient, 'system fullscreen');
  await delay(800);
  commands.push('close-window');
  await wait(
    () => latest?.returned && !latest?.state?.fullscreen,
    'red button leaves fullscreen before return',
  );
  await wait(() => restored(original), 'normal frame after fullscreen');
  near(bounds(), original);
  for (const [index, button] of latest.state.nativeChrome.buttons.entries()) {
    assert.ok(
      button.visible && button.reachable && button.enabled,
      'restored native controls work',
    );
    assert.equal(button.x, originalButtons[index].x);
    assert.equal(button.y, originalButtons[index].y);
  }
  const result = {
    hideReveal: true,
    nativeTrafficLights: true,
    nativeResizeStable: true,
    nativeChromeSamples: latest.chromeProbe.length,
    nativeChromeMaxDrift: maxChromeDrift,
    nativeMinimize: true,
    nativeGreen: true,
    fullscreenReturn: true,
    registeredAppBundle: true,
    dockReopen: true,
    maximizeRestore: true,
    maximizedHideReveal: true,
    samePid: true,
    draftPreserved: true,
    positionRestored: true,
    returnAction: true,
    screenshots: false,
  };
  await mkdir(join(root, 'target/reports'), { recursive: true });
  await writeFile(
    join(root, 'target/reports/window-controls-native.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (!nativePid) nativePid = Number(await readFile(readyFile, 'utf8').catch(() => ''));
  if (child && child.exitCode === null) {
    if (nativePid) {
      try {
        process.kill(nativePid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    child.kill('SIGTERM');
    await new Promise((r) => {
      child.once('exit', r);
      setTimeout(r, 3000);
    });
  }
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
}
