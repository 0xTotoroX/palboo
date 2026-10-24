/*
 * [INPUT]: 已构建的 palboo、真实通用功能页面和隔离 loopback fixture。
 * [OUTPUT]: target/reports/edge-native 的跨桌面策略/几何/焦点/租约证据及可选截图。
 * [POS]: 只创建本工具合成窗口；不连接、读取或重启官方宿主。运行前 cargo build --locked。
 * [PROTOCOL]: 由集成任务同步 tests/AGENTS.md。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

if (process.platform !== 'darwin') throw Error('Native edge acceptance requires macOS');
const root = resolve(import.meta.dirname, '..');
let screenshots = process.argv.includes('--screenshots');
const binaryIndex = process.argv.indexOf('--binary');
const binary =
  binaryIndex < 0 ? join(root, 'target/debug/palboo') : resolve(process.argv[binaryIndex + 1]);
const dir = mkdtempSync(join(tmpdir(), 'buddy-model-control-'));
const output = join(root, 'target/reports/edge-native');
mkdirSync(output, { recursive: true });
const geometryProbe = join(dir, 'geometry-probe');
const inputProbe = join(dir, 'input-probe');
execFileSync('swiftc', [join(root, 'tests/native-probe.swift'), '-o', geometryProbe]);
execFileSync('swiftc', [join(root, 'tests/model-control-probe.swift'), '-o', inputProbe]);
const environment = JSON.parse(execFileSync(inputProbe, ['state'], { encoding: 'utf8' }));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const prefs = {
  enabled: true,
  theme: 'black',
  liquidVariant: 'regular',
  edge: 'right',
  position: 0.5,
  screen: '',
  keepOpen: false,
  modelColumnWidth: 144,
  pinned: ['fixture-a'],
  presets: [],
};
const snapshot = {
  status: 'ready',
  target: { id: 'native-fixture', title: '原生控窗 · 合成任务' },
  revision: 'fixture-1',
  generating: false,
  current: { model: 'fixture-a', reasoning: 'high', speed: 'standard' },
  models: [
    {
      id: 'fixture-a',
      label: 'Fixture Alpha',
      reasoning: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      fast: true,
    },
    { id: 'fixture-b', label: 'Fixture Beta', reasoning: ['medium', 'high'], fast: false },
  ],
};
const appearance = {
  material: 'matte',
  liquidVariant: 'regular',
  fontOffset: 0,
  hostTheme: {
    theme: 'light',
    colors: {
      'surface-opaque': 'rgb(245, 239, 230)',
      text: 'rgb(30, 35, 40)',
      accent: 'rgb(172, 73, 201)',
    },
  },
};
let valid = true,
  reveal = 0,
  revision = 1,
  telemetry = null,
  queue = [],
  sequence = 0;
let extraFeature = false;
let edgeTabs = { order: [], selected: '' },
  edgeTabsRevision = 0;
let child,
  stderr = '',
  commandResult = new Map();
const report = {
  environment,
  pointerInputs: [],
  checks: [],
  skipped: [
    ...(!screenshots
      ? [
          {
            name: 'screen capture',
            reason: 'Disabled by default; --screenshots requires an explicit screenshot request',
          },
        ]
      : []),
    {
      name: 'real Spaces and full-screen transitions',
      reason:
        'Native all-Spaces/full-screen flags and host-independent visibility are checked; actual Mission Control and full-screen transitions require manual acceptance',
    },
    ...(!environment.canPostEvents
      ? [
          {
            name: 'real mouse hover',
            reason:
              'CGPreflightPostEventAccess=false; native pointer messages are tested synthetically',
          },
        ]
      : []),
    {
      name: 'global shortcut dispatch and toggle',
      reason: 'Carbon registration is observed; real keyboard dispatch is not exercised',
    },
    ...(!environment.canPostEvents
      ? [
          {
            name: 'real mouse first click',
            reason: 'CGPreflightPostEventAccess=false; no permission is requested',
          },
        ]
      : []),
    ...(!environment.screens.some((s) => s.notchWidth > 0)
      ? [
          {
            name: 'physical notch on native hardware',
            reason: 'Connected screens have no hardware notch; geometry has separate Rust coverage',
          },
        ]
      : []),
  ],
  screenshots: [],
  errors: [],
};
let hostPresence = { visible: false, focused: false };
let windowPolls = 0;
const envelope = () => ({ preferences: prefs, snapshot, revision });

// Probe code is served only by this synthetic backend, never added to a product page/build.
function probePage() {
  const send = window.ipc.postMessage.bind(window.ipc);
  window.heldScenes = [];
  let holdScenes = true;
  window.fixturePostMessage = (raw) => {
    if (holdScenes && JSON.parse(raw).action === 'scene-ready') window.heldScenes.push(raw);
    else send(raw);
  };
  window.releaseScenes = () => {
    holdScenes = false;
    for (const raw of window.heldScenes.splice(0)) send(raw);
  };
  const dispatch = window.dispatchEvent.bind(window);
  window.fixturePointer = (detail) => dispatch(new CustomEvent('edge-pointer', { detail }));
  window.dispatchEvent = (event) => {
    if (window.ignoreNativePointer && event.type === 'edge-pointer') return true;
    if (window.deferNative && event.type === 'edge-native') {
      window.delayedNative = event.detail;
      return true;
    }
    return dispatch(event);
  };

  let native = null,
    nativeEvents = 0,
    keyboardActivations = 0,
    sample = 0,
    busy = false,
    pointerDown = null,
    pointer = null;
  const errors = [];
  const motion = [];
  window.resetMotion = () => {
    motion.length = 0;
  };
  let lastFrame = 0;
  function frame(now) {
    if (window.recordMotion && native?.animating && lastFrame) {
      motion.push({ theme: native.theme, dt: now - lastFrame });
      if (motion.length > 1200) motion.shift();
    }
    lastFrame = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('error', (event) => errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  window.addEventListener('edge-pointer', (event) => {
    pointer = event.detail;
  });
  window.addEventListener('edge-native', (event) => {
    if (event.detail.keyboard && !native?.keyboard) keyboardActivations++;
    native = event.detail;
    nativeEvents++;
  });
  window.addEventListener(
    'pointerdown',
    (event) => {
      pointerDown = {
        serial: (pointerDown?.serial || 0) + 1,
        trusted: event.isTrusted,
        target: event.target?.id,
        tag: event.target?.tagName,
        tab: event.target?.closest?.('[data-edge-tab]')?.dataset.edgeTab,
        client: [event.clientX, event.clientY],
      };
    },
    true,
  );
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/native-probe', {
        method: 'POST',
        body: JSON.stringify({
          sample: ++sample,
          native,
          nativeEvents,
          heldScenes: window.heldScenes.length,
          delayedNative: window.delayedNative,
          clip: getComputedStyle(document.getElementById('edge-panel')).clipPath,
          motion,
          keyboardActivations,
          errors,
          pointerDown,
          pointer,
          selectedFeature: document.querySelector('[data-edge-tab][aria-pressed="true"]')?.dataset
            .edgeTab,
          availableFeatures: [...document.querySelectorAll('[data-edge-tab]')].map(
            (n) => n.dataset.edgeTab,
          ),
          background: getComputedStyle(document.getElementById('edge-panel')).backgroundColor,
          handleBackground: getComputedStyle(document.getElementById('edge-handle'))
            .backgroundColor,
          hasFocus: document.hasFocus(),
          active: document.activeElement?.id,
          path: location.pathname,
          viewport: [innerWidth, innerHeight],
          searchRect: document
            .querySelector('#edge-panel nav button')
            ?.getBoundingClientRect()
            .toJSON(),
          modelView: (() => {
            const root = document.querySelector('.edge-view')?.shadowRoot;
            const handle = root?.querySelector('.model-column-resize');
            const divider = root?.querySelector('.model-section-divider');
            return {
              outline: handle ? getComputedStyle(handle).outlineStyle : null,
              picker: root?.querySelector('[data-model-picker]')?.getAttribute('aria-expanded'),
              groups: root?.querySelectorAll('[data-model-group]').length,
              rows: root?.querySelectorAll('.model-row').length,
              divider: divider ? getComputedStyle(divider).borderTopWidth : null,
              editing: root?.activeElement?.matches('input[aria-label="预设名称"]') || false,
              presetCount: root?.querySelectorAll('.model-preset-tag').length,
            };
          })(),
          columnWidth: document
            .querySelector('.edge-view')
            ?.shadowRoot?.querySelector('.model-column-resize')
            ?.getAttribute('data-column-width'),
          columnMax: document
            .querySelector('.edge-view')
            ?.shadowRoot?.querySelector('.model-column-resize')
            ?.getAttribute('data-column-max'),
          featureVisible: !!document
            .querySelector('.edge-view')
            ?.shadowRoot?.querySelector('[data-feature="model"]'),
        }),
      });
      for (const command of await response.json()) {
        let result;
        try {
          result = { value: await (0, eval)(command.code) };
        } catch (error) {
          result = { error: String(error) };
        }
        await fetch('/native-result', {
          method: 'POST',
          body: JSON.stringify({ id: command.id, ...result }),
        });
      }
    } finally {
      busy = false;
    }
  }, 80);
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  let body = '';
  for await (const chunk of request) body += chunk;
  const json = (value, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  if (path === '/native-probe') {
    telemetry = JSON.parse(body);
    return json(queue.splice(0));
  }
  if (path === '/native-result') {
    const result = JSON.parse(body);
    commandResult.set(result.id, result);
    return json({});
  }
  if (path.startsWith('/api/')) {
    if (request.headers.authorization !== 'Bearer native-fixture-token') return json({}, 401);
    const input = body ? JSON.parse(body) : {};
    if (path === '/api/surfaces') {
      if (input.op === 'save') {
        Object.assign(prefs, input.edge);
        revision++;
        return json({});
      }
      windowPolls++;
      return json({ valid, preferences: prefs, reveal, appearance });
    }
    if (path === '/api/features') {
      const feature = {
        id: 'model',
        owner: 'feature-lease',
        placement: 'edge',
        open: true,
        size: [840, 620],
        view: {},
        reveal: 1,
        pending: null,
      };
      const visual = {
        theme: appearance.hostTheme.theme,
        surface: { theme: prefs.theme, liquidVariant: prefs.liquidVariant },
      };
      if (input.op === 'read')
        return json(
          input.id === 'next'
            ? {
                appearance: visual,
                snapshot: {
                  settings: { enabled: true, generationMode: 'manual', quickPrompts: [] },
                  prompts: [{ label: '检查合成功能切换', prompt: '仅用于本机测试' }],
                  scanBusy: false,
                  scanStatus: 'ready',
                  bridgeStatus: 'ok',
                  display: { labelOnly: true },
                },
              }
            : { ...envelope(), appearance: visual },
        );
      if (input.op === 'edge-tabs') {
        assert.deepEqual(input.expected, edgeTabs);
        edgeTabs = input.tabs;
        edgeTabsRevision++;
      }
      if (input.op === 'action' && input.action === 'preferences') {
        assert.equal(input.owner, 'feature-lease');
        assert.equal(input.data.revision, revision);
        assert.ok(
          Object.keys(input.data.patch).every((key) =>
            ['modelColumnWidth', 'pinned', 'expandedGroups'].includes(key),
          ),
        );
        Object.assign(prefs, input.data.patch);
        revision++;
        return json(envelope());
      }
      return json({
        features: [
          feature,
          ...(extraFeature ? [{ ...feature, id: 'next', owner: 'next-lease', reveal: 0 }] : []),
        ],
        edgeTabs,
        edgeTabsRevision,
      });
    }
    return json({});
  }
  if (path === '/feature.html') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    return response.end(
      readFileSync(join(root, 'target/web/feature.html'), 'utf8').replace(
        '</head>',
        `<script>(${probePage.toString()})()</script></head>`,
      ),
    );
  }
  if (path.startsWith('/assets/') && !path.includes('..')) {
    response.writeHead(200, {
      'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript',
    });
    let source = readFileSync(join(root, 'target/web', path), 'utf8');
    if (path.endsWith('.js'))
      source = source.replace(
        /(?:window\.)?[\w$]+\.postMessage\(JSON.stringify\(([\w$]+)\)\)/g,
        'window.fixturePostMessage(JSON.stringify($1))',
      );
    return response.end(source);
  }
  response.writeHead(404);
  response.end();
});

async function until(predicate, label, timeout = 9000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    if (predicate()) return;
    if (child?.exitCode !== null && child?.exitCode !== undefined)
      throw Error(`${label}: child exited ${child.exitCode}: ${stderr}`);
    await delay(60);
  }
  throw Error(`${label}: timed out; ${JSON.stringify(telemetry)}; ${stderr}`);
}
async function command(code) {
  const id = ++sequence;
  queue.push({ id, code });
  await until(() => commandResult.has(id), 'probe command');
  const result = commandResult.get(id);
  commandResult.delete(id);
  if (result.error) throw Error(result.error);
  return result.value;
}
const ipc = (value) => command(`window.ipc.postMessage(${JSON.stringify(JSON.stringify(value))})`);
function windowInfo() {
  const rows = JSON.parse(
    execFileSync(geometryProbe, ['windows', String(child.pid)], { encoding: 'utf8' }),
  );
  return rows
    .filter((row) => row.kCGWindowLayer === 25)
    .sort(
      (a, b) =>
        b.kCGWindowBounds.Width * b.kCGWindowBounds.Height -
        a.kCGWindowBounds.Width * a.kCGWindowBounds.Height,
    )[0];
}
function pointerInput(action, point) {
  const evidence = JSON.parse(
    execFileSync(inputProbe, [action, ...point.map(String)], { encoding: 'utf8' }),
  );
  report.pointerInputs.push({ action, ...evidence });
}
async function leaveEdge() {
  const b = windowInfo().kCGWindowBounds;
  const screen = environment.screens.find(
    (s) =>
      b.X + b.Width / 2 >= s.x &&
      b.X + b.Width / 2 < s.x + s.width &&
      b.Y + b.Height / 2 >= s.y &&
      b.Y + b.Height / 2 < s.y + s.height,
  );
  assert.ok(screen, 'test window belongs to a connected screen');
  const point = [
    [screen.x + 24, screen.y + 24],
    [screen.x + screen.width - 24, screen.y + screen.height - 24],
  ].find(([x, y]) => x < b.X || x >= b.X + b.Width || y < b.Y || y >= b.Y + b.Height);
  assert.ok(point, 'a real pointer exit is available on the same screen');
  pointerInput('move', point);
  await until(
    () =>
      telemetry.pointer?.inside === false &&
      telemetry.pointer.buttons === 0 &&
      !telemetry.pointer.hoverSuppressed,
    'real pointer leaves and re-arms hover',
  );
}
function enterEdge() {
  const b = windowInfo().kCGWindowBounds;
  pointerInput('move', [
    b.X + telemetry.native.compactX + telemetry.native.compactWidth / 2,
    b.Y + telemetry.native.compactY + telemetry.native.compactHeight / 2,
  ]);
}
async function clickNativeElement(expression) {
  // Switching content can move the header and leave the cursor outside; reacquire the real panel.
  enterEdge();
  let previousSample = 0,
    previousFrame = '',
    stableSamples = 0;
  await until(() => {
    if (telemetry.sample === previousSample) return false;
    previousSample = telemetry.sample;
    const frame = JSON.stringify([telemetry.native.sceneRevision, telemetry.viewport]);
    stableSamples = frame === previousFrame ? stableSamples + 1 : 0;
    previousFrame = frame;
    return (
      telemetry.native.expanded &&
      !telemetry.native.animating &&
      telemetry.pointer?.inside &&
      stableSamples >= 2
    );
  }, 'native click target has settled after expansion and content resize');
  const point = await command(
    `(() => { const r = (${expression})?.getBoundingClientRect(); return r ? [r.x+r.width/2,r.y+r.height/2] : null })()`,
  );
  assert.ok(point, 'native click target exists');
  const bounds = windowInfo().kCGWindowBounds;
  const previousDown = telemetry.pointerDown?.serial || 0;
  pointerInput('click', [bounds.X + point[0], bounds.Y + point[1]]);
  await until(() => telemetry.pointerDown?.serial > previousDown, 'real pointerdown is received');
  report.pointerInputs.at(-1).target = {
    expression,
    point,
    bounds,
    received: telemetry.pointerDown,
  };
}
async function capture(name) {
  if (!screenshots) return;
  const info = windowInfo();
  const path = join(output, `${name}.png`);
  try {
    await new Promise((resolve, reject) =>
      execFile('screencapture', ['-x', '-l', String(info.kCGWindowNumber), path], (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    report.screenshots.push(path);
  } catch (error) {
    screenshots = false; // A failed capture must not trigger another permission prompt.
    report.screenshots.push({ name, unavailable: error.message });
  }
}
function check(name, detail = telemetry?.native) {
  report.checks.push({ name, status: 'passed', detail });
}
function start() {
  telemetry = null;
  child = spawn(binary, ['--data-dir', dir, 'edge-window', '--lease', 'native-fixture-lease'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
}
async function exited(label) {
  await Promise.race([
    once(child, 'exit'),
    delay(7000).then(() => {
      throw Error(`${label}: process did not exit`);
    }),
  ]);
  assert.equal(child.exitCode, 0, stderr);
  check(label, { exitCode: child.exitCode });
}

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  writeFileSync(
    join(dir, 'runtime.json'),
    JSON.stringify({
      pid: process.pid,
      port: server.address().port,
      token: 'native-fixture-token',
      version: 'fixture',
      executable: binary,
    }),
  );
  start();
  await until(() => telemetry?.heldScenes > 0, 'initial scene laid out while presentation is held');
  assert.equal(telemetry.native.painted, false);
  assert.ok(!windowInfo() || windowInfo().kCGWindowAlpha === 0);
  await ipc({ action: 'scene-ready', revision: telemetry.native.sceneRevision - 1 });
  await delay(150);
  assert.equal(telemetry.native.painted, false);
  assert.ok(!windowInfo() || windowInfo().kCGWindowAlpha === 0);
  await command('window.releaseScenes()');
  await until(
    () =>
      telemetry?.native?.painted &&
      telemetry.native.shell.width === 10 &&
      telemetry.native.shell.height === 80,
    'initial compact',
  );
  assert.equal(telemetry.native.expanded, false);
  assert.equal(telemetry.native.keyboard, false);
  const initial = windowInfo();
  const preparedWidth = initial.kCGWindowBounds.Width;
  assert.equal(preparedWidth, telemetry.native.layoutWidth);
  // Intrinsic model content can use 976px, plus the edge shell's 12px padding per side.
  assert.ok(preparedWidth >= 320 && preparedWidth <= 1000);
  assert.deepEqual(telemetry.viewport, [preparedWidth, initial.kCGWindowBounds.Height]);
  check('initial painted compact shell has a prepared stable viewport', initial.kCGWindowBounds);
  check('initial presentation waits for current scene and rejects stale paint acknowledgements');
  assert.equal(telemetry.native.allSpaces, true);
  assert.equal(telemetry.native.fullScreenAuxiliary, true);
  const screen = telemetry.native.screen;
  check('all-Spaces panel starts without host focus or visibility', initial.kCGWindowBounds);
  for (const presence of [
    { visible: true, focused: true },
    { visible: true, focused: false },
    { visible: false, focused: false },
    null,
  ]) {
    hostPresence = presence;
    const before = windowPolls;
    await until(() => windowPolls > before + 1, 'host presence consumed');
    assert.ok(windowInfo(), 'Host presence must not hide the display control');
    assert.equal(telemetry.native.screen, screen);
    assert.equal(telemetry.native.keyboard, false);
    assert.equal(telemetry.native.expanded, false);
  }
  const focusActivations = telemetry.keyboardActivations;
  await ipc({ action: 'focus' });
  // 检查已送达的焦点转换；其他应用可随即取回前台，不能要求最后一帧一直占有焦点。
  await until(() => telemetry.keyboardActivations > focusActivations, 'focus without host');
  check(
    'host hide, blur and disconnect preserve display placement; explicit focus remains available',
  );
  await ipc({ action: 'collapse' });
  await until(() => !telemetry.native.expanded && !telemetry.native.animating, 'restore compact');
  // Real input must leave the native hover region; a DOM event cannot clear native suppression.
  if (environment.canPostEvents) await leaveEdge();
  else
    await command(
      'window.ignoreNativePointer = true; window.fixturePointer({inside:false,buttons:0,hoverSuppressed:false})',
    );
  hostPresence = { visible: true, focused: true };

  if (environment.canPostEvents) {
    enterEdge();
  } else {
    await command('window.fixturePointer({inside:true,buttons:0,hoverSuppressed:false})');
  }
  await until(
    () => telemetry.native.expanded && telemetry.native.animating,
    'unfold starts immediately',
  );
  assert.ok(telemetry.native.unfold > 0 && telemetry.native.unfold < 1);
  const intermediate = windowInfo().kCGWindowBounds;
  assert.equal(intermediate.Width, preparedWidth);
  assert.ok(telemetry.native.shell.width > 10 && telemetry.native.shell.width < preparedWidth);
  assert.ok(
    Math.abs(telemetry.native.shell.x + telemetry.native.shell.width - preparedWidth) < 0.001,
  );
  await capture('unfold-middle');
  check('native contour unfolds against a fixed screen edge inside a stable window');
  await until(() => telemetry.native.expanded && !telemetry.native.animating, 'unfold settles');
  assert.equal(telemetry.native.keyboard, false);
  assert.notEqual(
    JSON.parse(execFileSync(inputProbe, ['state'], { encoding: 'utf8' })).frontmost,
    child.pid,
    'hover must not activate the edge process; the user may switch other apps',
  );
  check(
    environment.canPostEvents
      ? 'real native hover expands without stealing focus'
      : 'synthetic native pointer message expands without stealing focus',
  );
  assert.equal(telemetry.featureVisible, true);
  assert.equal(telemetry.modelView.picker, 'false');
  assert.equal(telemetry.modelView.groups, 0);
  assert.equal(telemetry.modelView.divider, null);
  check('native model view defaults to favorites with a borderless collapsed picker');
  if (environment.canPostEvents) {
    extraFeature = true;
    await command(
      "window.keptModel = document.querySelector('.edge-view').shadowRoot.querySelector('.model-row'); true",
    );
    await until(
      () => telemetry.availableFeatures.includes('next'),
      'second feature becomes available',
    );
    assert.equal(telemetry.selectedFeature, 'model');
    for (const id of ['next', 'model', 'next', 'model']) {
      await clickNativeElement(`document.querySelector('[data-edge-tab="${id}"]')`);
      await until(
        () =>
          telemetry.selectedFeature === id &&
          edgeTabs.selected === id &&
          !telemetry.native.animating,
        'real feature tab click and persisted selection',
      );
      assert.ok(
        await command('window.keptModel.isConnected'),
        'switching preserves mounted model content',
      );
      assert.equal(telemetry.pointerDown?.trusted, true);
    }
    check('real clicks switch next/model repeatedly and preserve the mounted content', {
      selected: edgeTabs.selected,
    });
    for (let cycle = 0; cycle < 3; cycle++) {
      await leaveEdge();
      await until(
        () => !telemetry.native.expanded && !telemetry.native.animating,
        'real pointer exit collapses edge',
      );
      enterEdge();
      await until(
        () => telemetry.native.expanded && !telemetry.native.animating,
        'real pointer reentry expands edge',
      );
      assert.equal(telemetry.selectedFeature, 'model');
    }
    check('three real hover leave/reenter cycles preserve the selected feature');
    const modelRoot = "document.querySelector('.edge-view').shadowRoot";
    prefs.presets = [
      { id: 'editor-fixture', name: '编辑保护测试', selection: { ...snapshot.current } },
    ];
    revision++;
    await until(() => telemetry.modelView.presetCount === 1, 'editor fixture is visible');
    await clickNativeElement(`${modelRoot}.querySelector('[aria-label="编辑预设"]')`);
    await clickNativeElement(`${modelRoot}.querySelector('.model-preset-choice')`);
    await until(() => telemetry.modelView.editing, 'real preset click focuses the editor');
    await leaveEdge();
    await delay(700);
    assert.equal(
      telemetry.native.expanded,
      true,
      'editing holds the panel open after real pointer exit',
    );
    assert.equal(telemetry.modelView.editing, true);
    await clickNativeElement(`${modelRoot}.querySelector('[aria-label="取消"]')`);
    await until(() => !telemetry.modelView.editing, 'cancel keeps stored presets unchanged');
    assert.equal(prefs.presets[0].name, '编辑保护测试');
    prefs.presets = [];
    revision++;
    await until(() => telemetry.modelView.presetCount === 0, 'remove editor fixture');
    await leaveEdge();
    await until(
      () => !telemetry.native.expanded && !telemetry.native.animating,
      'cancelled editor no longer holds pointer interaction',
    );
    enterEdge();
    await until(
      () => telemetry.native.expanded && !telemetry.native.animating,
      'reopen after editing',
    );
    check(
      'real editor clicks protect drafts on pointer exit and cancellation restores hover collapse',
    );
    await clickNativeElement('document.querySelector(\'[data-edge-tab="model"]\')');
    await command(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})); true",
    );
    await leaveEdge();
    await delay(700);
    assert.equal(telemetry.native.expanded, true, 'keyboard navigation remains protected');
    check('keyboard intent still holds the native panel open after pointer exit');
    // Match the original fixture's non-key hover state before the remaining focus checks.
    await ipc({ action: 'collapse' });
    await until(
      () => !telemetry.native.expanded && !telemetry.native.animating,
      'collapse after real tab clicks',
    );
    await leaveEdge();
    enterEdge();
    await until(
      () => telemetry.native.expanded && !telemetry.native.animating,
      'restore hover-only state',
    );
    extraFeature = false;
    edgeTabs = { order: [], selected: '' };
    edgeTabsRevision++;
    await until(() => telemetry.availableFeatures.length === 1, 'restore one-feature fixture');
  }
  const favoriteHeight = telemetry.native.layoutHeight;
  await command(
    "document.querySelector('.edge-view').shadowRoot.querySelector('[data-model-picker]').click()",
  );
  await until(
    () => telemetry.modelView.picker === 'true' && telemetry.modelView.groups === 1,
    'native chooser opens',
  );
  assert.equal(
    telemetry.native.layoutHeight,
    favoriteHeight,
    'opening all models does not resize the native frame',
  );
  await command(
    "document.querySelector('.edge-view').shadowRoot.querySelector('[data-model-tile=fixture-b]').click()",
  );
  await until(
    () => prefs.pinned.includes('fixture-b') && telemetry.modelView.rows === 2,
    'native tile adds favorite',
  );
  assert.equal(telemetry.modelView.groups, 1, 'picker stays open with all models');
  await command(
    'document.querySelector(\'#edge-panel > header [aria-label="关闭所有模型"]\').click()',
  );
  prefs.pinned = ['fixture-a'];
  revision++;
  await until(
    () =>
      telemetry.modelView.picker === 'false' &&
      telemetry.modelView.rows === 1 &&
      telemetry.native.layoutHeight === favoriteHeight,
    'restore native favorite fixture',
  );
  check('native all-model tiles preserve the catalog and close explicitly');

  await capture('expanded');
  const shortHeight = telemetry.native.layoutHeight;
  snapshot.models.push({
    id: 'fixture-c',
    label: 'Fixture Gamma',
    reasoning: ['high'],
    fast: false,
  });
  prefs.pinned.push('fixture-b', 'fixture-c');
  revision++;
  await until(
    () => telemetry.native.layoutHeight > shortHeight,
    'content grows for more model rows',
  );
  prefs.pinned.splice(1);
  snapshot.models.pop();
  revision++;
  await until(
    () => telemetry.native.layoutHeight === shortHeight,
    'content shrinks when models are hidden',
  );
  // 此阶段只验列宽，避免测试期间鼠标离开触发独立的自动收起逻辑。
  prefs.keepOpen = true;
  revision++;
  await ipc({ action: 'focus' });
  await until(
    () => telemetry.native.keepOpen && telemetry.native.expanded && !telemetry.native.animating,
    'hold column-resize fixture open',
  );
  const columnBounds = windowInfo().kCGWindowBounds;
  const originalColumn = prefs.modelColumnWidth;
  for (const width of [100, 200, 560, originalColumn]) {
    prefs.modelColumnWidth = width;
    revision++;
    await until(
      () => Number(telemetry.columnWidth) === Math.min(width, Number(telemetry.columnMax)),
      'model column readback',
    );
    assert.deepEqual(
      windowInfo().kCGWindowBounds,
      columnBounds,
      'column width must not move or resize the native frame',
    );
    assert.equal(
      await command(`(() => {
      const root = document.querySelector('.edge-view').shadowRoot;
      const fast = document.querySelector('#edge-panel > header .model-fast').getBoundingClientRect();
      const line = root.querySelector('.model-column-resize').getBoundingClientRect();
      return Math.abs(fast.x + fast.width / 2 - line.x - line.width / 2) < 1 && fast.bottom <= line.y;
    })()`),
      true,
      'native Fast is aligned above the independent divider',
    );
    assert.equal(telemetry.native.layoutWidth, preparedWidth);
    assert.ok(
      Math.abs(telemetry.native.layoutX + telemetry.native.layoutWidth - telemetry.viewport[0]) < 1,
      'content remains flush with the right window edge',
    );
  }
  check(
    'model columns stay inside a fixed native frame and preserve the screen-edge anchor',
    columnBounds,
  );
  if (environment.canPostEvents) {
    const handle = await command(`(() => {
      const node = document.querySelector('.edge-view').shadowRoot.querySelector('.model-column-resize');
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + 12, value: Number(node.getAttribute('data-column-width')), max: Number(node.getAttribute('data-column-max')) };
    })()`);
    const amount = Math.min(24, handle.max - handle.value);
    assert.ok(amount > 0, 'fixture has room for an internal resize');
    const sampler = spawn(geometryProbe, ['motion', String(child.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let samples = '';
    sampler.stdout.on('data', (chunk) => {
      samples += chunk;
    });
    try {
      await until(() => samples.includes('\n'), 'native geometry sampler');
      await new Promise((resolve, reject) =>
        execFile(
          geometryProbe,
          [
            'drag',
            String(columnBounds.X + handle.x),
            String(columnBounds.Y + handle.y),
            String(columnBounds.X + handle.x + amount),
            String(columnBounds.Y + handle.y),
            String(child.pid),
          ],
          { timeout: 8000 },
          (error) => (error ? reject(error) : resolve()),
        ),
      );
      await until(
        () => prefs.modelColumnWidth === handle.value + amount,
        'native pointer drag saves column',
      );
      assert.deepEqual(windowInfo().kCGWindowBounds, columnBounds);
      assert.equal(
        telemetry.modelView.outline,
        'none',
        'native divider drag has no blue focus rectangle',
      );
      const frames = samples
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      for (const frame of frames)
        assert.deepEqual(
          frame.bounds,
          columnBounds,
          'native frame remains fixed throughout pointer drag',
        );
      check('real native pointer drag moves only the divider and leaves no screen-edge gap', {
        frames: frames.length,
        amount,
      });
    } finally {
      sampler.kill('SIGTERM');
    }
    prefs.modelColumnWidth = originalColumn;
    revision++;
    await until(
      () => Number(telemetry.columnWidth) === originalColumn,
      'restore native test column',
    );
  } else {
    report.skipped.push({
      name: 'native column pointer drag',
      reason: 'Event posting unavailable; geometry and bounds verified through preference updates',
    });
  }

  const savedModels = structuredClone(snapshot.models),
    savedPinned = [...prefs.pinned];
  const longFavorites = Array.from({ length: 5 }, (_, index) => ({
    id: `long-${index}`,
    label: `Claude-long-model-name-${index} · WorkBuddy`,
    reasoning: ['low', 'high'],
    fast: false,
  }));
  snapshot.models.push(...longFavorites);
  prefs.pinned = longFavorites.map((m) => m.id);
  prefs.modelColumnWidth = 245;
  revision++;
  await until(
    () => Number(telemetry.columnWidth) === 245 && telemetry.native.layoutHeight > shortHeight,
    'native long favorites fixture',
  );
  const longBounds = windowInfo().kCGWindowBounds;
  const wideColumnHeight = telemetry.native.layoutHeight;
  prefs.modelColumnWidth = 100;
  revision++;
  await until(
    () => Number(telemetry.columnWidth) === 100 && telemetry.native.layoutHeight > wideColumnHeight,
    'narrow long favorite names expand the panel height',
  );
  const overflow = await command(`(() => {
    const root = document.querySelector('.edge-view').shadowRoot;
    const list = root.querySelector('.model-favorites');
    const last = root.querySelector('[data-model-row="long-4"] .model-choices').getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    return {scrollable: list.scrollHeight > list.clientHeight + 1,
      lastVisible: last.top >= viewport.top && last.bottom <= viewport.bottom};
  })()`);
  const narrowBounds = windowInfo().kCGWindowBounds;
  assert.equal(narrowBounds.Width, longBounds.Width);
  assert.equal(narrowBounds.X, longBounds.X);
  assert.ok(
    !overflow.scrollable && overflow.lastVisible,
    'native long favorites are fully visible without internal scrolling',
  );
  check('native narrow column grows the panel to show every favorite', overflow);
  snapshot.models = savedModels;
  prefs.pinned = savedPinned;
  prefs.modelColumnWidth = originalColumn;
  revision++;
  await until(
    () =>
      telemetry.native.layoutHeight === shortHeight &&
      Number(telemetry.columnWidth) === originalColumn,
    'restore native long-name fixture',
  );

  // 保持展开直到延迟接收场景开始，避免鼠标离开先触发收起。显式 collapse 会恢复 keepOpen=false。
  const stableBounds = windowInfo().kCGWindowBounds;
  await command('window.deferNative = true');
  await ipc({ action: 'collapse' });
  await until(
    () =>
      telemetry.delayedNative &&
      !telemetry.delayedNative.animating &&
      !telemetry.delayedNative.expanded,
    'native collapse while JS geometry is delayed',
  );
  assert.equal(telemetry.native.expanded, true, 'page has not received the collapse');
  assert.equal(telemetry.delayedNative.shell.width, 10);
  assert.deepEqual(windowInfo().kCGWindowBounds, stableBounds);
  assert.equal(telemetry.clip, 'none');
  await capture('delayed-webview-native-compact');
  await command(
    "window.deferNative = false; window.dispatchEvent(new CustomEvent('edge-native',{detail:window.delayedNative}))",
  );
  await until(() => !telemetry.native.expanded, 'deliver held native geometry');
  await until(() => !prefs.keepOpen && !telemetry.native.keepOpen, 'restore fixture hover policy');
  check('native contour collapses independently while WebView geometry delivery is withheld');
  await ipc({ action: 'expand' });
  await until(
    () => telemetry.native.expanded && !telemetry.native.animating,
    'restore after delayed delivery',
  );

  await ipc({ action: 'collapse' });
  await until(
    () =>
      !telemetry.native.expanded && telemetry.native.animating && telemetry.native.unfold < 0.85,
    'reverse while collapsing',
  );
  assert.ok(telemetry.native.unfold > 0);
  await ipc({ action: 'expand' });
  await until(() => telemetry.native.expanded && telemetry.native.animating, 'reverse toward open');
  assert.ok(telemetry.native.unfold > 0 && telemetry.native.unfold < 1);
  await until(() => telemetry.native.expanded && !telemetry.native.animating, 'reversal settles');
  check('native unfold reverses before collapse completes');

  assert.equal(telemetry.native.keyboard, false);
  if (environment.canPostEvents) {
    const bounds = windowInfo().kCGWindowBounds,
      search = telemetry.searchRect;
    pointerInput('click', [
      bounds.X + search.x + search.width / 2,
      bounds.Y + search.y + search.height / 2,
    ]);
  } else {
    await command(
      "document.querySelector('#edge-panel nav button').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))",
    );
  }
  await until(
    () => telemetry.native.keyboard && telemetry.hasFocus,
    'explicit first-click keyboard focus',
  );
  check(
    environment.canPostEvents
      ? 'real first menu click acquires key focus'
      : 'synthetic menu click acquires key focus (real first click not verified)',
    { native: telemetry.native, pointerDown: telemetry.pointerDown, hasFocus: telemetry.hasFocus },
  );
  const events = telemetry.keyboardActivations;
  await delay(2200);
  assert.equal(
    telemetry.keyboardActivations,
    events,
    'unchanged backend polling must not refocus the page',
  );
  check('unchanged polls do not repeatedly acquire keyboard focus', {
    keyboardActivations: events,
  });

  const beforeCollapseWidth = windowInfo().kCGWindowBounds.Width;
  await ipc({ action: 'collapse' });
  await until(
    () => !telemetry.native.expanded && !telemetry.native.animating && !telemetry.native.keyboard,
    'collapse',
  );
  assert.equal(windowInfo().kCGWindowBounds.Width, beforeCollapseWidth);
  assert.equal(telemetry.native.shell.width, 10);
  check('collapse retains prepared viewport and shrinks only the native contour');
  await command('window.fixturePointer({inside:false,buttons:0,hoverSuppressed:false})');
  prefs.keepOpen = true;
  revision++;
  await until(
    () => telemetry.native.expanded && !telemetry.native.animating && telemetry.native.keepOpen,
    'keepOpen preference',
  );
  await ipc({ action: 'collapse' });
  await until(
    () => !prefs.keepOpen && !telemetry.native.expanded && !telemetry.native.animating,
    'explicit collapse overrides keepOpen',
  );
  check('explicit collapse persists keepOpen=false');

  await ipc({ action: 'edge', edge: 'left' });
  await until(() => prefs.edge === 'left' && telemetry.native.edge === 'left', 'left edge');
  await capture('left-compact');
  check('left compact', windowInfo().kCGWindowBounds);
  await ipc({ action: 'edge', edge: 'top' });
  await until(() => prefs.edge === 'top' && telemetry.native.edge === 'top', 'top edge');
  const top = windowInfo().kCGWindowBounds;
  assert.equal(telemetry.native.shell.width, telemetry.native.compactWidth);
  assert.equal(telemetry.native.shell.height, telemetry.native.compactHeight);
  assert.ok(
    Math.abs(telemetry.native.shell.y + telemetry.native.shell.height - top.Height) < 0.001,
  );
  if (telemetry.native.notchWidth > 0)
    assert(telemetry.native.shell.width >= telemetry.native.notchWidth + 20);
  await capture('top-compact');
  check('physical notch dock or unnotched top fallback', { bounds: top, native: telemetry.native });
  const saved = prefs.screen;
  await delay(1300);
  assert.equal(prefs.screen, saved);
  await ipc({ action: 'position', delta: 0.1 });
  await until(
    () => prefs.screen !== '' && prefs.position === 0.6,
    'explicit drag saves display UUID',
  );
  check('only explicit drag persists display identity', { screen: prefs.screen });

  reveal++;
  await until(
    () => telemetry.native.expanded && !telemetry.native.animating && telemetry.native.keyboard,
    'subsequent reveal',
  );
  check('subsequent reveal expands with keyboard focus');
  await capture('top-expanded');
  // Material reparenting can send a real pointerleave while the pointer is outside.
  // Keep the screenshot subject open; collapse behavior is exercised above.
  prefs.keepOpen = true;
  revision++;
  await until(() => telemetry.native.keepOpen && prefs.keepOpen, 'pin material screenshots');
  // Workbench changes do not replace the control's own default.
  Object.assign(appearance, { material: 'native-glass', liquidVariant: 'clear' });
  await until(
    () => telemetry.native.appearance?.material === 'native-glass',
    'workbench appearance',
  );
  assert.equal(telemetry.native.effectiveMaterial, 'black');
  for (const material of ['black', 'matte']) {
    prefs.theme = material;
    for (const hostTheme of ['light', 'dark', 'light']) {
      appearance.hostTheme.theme = hostTheme;
      await until(
        () =>
          telemetry.native.theme === material &&
          telemetry.native.appearance?.hostTheme?.theme === hostTheme &&
          telemetry.native.nativeDark === (material === 'black' || hostTheme === 'dark'),
        'Codex native theme with pure-black exception',
      );
    }
  }
  await command('window.resetMotion(); window.recordMotion = true');
  for (const [theme, variant, style] of [
    ['black', 'regular', null],
    ['matte', 'regular', null],
    ['frosted', 'regular', 'frosted-hud-active'],
    ['native-glass', 'regular', 'regular'],
    ['native-glass', 'clear', 'clear'],
    ['black', 'regular', null],
  ]) {
    Object.assign(prefs, { theme, liquidVariant: variant });
    await until(
      () =>
        telemetry.native.theme === theme &&
        telemetry.native.liquidVariant === variant &&
        !telemetry.native.animating,
      `theme ${theme}/${variant}`,
    );
    const fallback = theme === 'native-glass' && !telemetry.native.nativeGlassAvailable;
    const effective = fallback ? 'matte' : theme;
    assert.equal(telemetry.native.effectiveMaterial, effective);
    const backed = ['frosted', 'native-glass'].includes(effective);
    assert.equal(telemetry.native.nativeBackdrop, backed);
    assert.equal(telemetry.native.backdropStyle, fallback ? null : style);
    const bounds = windowInfo().kCGWindowBounds;
    assert.ok(
      bounds.Width >= telemetry.native.layoutWidth &&
        bounds.Width <= telemetry.native.layoutWidth + 1,
    );
    assert.deepEqual(telemetry.viewport, [bounds.Width, bounds.Height]);
    if (fallback)
      report.skipped.push({
        name: `native glass ${variant}`,
        reason: 'NSGlassEffectView unavailable; matte fallback verified',
      });
    assert.equal(
      telemetry.native.nativeDark,
      theme === 'black' || appearance.hostTheme.theme === 'dark',
    );
    if (theme === 'black') assert.equal(telemetry.background, 'rgb(0, 0, 0)');
    else if (effective === 'frosted') assert.equal(telemetry.background, 'rgba(0, 0, 0, 0)');
    else if (effective === 'native-glass') assert.equal(telemetry.background, 'rgba(0, 0, 0, 0)');
    assert.ok(telemetry.viewport[1] >= Math.min(144, telemetry.native.availableHeight));
    assert.ok(telemetry.viewport[1] >= telemetry.native.layoutY + telemetry.native.layoutHeight);
    check(`independent theme ${theme}/${variant}`, telemetry.native);
    await capture(`theme-${theme}-${variant}`);
    const expandedBackground = telemetry.background;
    await ipc({ action: 'collapse' });
    await until(
      () => !telemetry.native.expanded && !telemetry.native.animating,
      'compact material',
    );
    assert.equal(telemetry.native.nativeBackdrop, backed);
    assert.equal(telemetry.native.backdropStyle, fallback ? null : style);
    assert.equal(telemetry.handleBackground, expandedBackground);
    assert.equal(Math.min(telemetry.native.shell.width, telemetry.native.shell.height), 10);
    await capture(`compact-${theme}-${variant}`);
    check(`compact retains ${theme}/${variant} material`);
    // Explicit collapse clears keepOpen; restore it before the next material sample.
    // Keyboard focus may legitimately move to another app during this visual check.
    prefs.keepOpen = true;
    revision++;
    await ipc({ action: 'expand', keyboard: true });
    await until(
      () => telemetry.native.keepOpen && telemetry.native.expanded && !telemetry.native.animating,
      'restore expanded material',
    );
  }
  await command("location.href='https://example.invalid/blocked-navigation'");
  await delay(500);
  assert.equal(telemetry.path, '/feature.html');
  check('external top-level navigation denied');
  report.motion = Object.fromEntries(
    ['black', 'matte', 'frosted', 'native-glass'].map((theme) => {
      const samples = telemetry.motion
        .filter((s) => s.theme === theme)
        .map((s) => s.dt)
        .sort((a, b) => a - b);
      return [
        theme,
        {
          samples: samples.length,
          p95: samples[Math.floor(samples.length * 0.95)],
          max: samples.at(-1),
        },
      ];
    }),
  );
  report.errors = telemetry.errors;
  assert.deepEqual(telemetry.errors, []);
  valid = false;
  await exited('invalid lease exits');

  valid = true;
  prefs.keepOpen = false;
  start();
  await until(() => telemetry?.heldScenes > 0, 'explicit reveal fixture startup');
  await command('window.releaseScenes()');
  await until(
    () => telemetry?.native.expanded && telemetry.native.keyboard,
    'first snapshot honors explicit reveal',
  );
  check('fresh edge process honors an explicit reveal on its first snapshot');
  server.close();
  server.closeAllConnections();
  await exited('backend disappearance exits');
  report.status = report.skipped.length ? 'passed_with_skips' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  report.stderr = stderr;
  report.lastTelemetry = telemetry;
  if (child?.exitCode === null)
    report.failureWindows = JSON.parse(
      execFileSync(geometryProbe, ['windows', String(child.pid)], { encoding: 'utf8' }),
    );
  throw error;
} finally {
  try {
    if (environment.canPostEvents && report.pointerInputs.length) {
      const current = JSON.parse(execFileSync(inputProbe, ['state'], { encoding: 'utf8' }));
      const last = report.pointerInputs.at(-1).actual;
      // 用户已接管鼠标时不抢回；仅恢复仍停留在本次测试落点的指针。
      if (!current.buttons && current.pointer.every((v, i) => Math.abs(v - last[i]) <= 2))
        pointerInput('move', environment.pointer);
    }
  } catch (error) {
    report.pointerRestoreError = String(error);
  }
  if (child && child.exitCode === null) child.kill('SIGTERM'); // Only our fixture child.
  server.close();
  server.closeAllConnections();
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  rmSync(dir, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      status: report.status,
      report: join(output, 'report.json'),
      checks: report.checks.length,
      skipped: report.skipped,
    }),
  );
}
