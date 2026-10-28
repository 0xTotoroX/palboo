/*
 * [INPUT]: 编译后的系统窗口、合成投影；默认免截图；显式 --screenshots 才启动像素采样验收。
 * [OUTPUT]: --features-only 验证旧浮窗范围隐藏/恢复和真实 Wry 的大纲/看板切换与响应式任务视图；target/reports/native 中的背景验收；--genie-only 加验开发版网格接口及复位（--cross-screen/--reverse-screens 验实际双屏）；--motion-only 单测三材质空间交接与取消；--appearance-only 将免截图的窗口透明度轨迹、呈现确认、强调色/材质和尺寸检查写入 native-appearance。
 * [POS]: --header-only 免鼠标权限验证三材质透明头部、无可见文字/title、实际置顶层级及调度中心/Spaces属性；--workbench-only 验证双栏布局、鼠标合并与缩放、独立滚动及退出。仅启动合成测试窗口，不使用真实宿主或模型。
 * 设置验收要求头部入口保持隐藏，通过保留的旧处理器验证设置区与阅读恢复，不依赖旧 activeTab。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { prepareTestBinary } from '../scripts/verify.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fixtureSettings, fixtureTypography } from './fixtures.mjs';
import { buildPanel } from '../scripts/build-panel.mjs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
if (process.platform !== 'darwin') throw Error('Native backdrop acceptance requires macOS.');
const root = resolve(import.meta.dirname, '..');
const artifact = prepareTestBinary();
const screenshots = process.argv.includes('--screenshots');
const featuresOnly = process.argv.includes('--features-only');
const headerOnly = process.argv.includes('--header-only');
const workbenchOnly = featuresOnly || headerOnly || process.argv.includes('--workbench-only');
const genieOnly = process.argv.includes('--genie-only');
const chipAnchor = genieOnly && process.argv.includes('--chip-anchor');
const crossScreen = genieOnly && process.argv.includes('--cross-screen');
const reverseScreens = crossScreen && process.argv.includes('--reverse-screens');
const motionOnly = genieOnly || process.argv.includes('--motion-only');
const appearanceOnly =
  !screenshots || workbenchOnly || motionOnly || process.argv.includes('--appearance-only');
const dir = mkdtempSync(join(tmpdir(), 'buddy-native-'));
const output =
  root +
  '/target/reports/' +
  (featuresOnly
    ? 'native-features'
    : workbenchOnly
      ? headerOnly
        ? 'native-header'
        : 'native-workbench'
      : genieOnly
        ? crossScreen
          ? reverseScreens
            ? 'native-genie-cross-reverse'
            : 'native-genie-cross'
          : chipAnchor
            ? 'native-genie-chip'
            : 'native-genie'
        : motionOnly
          ? 'native-motion'
          : appearanceOnly
            ? 'native-appearance'
            : 'native');
mkdirSync(output, { recursive: true });
rmSync(join(output, 'report.json'), { force: true });
const helper = join(dir, 'native-probe');
execFileSync('swiftc', [join(root, 'tests/native-probe.swift'), '-o', helper]);
if (workbenchOnly && !featuresOnly && !headerOnly) {
  const permissions = JSON.parse(execFileSync(helper, ['permissions'], { encoding: 'utf8' }));
  if (!permissions.canPostEvents) {
    rmSync(dir, { recursive: true, force: true });
    throw Error(
      'Native pointer acceptance requires Accessibility event posting access; no permission requested.',
    );
  }
}
const screens = JSON.parse(execFileSync(helper, ['screens'], { encoding: 'utf8' }));
if (crossScreen && screens.length < 2)
  throw Error('Cross-screen verification needs two connected displays');
const sourceScreen = screens[reverseScreens ? 1 : 0];
const destinationScreen = screens[crossScreen && !reverseScreens ? 1 : 0];
const sourceAnchor = {
  x: sourceScreen.x + 300,
  y: sourceScreen.y + 180,
  width: chipAnchor ? 84 : 404,
  height: chipAnchor ? 36 : motionOnly ? 376 : 420,
};
const destinationPosition = crossScreen
  ? {
      x: (destinationScreen.x + 100) * destinationScreen.scale,
      y: (destinationScreen.y + 125) * destinationScreen.scale,
    }
  : workbenchOnly
    ? {
        // Leave room for the largest fixture and left-corner growth. The native
        // keep-on-screen correction must not mask the fixed-corner assertion.
        x: (sourceScreen.x + Math.max(0, (sourceScreen.width - 924) / 2)) * sourceScreen.scale,
        y: (sourceScreen.y + 125) * sourceScreen.scale,
      }
    : { x: 220, y: 250 };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const settings = fixtureSettings;
let ui = {
  open: true,
  width: 404,
  height: workbenchOnly ? 540 : motionOnly ? 625 : 420,
  ...(workbenchOnly
    ? { layoutMode: 'workbench', dockWidth: 340, splitRatio: 0.45, dockOpen: true }
    : {}),
  activeTab: genieOnly ? 'settings' : 'next',
  material: 'frosted',
  fontOffset: 0,
  labelOnly: false,
  promptClickMode: 'fill',
  viewOrder: ['next', 'outline'],
};
let state = {
  preferences: { detached: true, alwaysOnTop: true, ui },
  ready: true,
  snapshot: {
    instanceId: 'fixture',
    context: { sessionId: 'synthetic' },
    answerHash: 'one',
    viewToken: 'one',
    promptToken: 'one',
    outlineToken: 'one',
    prompts: [],
    outlineItems: [],
    outlineStatus: 'ready',
    outlineError: '',
    bridgeStatus: 'manual-ready',
    bridgeError: '',
    scanBusy: false,
    scanStatus: 'ready',
    theme: 'light',
    hostTypography: fixtureTypography,
    settings,
    sourceLabel: 'Palboo · 合成测试',
  },
};
let commands = [],
  telemetry = null;
if (workbenchOnly) {
  state.snapshot.prompts = Array.from({ length: 4 }, (_, i) => ({
    label: `合成建议 ${i + 1}`,
    summary: '用于检查原生工作台独立滚动与布局。',
    prompt: '合成提示词内容，用于滚动验收。\n'.repeat(30),
  }));
  state.snapshot.outlineItems = Array.from({ length: 40 }, (_, i) => ({
    id: `outline-${i}`,
    text: `合成大纲条目 ${i + 1}`,
    displayLevel: 1,
    numberPrefix: `${i + 1}.`,
    labelText: `合成大纲条目 ${i + 1}`,
  }));
}
const taskState = {
  store: {
    revision: 1,
    boardEnabled: true,
    syncEnabled: false,
    bindings: { todo: '', doing: '', waiting: '' },
    inflight: null,
    tasks: [
      {
        id: 'native-pilot',
        fields: {
          title: '原生试点任务',
          notes: '',
          due: null,
          priority: 0,
          column: 'todo',
          completed: false,
        },
        archived: false,
        deleteRequested: false,
        remote: null,
        remoteMissing: false,
        conflict: null,
      },
    ],
  },
  status: '同步已暂停',
  error: null,
};
const events = [];
const requests = [];
const script = await buildPanel();
function probePage() {
  const pointerEvents = [];
  let trustedPointerDowns = 0;
  for (const name of [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'lostpointercapture',
    'pointermove',
  ]) {
    window.addEventListener(
      name,
      (event) => {
        if (name === 'pointermove' && !event.buttons) return;
        if (name === 'pointerdown' && event.isTrusted) trustedPointerDowns++;
        pointerEvents.push({
          type: name,
          trusted: event.isTrusted,
          buttons: event.buttons,
          screen: [event.screenX, event.screenY],
          x: event.clientX,
          y: event.clientY,
          tag: event.target?.tagName,
        });
        if (pointerEvents.length > 32) pointerEvents.shift();
      },
      true,
    );
  }
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const panel = window.__companionFloatingPanel;
      const current = panel?.state;
      const measure = (node) =>
        node
          ? {
              rect: node.getBoundingClientRect(),
              visible:
                node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden',
              scrollTop: node.scrollTop,
              scrollHeight: node.scrollHeight,
              clientHeight: node.clientHeight,
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth,
              overflowY: getComputedStyle(node).overflowY,
              textLength: node.textContent.trim().length,
            }
          : null;
      const workbench = document.querySelector('.csw-workbench');
      const response = await fetch('/probe', {
        method: 'POST',
        body: JSON.stringify({
          pointerEvents,
          trustedPointerDowns,
          sentAt: Date.now(),
          visibility: document.visibilityState,
          active: current?.runtimeActive,
          motionActive: window.__companionPopout?.motionActive(),
          open: current?.open,
          material: current?.material,
          viewport: [innerWidth, innerHeight],
          resizeHandles: Object.fromEntries(
            [...document.querySelectorAll('.csw-resize-handle[data-corner]')].map((node) => [
              node.dataset.corner,
              measure(node),
            ]),
          ),
          activeTab: current?.activeTab,
          commandId: window.probeCommandId,
          feature: workbench?.dataset.feature,
          board: (() => {
            const board = workbench?.querySelector('.csw-board-mount')?.shadowRoot;
            return board
              ? {
                  text: board.textContent,
                  narrow: !!board.querySelector('[aria-label="任务阶段"]'),
                  search: board.querySelector('input[type="search"]')?.value,
                }
              : null;
          })(),
          workbench: workbench && {
            composition: workbench.dataset.composition,
            layoutMode: current?.layoutMode,
            dockWidth: current?.dockWidth,
            splitRatio: current?.splitRatio,
            popoutLayout: current?.popoutLayout,
            axis: workbench.querySelector('.csw-workbench-panes')?.dataset.axis,
            first: workbench.querySelector('.csw-workbench-panes > [data-pane]')?.dataset.pane,
            dockOpen: current?.dockOpen,
            layout: getComputedStyle(workbench).display,
            rect: workbench.getBoundingClientRect(),
            panesVisible: measure(workbench.querySelector('.csw-workbench-panes'))?.visible,
            panesViewport: measure(workbench.querySelector('.csw-workbench-panes')),
            panes: Object.fromEntries(
              ['outline', 'next'].map((kind) => [
                kind,
                {
                  ...measure(workbench.querySelector(`[data-pane="${kind}"]`)),
                  body: measure(workbench.querySelector(`[data-view-body="${kind}"]`)),
                },
              ]),
            ),
            pin: workbench.querySelector('[data-action=pin]')?.getAttribute('aria-pressed'),
            headerText: workbench.querySelector('.csw-head')?.innerText.trim(),
            headerTitles: workbench.querySelectorAll('.csw-head [title]').length,
            headerSurfaces: ['[data-action=pin]'].map((selector) => {
              const node = workbench.querySelector(selector);
              if (!node) return null;
              const style = getComputedStyle(node);
              return {
                background: style.backgroundColor,
                shadow: style.boxShadow,
                border: style.borderTopWidth,
              };
            }),
            settings: measure(workbench.querySelector('.csw-workbench-settings')),
            settingsButton: measure(workbench.querySelector('[data-workbench-settings]')),
            settingsLabel: workbench
              .querySelector('[data-legacy-settings]')
              ?.getAttribute('aria-label'),
          },
          glassStyleButton: Boolean(document.querySelector('[data-action=glass-style]')),
          materialLabel: document.querySelector('[data-action=material] option:checked')
            ?.textContent,
          nativeGlassStyle: window.__companionNativeGlassStyle,
          warp: window.__companionNativeWarp,
          theme: current?.theme,
          sourceTheme: current?.remoteSource?.theme,
          accentColor:
            current?.root && getComputedStyle(current.root).getPropertyValue('--csw-accent').trim(),
          nativeDark: matchMedia('(prefers-color-scheme: dark)').matches,
          errors: window.probeErrors,
          native: window.__companionNativeBackdrop,
          nativeGlassAvailable: window.__companionNativeGlass,
          effectiveMaterial: current?.popover?.dataset.effectiveMaterial,
          nativeDataset: document.documentElement.dataset.nativeBackdrop,
          headHeight: document.querySelector('.csw-head')?.getBoundingClientRect().height,
          headerBox: workbench && getComputedStyle(workbench.querySelector('.csw-head')).boxSizing,
          headerFaceVisible:
            measure(workbench?.querySelector('.csw-workbench-face'))?.visible || false,
          windowControls: [...document.querySelectorAll('[data-window-control]')]
            .filter((node) => measure(node)?.visible)
            .map((node) => node.dataset.windowControl),
          windowControlsDisabled: [...document.querySelectorAll('[data-window-control]')].some(
            (node) => node.disabled,
          ),
          windowState: window.probeWindowState,
          rect: current?.glass?.getBoundingClientRect(),
          animations: current?.glass?.getAnimations().filter((a) => a.playState === 'running')
            .length,
        }),
      });
      for (const cmd of await response.json()) {
        if (cmd.kind === 'window-state') {
          const controls = window.__buddyWindowControls;
          const update = controls.update;
          controls.update = (state) => {
            controls.update = update;
            window.probeWindowState = { ...state, requestId: cmd.id };
            update(state);
          };
          window.ipc.postMessage(JSON.stringify({ kind: 'window-state' }));
        }
        if (cmd.kind === 'feature') {
          const select = document.querySelector('[aria-label="显示功能"]');
          select.value = cmd.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (cmd.kind === 'board-stage') {
          const board = document.querySelector('.csw-board-mount').shadowRoot;
          const target =
            [...board.querySelectorAll('.stage-tabs button')].find(
              (node) => node.textContent === '进行中',
            ) || board.querySelector('[aria-label="进行中"]');
          const dataTransfer = new DataTransfer();
          board
            .querySelector('.task-card')
            .dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
          board
            .querySelector('.task-card')
            .dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        }
        if (cmd.kind === 'workbench-layout')
          document
            .querySelector(`[data-layout-mode="${cmd.value}"], [data-layout-action="${cmd.value}"]`)
            ?.click();
        if (cmd.kind === 'pane-focus')
          document
            .querySelector(`[data-pane-focus="${cmd.pane}"]`)
            ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        if (cmd.kind === 'pane-arrange') {
          const select = document.querySelector(`[data-pane-arrange="${cmd.pane}"]`);
          select.value = cmd.action;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (cmd.kind === 'pin') document.querySelector('[data-action=pin]')?.click();
        if (cmd.kind === 'retained-settings') {
          document.querySelector('[data-legacy-settings]')?.click();
        }
        if (cmd.kind === 'pane-scroll') {
          const body = document.querySelector(`[data-view-body="${cmd.pane}"]`);
          if (body) body.scrollTop = cmd.top;
        }
        if (cmd.kind === 'panes-scroll') {
          document.querySelector('.csw-workbench-panes').scrollTop = cmd.top;
        }
        if (cmd.kind === 'tab' && document.querySelector('.csw-workbench-settings')?.hidden) {
          document.querySelector('[data-legacy-settings]')?.click();
        }
        if (cmd.kind === 'open') panel.setOpen(cmd.value);
        if (cmd.kind === 'viewport')
          window.__companionPopout.native({
            kind: 'size',
            width: cmd.width,
            height: cmd.height,
            id: 0,
          });
        if (cmd.kind === 'stale-backdrop')
          window.__companionPopout.native({
            kind: 'backdrop',
            material: 'matte',
            viewportWidth: 9999,
            viewportHeight: 9999,
          });
        if (cmd.kind === 'material') panel.setMaterial(cmd.value);
        if (cmd.kind === 'liquid-variant')
          document.querySelector('[data-action=liquid-variant]')?.click();
        if (cmd.kind === 'cycle-material') {
          const select = document.querySelector('[data-action=material]');
          if (select) {
            select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        if (cmd.kind === 'dock') void window.__companionPopout.dock();
        if (cmd.kind === 'cancel-dock') window.__companionPopout.cancelDock();
        if (cmd.kind === 'close') window.ipc.postMessage(JSON.stringify({ kind: 'close' }));
        if (cmd.id !== undefined) window.probeCommandId = cmd.id;
      }
    } finally {
      busy = false;
    }
  }, 80);
}
const probe = `(${probePage.toString()})();`;
const server = createServer(async (req, res) => {
  const chunks = [];
  try {
    for await (const c of req) chunks.push(c);
  } catch (error) {
    // Closing the test WebView can cancel its in-flight telemetry upload.
    if (req.aborted && error.code === 'ECONNRESET') return;
    throw error;
  }
  const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  requests.push({
    at: Date.now(),
    path: req.url,
    theme: state.snapshot.theme,
    height: data.ui?.height,
  });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/panel') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      readFileSync(root + '/ui/surfaces/desktop/legacy/index.html', 'utf8').replace(
        '</head>',
        `<script>window.probeErrors=[];window.addEventListener('error',e=>window.probeErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.probeErrors.push(String(e.reason)));</script><script src="/probe.js" defer></script></head>`,
      ),
    );
    return;
  }
  if (req.url === '/panel.js' || req.url === '/panel-boot.js' || req.url === '/probe.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(
      req.url === '/panel.js'
        ? script
        : req.url === '/probe.js'
          ? probe
          : readFileSync(root + '/ui/surfaces/desktop/legacy/boot.js'),
    );
    return;
  }
  if (req.url === '/probe') {
    telemetry = data;
    events.push(data);
    res.end(JSON.stringify(commands.splice(0)));
    return;
  }
  if (req.url === '/api/tasks/state' || req.url === '/api/tasks/command') {
    if (req.url.endsWith('command')) {
      if (data.op !== 'update' || data.revision !== taskState.store.revision) {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: 'Unexpected native pilot command' }));
        return;
      }
      taskState.store.tasks[0].fields = data.fields;
      taskState.store.revision++;
    }
    res.end(JSON.stringify(taskState));
    return;
  }
  if (req.url === '/api/panel/request') {
    res.end(JSON.stringify({ settings }));
    return;
  }
  if (req.url === '/api/panel/preferences') {
    if (data.ui) ui = state.preferences.ui = data.ui;
    if (typeof data.alwaysOnTop === 'boolean') state.preferences.alwaysOnTop = data.alwaysOnTop;
    state.preferences.revision = (state.preferences.revision || 0) + 1;
    res.end(JSON.stringify({ revision: state.preferences.revision }));
    return;
  }
  if (req.url === '/api/panel/state') {
    res.end(JSON.stringify(state));
    return;
  }
  if (req.url === '/api/panel/ready' || req.url === '/api/panel/anchor') {
    res.end(
      JSON.stringify({
        anchor: sourceAnchor,
      }),
    );
    return;
  }
  res.end('{}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
writeFileSync(
  dir + '/runtime.json',
  JSON.stringify({
    pid: process.pid,
    port: server.address().port,
    token: 'synthetic-native-token',
    version: '0.4.0',
    executable: artifact.binary,
  }),
);
writeFileSync(
  dir + '/panel.json',
  JSON.stringify({ detached: true, alwaysOnTop: true, ui, position: destinationPosition }),
);
writeFileSync(dir + '/color', 'red');
const background = appearanceOnly ? null : spawn(helper, ['board', dir + '/color']);
await delay(500);
const panel = spawn(artifact.binary, ['--data-dir', dir, 'panel-window', '--lease', 'synthetic'], {
  env: { ...process.env, PALBOO_DEV_GENIE: genieOnly ? '1' : '0' },
});
const motionProbe = spawn(helper, ['motion', String(panel.pid)]);
const motionSamples = [];
let entryFinishedAt = null;
let motionBuffer = '';
motionProbe.stdout.on('data', (chunk) => {
  motionBuffer += chunk;
  const lines = motionBuffer.split('\n');
  motionBuffer = lines.pop();
  for (const line of lines) if (line) motionSamples.push(JSON.parse(line));
});
let log = '';
panel.stderr.on('data', (c) => (log += c));
panel.stdout.on('data', (c) => (log += c));
async function waitFor(fn, label) {
  for (let i = 0; i < 160; i++) {
    if (fn()) return;
    if (panel.exitCode !== null) throw Error('window exited ' + log);
    await delay(100);
  }
  throw Error(label + JSON.stringify(telemetry) + log);
}
function windows() {
  return JSON.parse(execFileSync(helper, ['windows', String(panel.pid)], { encoding: 'utf8' }));
}
const pointerDrags = [];
async function drag(from, to) {
  const input = ['drag', ...from.map(String), ...to.map(String), String(panel.pid)];
  const child = spawn(helper, input);
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  pointerDrags.push({ from, to, code, stderr, ...(stdout ? JSON.parse(stdout) : {}) });
  if (code !== 0) throw Error(`Native drag helper failed (${code}): ${stderr}`);
}
function capture(name) {
  if (!screenshots) throw Error('Screen capture requires explicit --screenshots');
  const bounds = windows()
    .filter((w) => w.kCGWindowBounds.Width > 0 && w.kCGWindowBounds.Height > 0)
    .sort(
      (a, b) =>
        b.kCGWindowBounds.Width * b.kCGWindowBounds.Height -
        a.kCGWindowBounds.Width * a.kCGWindowBounds.Height,
    )[0]?.kCGWindowBounds;
  if (!bounds) throw Error('no window ' + JSON.stringify(windows()));
  const file = output + '/' + name + '.png';
  // Preserve the transparent window gutter when reviewing rounded shadow clipping.
  if (name.endsWith('frosted-gray') || name.endsWith('matte-gray')) {
    execFileSync('screencapture', [
      '-x',
      '-R' + [bounds.X, bounds.Y, bounds.Width, bounds.Height].join(','),
      output + '/' + name + '-with-shadow.png',
    ]);
  }
  execFileSync('screencapture', [
    '-x',
    '-R' + [bounds.X + 12, bounds.Y + 12, bounds.Width - 24, bounds.Height - 24].join(','),
    file,
  ]);
  return { file, rgb: JSON.parse(execFileSync(helper, ['sample', file], { encoding: 'utf8' })) };
}
try {
  await waitFor(
    () => telemetry?.active && telemetry?.sourceTheme && telemetry?.rect?.width > 300,
    'no native panel',
  );
  if (featuresOnly) {
    await waitFor(
      () => windows().some((w) => w.kCGWindowBounds.Width > 300),
      'legacy window visible',
    );
    state.scopeAllowed = false;
    await waitFor(
      () => !windows().some((w) => w.kCGWindowBounds.Width > 300),
      'legacy window hidden outside scope',
    );
    state.scopeAllowed = true;
    await waitFor(
      () => windows().some((w) => w.kCGWindowBounds.Width > 300),
      'legacy window restored in enabled scope',
    );
    console.log('PASS legacy window scope hides and restores without ending its lease');
    let commandId = 0;
    const command = async (value) => {
      commands.push({ ...value, id: ++commandId });
      await waitFor(() => telemetry?.commandId === commandId, 'feature command not acknowledged');
    };
    await command({ kind: 'feature', value: 'outline' });
    await waitFor(
      () =>
        telemetry.feature === 'outline' &&
        telemetry.workbench.panes.outline.visible &&
        !telemetry.workbench.panes.next.visible,
      'outline view missing',
    );
    const outline = telemetry.workbench.panes.outline;
    await command({ kind: 'feature', value: 'board' });
    await waitFor(() => telemetry.board?.text.includes('原生试点任务'), 'native board missing');
    await command({ kind: 'board-stage' });
    await waitFor(
      () => taskState.store.tasks[0].fields.column === 'doing',
      'native task command missing',
    );
    const sizes = [];
    for (const width of [940, 424]) {
      await command({ kind: 'viewport', width, height: 624 });
      await waitFor(
        () => telemetry.viewport[0] === width && telemetry.board?.narrow === width < 680,
        'native board responsive layout',
      );
      const native = windows().find((w) => Math.abs(w.kCGWindowBounds.Width - width) <= 1);
      if (!native) throw Error('Native window and board viewport differ');
      sizes.push({
        viewport: telemetry.viewport,
        native: native.kCGWindowBounds,
        narrow: telemetry.board.narrow,
      });
    }
    await command({ kind: 'feature', value: 'outline' });
    await waitFor(
      () => telemetry.feature === 'outline' && telemetry.workbench.panes.outline.visible,
      'outline return missing',
    );
    if (telemetry.errors.length) throw Error(telemetry.errors.join('\n'));
    writeFileSync(
      join(output, 'report.json'),
      JSON.stringify(
        { artifact, scope: 'features-only', outline, sizes, taskState, telemetry },
        null,
        2,
      ),
    );
    rmSync(join(output, 'failure.json'), { force: true });
  } else if (workbenchOnly) {
    let commandId = 0;
    const command = async (value) => {
      commands.push({ ...value, id: ++commandId });
      await waitFor(() => telemetry?.commandId === commandId, 'workbench command not acknowledged');
    };
    const assertLayout = () => {
      const bench = telemetry.workbench;
      if (!bench || bench.layoutMode !== 'workbench' || bench.layout !== 'flex' || !bench.dockOpen)
        throw Error('Native workbench layout is missing');
      if (!bench.panesVisible || bench.settings?.visible || bench.settingsButton?.visible)
        throw Error('Workbench panes/settings visibility is incorrect');
      if (bench.dockWidth !== 340 || bench.splitRatio !== 0.45)
        throw Error('Native resizing changed independent dock preferences');
      const viewport = bench.panesViewport;
      if (
        viewport.rect.left < bench.rect.left - 1 ||
        viewport.rect.right > bench.rect.right + 1 ||
        viewport.rect.top < bench.rect.top - 1 ||
        viewport.rect.bottom > bench.rect.bottom + 1 ||
        viewport.scrollWidth > viewport.clientWidth + 1 ||
        viewport.overflowY !== 'auto'
      )
        throw Error('Native pane viewport does not contain its scrollable content');
      for (const kind of ['outline', 'next']) {
        const pane = bench.panes[kind];
        if (
          !pane?.visible ||
          pane.rect.height < 180 ||
          !pane.body?.visible ||
          pane.body.clientHeight <= 0 ||
          !pane.body.textLength
        )
          throw Error(`${kind} pane is missing, empty or below 180px: ${JSON.stringify(pane)}`);
        // Keep the existing 180px panes in short windows; the outer pane area scrolls.
        const contentTop = viewport.rect.top - viewport.scrollTop;
        if (
          pane.rect.left < viewport.rect.left - 1 ||
          pane.rect.right > viewport.rect.right + 1 ||
          pane.rect.top < contentTop - 1 ||
          pane.rect.bottom > contentTop + viewport.scrollHeight + 1
        )
          throw Error(`${kind} pane extends outside the native scrollable content`);
      }
      const horizontal = bench.axis === 'horizontal';
      const first = bench.panes[bench.first];
      const second = bench.panes[bench.first === 'outline' ? 'next' : 'outline'];
      if (first.rect[horizontal ? 'right' : 'bottom'] > second.rect[horizontal ? 'left' : 'top'])
        throw Error('Native workbench panes overlap');
      if (horizontal && (bench.panes.outline.rect.width < 219 || bench.panes.next.rect.width < 259))
        throw Error('Horizontal panes are below their minimum width');
      const dimension = horizontal ? 'width' : 'height';
      const total = first.rect[dimension] + second.rect[dimension];
      const minimum = horizontal ? (bench.first === 'outline' ? 220 : 260) : 180;
      const otherMinimum = horizontal ? (bench.first === 'outline' ? 260 : 220) : 180;
      const expected = Math.max(
        minimum,
        Math.min(
          total - otherMinimum,
          total * bench.popoutLayout[horizontal ? 'horizontalRatio' : 'verticalRatio'],
        ),
      );
      if (Math.abs(first.rect[dimension] - expected) > 1)
        throw Error(`Native split ratio mismatch: ${first.rect[dimension]} vs ${expected}`);
      if (telemetry.errors.length) throw Error(telemetry.errors.join('\n'));
      return bench;
    };
    await waitFor(
      () =>
        telemetry?.workbench?.panes?.next?.body?.textLength > 0 &&
        !telemetry.animations &&
        telemetry.viewport[1] === 564 &&
        Math.abs(telemetry.rect.height - 540) < 1,
      'native workbench not ready',
    );
    const level = () =>
      windows().sort(
        (a, b) =>
          b.kCGWindowBounds.Width * b.kCGWindowBounds.Height -
          a.kCGWindowBounds.Width * a.kCGWindowBounds.Height,
      )[0]?.kCGWindowLayer;
    const pinnedLevel = level();
    const spaces = [];
    const assertSpaces = async (pinned) => {
      const previous = telemetry.windowState?.requestId;
      await command({ kind: 'window-state' });
      await waitFor(
        () => telemetry.windowState && telemetry.windowState.requestId !== previous,
        'Native window collection behavior not returned',
      );
      // AppKit NSWindowCollectionBehavior: Managed=4; all-spaces/move/transient/stationary=1/2/8/16.
      const behavior = telemetry.windowState.collectionBehavior;
      if (!Number.isInteger(behavior) || !(behavior & 4) || behavior & (1 | 2 | 8 | 16))
        throw Error(
          `Desktop must participate in Mission Control on one movable Space: ${behavior}`,
        );
      const chrome = telemetry.windowState.nativeChrome;
      if (
        chrome?.buttons?.length !== 3 ||
        !chrome.buttons.every((button) => button.visible && button.reachable) ||
        !chrome.headerContentReachable ||
        chrome.activationPolicy !== 1 ||
        telemetry.windowControls.length
      )
        throw Error(
          'Standalone native fixture must use three system controls without an exec Dock entry',
        );
      spaces.push({ pinned, collectionBehavior: behavior, level: level() });
    };
    if (!(pinnedLevel > 0) || telemetry.workbench.pin !== 'true')
      throw Error('Default pin did not reach the native window');
    await assertSpaces(true);
    await command({ kind: 'pin' });
    await waitFor(
      () => telemetry.workbench.pin === 'false' && level() === 0,
      'Unpin did not lower the native window',
    );
    if (state.preferences.alwaysOnTop !== false) throw Error('Unpin preference not saved');
    await assertSpaces(false);
    await command({ kind: 'pin' });
    await waitFor(
      () => telemetry.workbench.pin === 'true' && level() === pinnedLevel,
      'Pin did not restore the native window level',
    );
    if (state.preferences.alwaysOnTop !== true) throw Error('Pin preference not saved');
    await assertSpaces(true);
    const workbenchChecks = [
      { pin: { defaultLevel: pinnedLevel, unpinnedLevel: 0, restored: true }, spaces },
    ];
    for (const material of ['matte', 'frosted', 'native-glass']) {
      await command({ kind: 'material', value: material });
      const effective =
        material === 'frosted'
          ? 'native-frosted'
          : material === 'native-glass' && telemetry.nativeGlassAvailable
            ? 'native-glass'
            : 'matte';
      await waitFor(
        () =>
          telemetry.material === material &&
          telemetry.effectiveMaterial === effective &&
          !telemetry.animations,
        'native workbench material mapping',
      );
      const initial = assertLayout();
      if (headerOnly) {
        if (initial.headerText || initial.headerTitles)
          throw Error('Native header exposes legacy text or a native hover tooltip');
        if (
          initial.headerSurfaces.some(
            (style) =>
              !style ||
              style.background !== 'rgba(0, 0, 0, 0)' ||
              style.shadow !== 'none' ||
              style.border !== '0px',
          )
        )
          throw Error('Native header renders an extra button surface');
        workbenchChecks.push({
          material,
          effective,
          headerSurfaces: initial.headerSurfaces,
          headerText: initial.headerText,
          headerTitles: initial.headerTitles,
        });
        continue;
      }
      const nextScroll = Math.min(
        60,
        initial.panes.next.body.scrollHeight - initial.panes.next.body.clientHeight,
      );
      if (
        nextScroll <= 0 ||
        initial.panes.outline.body.scrollHeight - initial.panes.outline.body.clientHeight < 80
      )
        throw Error('Synthetic content must overflow to verify independent scrolling');
      await command({ kind: 'pane-scroll', pane: 'outline', top: 0 });
      await command({ kind: 'pane-scroll', pane: 'next', top: 0 });
      await command({ kind: 'pane-scroll', pane: 'outline', top: 80 });
      if (
        telemetry.workbench.panes.outline.body.scrollTop !== 80 ||
        telemetry.workbench.panes.next.body.scrollTop !== 0
      )
        throw Error('Outline does not scroll independently');
      await command({ kind: 'pane-scroll', pane: 'next', top: nextScroll });
      if (
        telemetry.workbench.panes.outline.body.scrollTop !== 80 ||
        telemetry.workbench.panes.next.body.scrollTop !== nextScroll
      )
        throw Error('Stepwise does not scroll independently');
      const scrolled = assertLayout();
      await command({ kind: 'retained-settings' });
      await waitFor(
        () => telemetry.workbench.settings?.visible && !telemetry.workbench.panesVisible,
        'retained settings template did not render',
      );
      const overlay = telemetry.workbench.settings;
      if (
        !overlay.textLength ||
        overlay.rect.height <= 0 ||
        telemetry.workbench.settingsLabel !== '旧版内置设置'
      )
        throw Error('Workbench settings overlay/return control is empty');
      await command({ kind: 'retained-settings' });
      await waitFor(
        () => telemetry.workbench.panesVisible && !telemetry.workbench.settings.visible,
        'retained settings template did not close',
      );
      assertLayout();
      if (
        telemetry.workbench.panes.outline.body.scrollTop !== 80 ||
        telemetry.workbench.panes.next.body.scrollTop !== nextScroll
      )
        throw Error('Settings round trip lost pane scroll positions');
      await command({ kind: 'open', value: false });
      await delay(500);
      if (!telemetry.open) throw Error('Native workbench accepted setOpen(false)');
      assertLayout();
      const sizes = [];
      const pointerResizes = [];
      for (const [width, height] of [
        [924, 824],
        [664, 564],
        [524, 624],
        [324, 464],
      ]) {
        await command({ kind: 'viewport', width, height });
        await waitFor(
          () =>
            telemetry.viewport[0] === width &&
            telemetry.viewport[1] === height &&
            Math.abs(telemetry.rect.width - width + 24) < 1 &&
            Math.abs(telemetry.rect.height - height + 24) < 1 &&
            !telemetry.animations,
          'native workbench viewport resize',
        );
        const resized = assertLayout();
        if (width === 324) {
          const viewport = resized.panesViewport;
          await command({ kind: 'panes-scroll', top: viewport.scrollHeight });
          await waitFor(
            () => telemetry.workbench.panesViewport.scrollTop > 0,
            'short native workbench cannot scroll to the last pane',
          );
          const scrolled = assertLayout();
          if (scrolled.panes.next.rect.bottom > scrolled.panesViewport.rect.bottom + 1)
            throw Error('Last native pane remains clipped after scrolling');
          await command({ kind: 'panes-scroll', top: viewport.scrollTop });
          assertLayout();
        }
        if (width === 664) {
          if (resized.axis !== 'horizontal')
            throw Error('Wide native workbench did not become horizontal');
          await command({ kind: 'workbench-layout', value: 'vertical' });
          if (assertLayout().axis !== 'vertical') throw Error('Manual vertical failed');
          await command({ kind: 'workbench-layout', value: 'horizontal' });
          await command({ kind: 'workbench-layout', value: 'swap' });
          if (assertLayout().first !== 'next') throw Error('Native swap failed');
          await command({ kind: 'workbench-layout', value: 'reset' });
          if (assertLayout().axis !== 'horizontal') throw Error('Native layout reset failed');
          const beforeWindow = windows().find(
            (w) => Math.abs(w.kCGWindowBounds.Width - width) <= 1,
          );
          const origin = beforeWindow.kCGWindowBounds;
          const from = telemetry.workbench.panes.outline.rect;
          const to = telemetry.workbench.panes.next.rect;
          await drag(
            [origin.X + from.left + 22, origin.Y + from.top + 18],
            [origin.X + to.left + to.width / 2, origin.Y + to.top + to.height / 2],
          );
          await waitFor(
            () => telemetry.workbench.composition === 'tabs',
            'native pointer drag did not merge panes',
          );
          const afterWindow = windows().find((w) => Math.abs(w.kCGWindowBounds.Width - width) <= 1);
          if (
            !afterWindow ||
            afterWindow.kCGWindowBounds.X !== origin.X ||
            afterWindow.kCGWindowBounds.Y !== origin.Y
          )
            throw Error('Dragging a pane moved the native window');
          await command({ kind: 'pane-focus', pane: 'outline' });
          if (telemetry.workbench.composition !== 'focus') throw Error('Native focus mode missing');
          await command({ kind: 'pane-focus', pane: 'outline' });
          if (telemetry.workbench.composition !== 'tabs')
            throw Error('Native focus did not restore tabs');
          await command({ kind: 'pane-arrange', pane: 'outline', action: 'split' });
          assertLayout();
          for (const [corner, dx, dy] of [
            ['br', 72, 48],
            ['bl', -64, 40],
          ]) {
            const before = windows().find(
              (w) => Math.abs(w.kCGWindowBounds.Width - width) <= 1,
            )?.kCGWindowBounds;
            const handle = telemetry.resizeHandles[corner];
            if (!before || !handle?.visible) throw Error(`Native ${corner} resize handle missing`);
            const x = before.X + handle.rect.left + handle.rect.width / 2;
            const y = before.Y + handle.rect.top + handle.rect.height / 2;
            const pointerDownsBefore = telemetry.trustedPointerDowns;
            await drag([x, y], [x + dx, y + dy]);
            const expectedWidth = before.Width + Math.abs(dx);
            const expectedHeight = before.Height + dy;
            await waitFor(
              () =>
                Math.abs(telemetry.viewport[0] - expectedWidth) <= 2 &&
                Math.abs(telemetry.viewport[1] - expectedHeight) <= 2 &&
                Math.abs(telemetry.rect.width - telemetry.viewport[0] + 24) <= 1 &&
                Math.abs(telemetry.rect.height - telemetry.viewport[1] + 24) <= 1 &&
                !telemetry.animations,
              `native ${corner} pointer resize`,
            );
            const after = windows().find(
              (w) => Math.abs(w.kCGWindowBounds.Width - expectedWidth) <= 2,
            )?.kCGWindowBounds;
            const expectedX = before.X + (corner === 'bl' ? dx : 0);
            if (!after || Math.abs(after.X - expectedX) > 2 || Math.abs(after.Y - before.Y) > 2)
              throw Error(`Native ${corner} resize did not keep the opposite corner fixed`);
            if (telemetry.trustedPointerDowns <= pointerDownsBefore)
              throw Error('Native resize did not receive trusted pointer input');
            assertLayout();
            pointerResizes.push({ corner, delta: [dx, dy], before, after, trusted: true });
            await command({ kind: 'viewport', width, height });
            await waitFor(
              () =>
                telemetry.viewport[0] === width &&
                telemetry.viewport[1] === height &&
                !telemetry.animations,
              'restore viewport after pointer resize',
            );
          }
        }
        const native = windows().find(
          (window) =>
            Math.abs(window.kCGWindowBounds.Width - width) <= 1 &&
            Math.abs(window.kCGWindowBounds.Height - height) <= 1,
        );
        if (!native) throw Error('Wry window bounds do not match resized DOM viewport');
        sizes.push({
          viewport: telemetry.viewport,
          native: native.kCGWindowBounds,
          workbench: resized,
        });
      }
      workbenchChecks.push({
        material,
        effective,
        initial,
        scrolled,
        overlay,
        ignoresCollapse: true,
        sizes,
        pointerResizes,
      });
    }
    writeFileSync(
      join(output, 'report.json'),
      JSON.stringify(
        {
          artifact,
          scope: headerOnly ? 'header-only' : 'workbench-only',
          workbenchChecks,
          telemetry,
          log,
        },
        null,
        2,
      ),
    );
    rmSync(join(output, 'failure.json'), { force: true });
  } else if (motionOnly) {
    await waitFor(
      () => requests.some((r) => r.path === '/api/panel/presented'),
      'presentation missing',
    );
    if (genieOnly && !motionSamples.at(-1)?.reduceMotion) {
      await waitFor(
        () => telemetry?.warp?.frames > 0 && !telemetry.warp.active,
        'genie entry completes',
      );
    }
    await waitFor(() => {
      const sample = motionSamples.at(-1);
      return (
        telemetry?.motionActive === false &&
        telemetry.sentAt > requests.find((r) => r.path === '/api/panel/presented')?.at &&
        sample?.alpha === 1 &&
        Math.abs(sample.bounds?.Width - telemetry.viewport[0]) <= 1 &&
        Math.abs(sample.bounds?.Height - telemetry.viewport[1]) <= 1
      );
    }, 'native entry did not finish at its final size');
    entryFinishedAt = Date.now();
    const settled = motionSamples.at(-1);
    if (
      crossScreen &&
      (Math.abs(settled.bounds.X - destinationPosition.x / destinationScreen.scale) > 2 ||
        Math.abs(settled.bounds.Y - destinationPosition.y / destinationScreen.scale) > 2)
    )
      throw Error('Native window did not settle on the requested display');
    const reduced = settled?.reduceMotion;
    const warpChecks = [];
    for (const material of reduced
      ? []
      : ['matte', 'frosted', 'native-glass', ...(genieOnly ? ['native-glass'] : [])]) {
      commands.push({ kind: 'material', value: material });
      await waitFor(() => telemetry.material === material, 'motion material not applied');
      if (genieOnly && warpChecks.length === 3 && telemetry.nativeGlassAvailable) {
        commands.push({ kind: 'tab' });
        await waitFor(() => telemetry.workbench?.settings?.visible, 'settings not ready');
        commands.push({ kind: 'liquid-variant' });
        await waitFor(() => telemetry.nativeGlassStyle === 'clear', 'Clear mode missing');
      }
      const beforeFrames = telemetry.warp?.frames ?? 0;
      const start = Date.now();
      commands.push({ kind: 'dock' });
      await waitFor(
        () =>
          motionSamples.some(
            (s) =>
              s.at > start && Math.abs((s.bounds?.X ?? settled.bounds.X) - settled.bounds.X) > 8,
          ),
        'return did not move',
      );
      commands.push({ kind: 'cancel-dock' });
      await waitFor(() => {
        const sample = motionSamples.at(-1);
        return (
          Math.abs((sample.bounds?.X ?? Infinity) - settled.bounds.X) <= 2 &&
          Math.abs((sample.bounds?.Height ?? Infinity) - settled.bounds.Height) <= 2 &&
          sample.alpha === 1 &&
          telemetry.motionActive === false &&
          telemetry.windowControlsDisabled === false &&
          (!genieOnly || (telemetry.warp?.frames > beforeFrames && !telemetry.warp.active))
        );
      }, 'return cancellation did not settle');
      if (requests.some((r) => r.path === '/api/panel/dock'))
        throw Error('Cancelled return still docked');
      const recovered = motionSamples.at(-1);
      if (
        Math.abs(recovered.bounds.X - settled.bounds.X) > 2 ||
        Math.abs(recovered.bounds.Height - settled.bounds.Height) > 2 ||
        recovered.alpha !== 1
      )
        throw Error('Cancelled return did not restore native pose');
      if (genieOnly) {
        await waitFor(
          () => telemetry.warp?.frames > beforeFrames,
          'WindowServer warp was not applied',
        );
        if (telemetry.warp.active || telemetry.warp.error || telemetry.warp.peak < 0.15)
          throw Error('Warp failed or did not reset: ' + JSON.stringify(telemetry.warp));
        warpChecks.push({ material, style: telemetry.nativeGlassStyle, ...telemetry.warp });
      }
    }
    writeFileSync(
      join(output, 'report.json'),
      JSON.stringify(
        {
          artifact,
          scope: genieOnly ? 'genie-only' : 'motion-only',
          screens: crossScreen ? screens : undefined,
          sourceAnchor,
          destinationPosition,
          warpChecks,
          errors: telemetry.errors,
        },
        null,
        2,
      ),
    );
  } else {
    // 未获焦点的窗口也要保持同步；跨过本机复现过的后台暂停时间再切换主题。
    const idleStart = Date.now();
    await delay(12000);
    await waitFor(() => telemetry?.sentAt >= idleStart + 11000, 'background projection suspended');
    const backgroundCheck = { idleMs: Date.now() - idleStart, visibility: telemetry.visibility };
    for (const color of ['rgb(48, 164, 108)', 'rgb(172, 73, 201)']) {
      state.snapshot.accentColor = color;
      await waitFor(() => telemetry?.accentColor === color, 'native host accent sync');
    }
    delete state.snapshot.accentColor;
    await waitFor(() => telemetry?.accentColor !== 'rgb(172, 73, 201)', 'native accent fallback');
    const themeChecks = [];
    // 宿主投影同时驱动 WebView 与 AppKit 外观，不改系统设置。
    for (const material of ['frosted', 'matte', 'native-glass']) {
      commands.push({ kind: 'material', value: material });
      for (const theme of ['light', 'dark', 'light']) {
        const changedAt = Date.now();
        state.snapshot.theme = theme;
        await waitFor(
          () =>
            telemetry?.sentAt >= changedAt &&
            telemetry?.material === material &&
            telemetry?.sourceTheme === theme &&
            telemetry.theme === theme &&
            telemetry.nativeDark === (theme === 'dark'),
          'native appearance mismatch: ' + material + ' ' + theme,
        );
        themeChecks.push({
          material,
          theme,
          nativeDark: telemetry.nativeDark,
          syncMs: Date.now() - changedAt,
        });
      }
    }
    const geometryChecks = [];
    commands.push({ kind: 'material', value: 'matte' });
    commands.push({ kind: 'tab', value: 'settings' });
    await waitFor(
      () => telemetry?.material === 'matte' && telemetry?.workbench?.settings?.visible,
      'material controls',
    );
    if (telemetry.glassStyleButton) throw Error('Obsolete glass style control remains');
    const materialChecks = [];
    for (const material of [
      'frosted',
      'native-glass',
      'matte',
      'frosted',
      'native-glass',
      'matte',
    ]) {
      commands.push({ kind: 'cycle-material' });
      const style = material === 'frosted' ? 'frosted-hud-active' : 'regular';
      const effective =
        material === 'frosted'
          ? 'native-frosted'
          : material === 'native-glass' && telemetry.nativeGlassAvailable
            ? 'native-glass'
            : 'matte';
      await waitFor(
        () =>
          telemetry?.material === material &&
          telemetry?.effectiveMaterial === effective &&
          (material === 'matte' ||
            (material === 'native-glass' && !telemetry.nativeGlassAvailable) ||
            telemetry.nativeGlassStyle === style),
        'material mapping: ' + material,
      );
      commands.push({ kind: 'stale-backdrop' });
      await delay(200);
      if (
        material !== 'matte' &&
        telemetry.nativeGlassAvailable &&
        telemetry.nativeGlassStyle !== style
      )
        throw Error('Stale viewport message replaced native material');
      materialChecks.push({
        material,
        effective,
        actual: telemetry.nativeGlassStyle,
        label: telemetry.materialLabel,
        rect: telemetry.rect,
      });
    }
    commands.push({ kind: 'material', value: 'native-glass' });
    await waitFor(() => telemetry?.material === 'native-glass', 'liquid variant controls');
    if (telemetry.nativeGlassAvailable) {
      for (const variant of ['clear', 'regular']) {
        commands.push({ kind: 'liquid-variant' });
        await waitFor(
          () => telemetry?.open === true && telemetry.nativeGlassStyle === variant,
          'expanded native ' + variant,
        );
        materialChecks.push({
          material: 'native-glass',
          variant,
          actual: telemetry.nativeGlassStyle,
        });
      }
    }
    // Reparenting the WebView must preserve its viewport while rejecting collapse and switching materials.
    for (const material of ['native-glass', 'matte', 'frosted', 'native-glass']) {
      commands.push({ kind: 'material', value: material });
      await waitFor(() => telemetry?.material === material, 'native material selection');
      const effective =
        material === 'frosted'
          ? 'native-frosted'
          : material === 'native-glass' && telemetry.nativeGlassAvailable
            ? 'native-glass'
            : 'matte';
      await waitFor(() => telemetry?.effectiveMaterial === effective, 'native capability fallback');
      commands.push({ kind: 'open', value: false });
      await delay(500);
      await waitFor(
        () => telemetry?.open === true && telemetry?.rect?.width > 390 && !telemetry.animations,
        'popout must ignore collapse',
      );
      const expanded = telemetry.rect;
      const expandedStyle = telemetry.nativeGlassStyle;
      for (const [width, height] of [
        [524, 504],
        [428, 464],
      ]) {
        commands.push({ kind: 'viewport', width, height });
        await waitFor(
          () =>
            telemetry?.viewport?.[0] === width &&
            telemetry?.viewport?.[1] === height &&
            Math.abs(telemetry?.rect?.width - width + 24) < 1 &&
            Math.abs(telemetry?.rect?.height - height + 24) < 1,
          'native viewport resize ' + material,
        );
      }
      geometryChecks.push({
        material,
        effective,
        ignoresCollapse: true,
        expanded,
        expandedStyle,
        resized: telemetry.rect,
      });
    }
    if (
      telemetry.headHeight !== 44 ||
      telemetry.headerBox !== 'border-box' ||
      telemetry.headerFaceVisible ||
      telemetry.windowControls.length !== 0
    )
      throw Error('WebKit workbench header differs from the shared desktop controls');
    if (telemetry.errors.length) throw Error(telemetry.errors.join('\n'));
    if (appearanceOnly) {
      writeFileSync(
        output + '/report.json',
        JSON.stringify(
          {
            artifact,
            scope: 'appearance-only',
            backgroundCheck,
            themeChecks,
            materialChecks,
            geometryChecks,
            telemetry,
            log,
          },
          null,
          2,
        ),
      );
      rmSync(join(output, 'failure.json'), { force: true });
      console.log(
        JSON.stringify(
          {
            artifact,
            scope: 'appearance-only',
            backgroundCheck,
            themeChecks,
            materialChecks,
            geometryChecks,
            output,
          },
          null,
          2,
        ),
      );
    } else {
      const results = [];
      for (const theme of ['light', 'dark']) {
        state.snapshot.theme = theme;
        await waitFor(() => telemetry?.theme === theme, 'theme');
        for (const material of ['frosted', 'matte', 'native-glass']) {
          commands.push({ kind: 'material', value: material });
          await waitFor(() => telemetry?.material === material, 'material');
          await delay(350);
          writeFileSync(dir + '/color', 'gray');
          await delay(350);
          const gray = capture(theme + '-' + material + '-gray');
          writeFileSync(dir + '/color', 'red');
          await delay(350);
          const red = capture(theme + '-' + material + '-red');
          writeFileSync(dir + '/color', 'blue');
          const begin = Date.now();
          await delay(180);
          const blue = capture(theme + '-' + material + '-blue');
          results.push({ theme, material, gray, red, blue, elapsedMs: Date.now() - begin });
        }
      }
      commands.push({ kind: 'open', value: false });
      await delay(500);
      await waitFor(
        () => telemetry?.open === true && telemetry?.rect?.width > 390 && !telemetry.animations,
        'popout stays expanded',
      );
      const expanded = capture('expanded-after-collapse-request');
      for (const r of results) {
        const delta = Math.hypot(...r.red.rgb.map((v, i) => v - r.blue.rgb[i]));
        if (r.material === 'matte' ? delta > 0.02 : delta < 0.08)
          throw Error(
            'Backdrop color check failed: ' + r.theme + ' ' + r.material + ' delta=' + delta,
          );
      }
      const appearanceDifferences = [];
      for (const theme of ['light', 'dark']) {
        const rows = results.filter((r) => r.theme === theme);
        for (let i = 0; i < rows.length; i++)
          for (let j = i + 1; j < rows.length; j++) {
            const a = [...rows[i].red.rgb, ...rows[i].blue.rgb],
              b = [...rows[j].red.rgb, ...rows[j].blue.rgb];
            const delta = Math.hypot(...a.map((v, k) => v - b[k]));
            appearanceDifferences.push({
              theme,
              pair: [rows[i].material, rows[j].material],
              delta,
            });
            if (delta < 0.025)
              throw Error(
                'Native appearances are indistinguishable: ' +
                  JSON.stringify(appearanceDifferences.at(-1)),
              );
          }
      }
      if (telemetry.native !== true || telemetry.nativeDataset !== 'true')
        throw Error('Native backdrop capability is absent');
      if (telemetry.headHeight !== 44 || telemetry.headerBox !== 'border-box')
        throw Error('WebKit workbench header differs from the shared layout');
      if (telemetry.errors.length) throw Error(telemetry.errors.join('\n'));
      writeFileSync(
        output + '/report.json',
        JSON.stringify(
          {
            artifact,
            backgroundCheck,
            themeChecks,
            materialChecks,
            results,
            appearanceDifferences,
            expanded,
            telemetry,
            events: events.length,
            log,
          },
          null,
          2,
        ),
      );
      rmSync(join(output, 'failure.json'), { force: true });
      console.log(
        JSON.stringify(
          {
            artifact,
            results: results.map((x) => ({
              theme: x.theme,
              material: x.material,
              gray: x.gray.rgb,
              red: x.red.rgb,
              blue: x.blue.rgb,
              elapsedMs: x.elapsedMs,
            })),
            errors: telemetry.errors,
            output,
          },
          null,
          2,
        ),
      );
    }
  }
  if (telemetry.errors.length) throw Error(telemetry.errors.join('\n'));
  const readyAt = requests.find((request) => request.path === '/api/panel/ready')?.at;
  const presentedAt = requests.find((request) => request.path === '/api/panel/presented')?.at;
  if (!readyAt || !presentedAt || presentedAt < readyAt)
    throw Error('Native presentation was not acknowledged after readiness');
  const closingAt = Date.now();
  commands.push({ kind: motionOnly ? 'dock' : 'close' });
  for (let i = 0; i < 50 && panel.exitCode === null; i++) await delay(50);
  if (panel.exitCode !== 0) throw Error('Native fade-out did not close cleanly: ' + log);
  const reduced = motionSamples[0]?.reduceMotion;
  if (reduced === undefined) throw Error('No native window alpha samples');
  const intermediate = (sample) => sample.alpha > 0 && sample.alpha < 1;
  if (!reduced) {
    if (genieOnly) {
      const entry = motionSamples.filter(
        (s) => s.at <= entryFinishedAt && s.alpha > 0 && s.bounds?.Height,
      );
      const sourceHeight = (chipAnchor ? 36 : 376) + 24;
      if (!entry.length || entry[0].bounds.Height > sourceHeight + 16)
        throw Error('Genie first visible frame was not at the source');
      if (
        crossScreen &&
        Math.hypot(
          entry[0].bounds.X - (sourceAnchor.x - 12),
          entry[0].bounds.Y - (sourceAnchor.y - 12),
        ) > 16
      )
        throw Error('Cross-screen entry started on the wrong display');
      const growing = entry.filter(
        (s) => s.bounds.Height > sourceHeight + 16 && s.bounds.Height < 625,
      );
      if (new Set(growing.map((s) => Math.round(s.bounds.Height))).size < 3)
        throw Error('Genie entry skipped the visible expansion');
    } else {
      // CGWindowList and the HTTP acknowledgement arrive on independent queues.
      // Prove the fade at its actual source pose, before travel, rather than ordering receipt times.
      const entryEnd = entryFinishedAt ?? closingAt;
      const sourceFade = motionSamples.some(
        (s) =>
          s.at >= readyAt &&
          s.at < entryEnd &&
          intermediate(s) &&
          Math.abs(s.bounds?.X - (sourceAnchor.x - 12)) <= 2 &&
          Math.abs(s.bounds?.Y - (sourceAnchor.y - 12)) <= 2 &&
          Math.abs(s.bounds?.Width - (sourceAnchor.width + 24)) <= 2 &&
          Math.abs(s.bounds?.Height - (sourceAnchor.height + 24)) <= 2,
      );
      if (!sourceFade) throw Error('Native window did not fade in at its source pose');
    }
    if (!motionSamples.some((s) => s.at > closingAt && intermediate(s)))
      throw Error('Native window did not fade out before exit');
  }
  if (motionOnly && !reduced) {
    const entry = motionSamples.filter(
      (s) => s.at < closingAt && s.alpha > 0 && s.bounds?.X !== undefined,
    );
    const span = (axis) =>
      Math.max(...entry.map((s) => s.bounds[axis])) - Math.min(...entry.map((s) => s.bounds[axis]));
    if (Math.hypot(span('X'), span('Y')) < 40)
      throw Error('Native handoff had no spatial movement');
  }
  if (
    motionOnly &&
    requests.some(
      (r) => r.path === '/api/panel/preferences' && r.height !== undefined && r.height !== 625,
    )
  )
    throw Error('Animation saved a transient panel height');
  const motionCheck = {
    readyAt,
    presentedAt,
    entryFinishedAt,
    closingAt,
    reduced,
    samples: motionSamples,
  };
  const reportPath = output + '/report.json';
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  writeFileSync(reportPath, JSON.stringify({ ...report, motionCheck, pointerDrags }, null, 2));
  rmSync(join(output, 'failure.json'), { force: true });
  console.log('原生窗口呈现确认、几何与透明度轨迹、退出检查通过。');
} catch (e) {
  rmSync(join(output, 'report.json'), { force: true });
  console.error(e);
  writeFileSync(
    output + '/failure.json',
    JSON.stringify(
      {
        error: String(e),
        telemetry,
        log,
        dir,
        motionSamples,
        pointerDrags,
        presentationRequests: requests.filter((request) =>
          ['/api/panel/ready', '/api/panel/presented'].includes(request.path),
        ),
        requests: requests.slice(-80),
        events: events.slice(-20),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  panel.kill();
  motionProbe.kill();
  background?.kill();
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
