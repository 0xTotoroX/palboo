/* [INPUT]: Actual monitor, settings page and host runtime with synthetic APIs.
 * [OUTPUT]: Opt-in sampling, bounded visual history, expiring leases and disabled feature cleanup regressions.
 * [POS]: Isolated browsers and fake clocks; no real chat or model requests.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildPanel } from '../scripts/build-panel.mjs';
import { fixtureSettings } from './fixtures.mjs';

test('chat status and composer reads stay bounded and revalidate changed targets', async () => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import{chatBusy,composerCandidates,mainComposerCandidate}from'./ui/codex/context.js';
import{initializeState}from'./ui/codex/runtime/state.js';initializeState({diagnostics:[]});
window.contextApi={chatBusy,composerCandidates,mainComposerCandidate};`,
      },
      bundle: true,
      write: false,
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://context-performance.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<body></body>' }),
    );
    await page.goto('http://context-performance.test/');
    await page.setContent(`<main style="width:700px">
      <div class="thread-scroll-container" data-session-id="main" style="height:300px;overflow:auto"><div id="actions"></div></div>
      <div style="position:absolute;top:400px;width:700px">
        <div contenteditable="true" class="ProseMirror" style="width:600px;height:60px"></div>
        <button aria-label="Send message">Send</button>
        <nav><button aria-label="Stop">Unrelated</button></nav>
        <span data-palboo-features-root><button aria-label="Stop">Palboo</button></span>
        <button aria-label="Stop" hidden>Hidden</button>
      </div></main>`);
    await page.addScriptTag({ content: script });
    const measure = (operation) =>
      page.evaluate((operation) => {
        let queries = 0;
        const original = Document.prototype.querySelectorAll;
        Document.prototype.querySelectorAll = function (selector) {
          if (selector === '[role="dialog"],dialog[open]') queries++;
          return original.call(this, selector);
        };
        try {
          const api = window.contextApi;
          const root = document.querySelector('.thread-scroll-container');
          const value =
            operation === 'busy'
              ? api.chatBusy()
              : !!api.mainComposerCandidate(api.composerCandidates(root), root);
          return { value, queries };
        } finally {
          Document.prototype.querySelectorAll = original;
        }
      }, operation);
    for (const count of [1, 500]) {
      await page.locator('#actions').evaluate((node, count) => {
        node.innerHTML = '<button>Ordinary action</button>'.repeat(count);
      }, count);
      const busy = await measure('busy');
      assert.equal(busy.value, false, 'hidden, navigation and Palboo stops do not own the chat');
      assert.ok(busy.queries <= 4, `${count} actions triggered ${busy.queries} page scans`);
    }
    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      for (let i = 0; i < 50; i++) {
        const candidate = document.createElement('textarea');
        candidate.style.cssText = 'position:absolute;top:0;width:600px;height:60px';
        editor.parentElement.append(candidate);
      }
    });
    const composer = await measure('composer');
    assert.equal(composer.value, true);
    assert.ok(composer.queries <= 4);
    await page.evaluate(() => {
      const stop = document.createElement('button');
      stop.id = 'official-stop';
      stop.setAttribute('aria-label', 'Stop generating');
      stop.textContent = 'Stop generating';
      document.querySelector('.ProseMirror').after(stop);
    });
    assert.equal((await measure('busy')).value, true);
    await page.evaluate(() => {
      const modal = document.createElement('div');
      modal.id = 'blocking-dialog';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.style.cssText = 'position:fixed;inset:100px;background:white';
      document.body.append(modal);
    });
    assert.equal((await measure('busy')).value, false, 'a new modal invalidates the prior scope');
    assert.equal((await measure('composer')).value, false);
    await page.locator('#blocking-dialog').evaluate((node) => node.remove());
    assert.equal((await measure('busy')).value, true, 'closing the modal restores the real stop');
    await page.locator('#official-stop').evaluate((node) => node.remove());
    assert.equal((await measure('busy')).value, false);
  } finally {
    await browser.close();
  }
});

test('monitor is inert by default, counts nested work once and releases its observer', () => {
  let now = 1,
    clockReads = 0,
    connected = 0,
    id = 0;
  const timers = new Map(),
    api = {};
  const source = readFileSync('ui/shared/performance.js', 'utf8').replaceAll(
    'export function ',
    'function ',
  );
  runInNewContext(
    source + '\nObject.assign(api,{measureWork,samplePerformance,stopPerformance});',
    {
      api,
      performance: {
        now: () => {
          clockReads++;
          return now;
        },
        memory: { usedJSHeapSize: 1000 },
      },
      document: { hidden: false },
      PerformanceObserver: class {
        static supportedEntryTypes = ['longtask'];
        observe() {
          connected++;
        }
        disconnect() {
          connected--;
        }
      },
      setTimeout: (fn) => {
        timers.set(++id, fn);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  api.measureWork('scan', () => (now += 2));
  assert.equal(clockReads, 0);
  assert.equal(timers.size, 0);
  assert.equal(api.samplePerformance().intervalMs, 0);
  api.measureWork('scan', () => {
    now += 2;
    api.measureWork('render', () => (now += 3));
  });
  assert.throws(() =>
    api.measureWork('failure', () => {
      now++;
      throw Error('test');
    }),
  );
  const value = api.samplePerformance();
  assert.equal(value.busyMs, 6);
  assert.equal(value.work.scan.totalMs, 5);
  assert.equal(value.work.render.totalMs, 3);
  assert.equal(connected, 1);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(connected, 0);
  assert.equal(timers.size, 0);
  const previous = clockReads;
  api.measureWork('scan', () => {});
  assert.equal(clockReads, previous);
});

test('monitor history stays bounded, resets on restart and shows missing data as gaps', async () => {
  const result = await build({
    entryPoints: ['ui/settings/performance-history.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, { module });
  const { appendPerformancePoint, chartGeometry } = module.exports;
  const sample = (at, cpu = 2, pid = 42) => ({
    sampledAt: at,
    backend: { pid, cpuPercent: cpu, memoryBytes: 10485760 },
    host: null,
  });
  let history = [];
  for (let i = 0; i < 1000; i++) history = appendPerformancePoint(history, sample(i * 100));
  assert.equal(history.length, 60, 'fast updates cannot grow beyond 60 points');
  assert.equal(appendPerformancePoint(history, sample(99900)), history, 'deduplicate samples');
  assert.equal(appendPerformancePoint(history, sample(0)), history, 'reject older responses');
  history = appendPerformancePoint(history, sample(500000));
  assert.equal(history.length, 1, 'discard samples older than five minutes');
  history = appendPerformancePoint(history, sample(505000, 2, 43));
  assert.equal(history.length, 1, 'restart starts a new history');
  history = [];
  for (const [at, cpu] of [
    [0, 1],
    [5000, 2],
    [10000, null],
    [15000, 3],
    [35000, 4],
  ])
    history = appendPerformancePoint(history, sample(at, cpu));
  const chart = chartGeometry(history, 'cpu', 5);
  assert.equal(JSON.stringify(chart.segments.map((part) => part.length)), '[2,1,1]');
  assert.equal(chart.minutes, 1);
  assert.equal(chart.segments.at(-1)[0].x, 300);
  const invalid = appendPerformancePoint([], sample(1000, -1));
  assert.equal(invalid[0].cpu, null, 'missing and invalid readings are never invented zeros');
  assert.equal(invalid[0].longTasks, null);
});

test('performance settings sample only while visible and preserve confirmed toggles after failure', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'jsx',
      contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ConnectionSettings}from'./ui/settings/connection-settings';
function App(){const[active,setActive]=useState(true);window.setActive=setActive;return <ConnectionSettings live active={active} view={{connection:{status:'connected',endpoint:'9229',targets:[]}}} editor={{form:null}} notify={()=>{}}/>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    outfile: 'target/reports/performance/settings-test.js',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
  });
  const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    let state = {
        preferences: { integrationEnabled: true, monitoringEnabled: false, revision: 0 },
        connectionStatus: 'connected',
        sample: null,
      },
      samples = 0,
      requests = 0,
      reject = false;
    await page.route('http://performance.test/**', (route) => {
      const url = new URL(route.request().url()),
        patch = route.request().postDataJSON();
      if (url.pathname !== '/api/performance')
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      requests++;
      if (patch) {
        if (reject) return route.fulfill({ status: 409, json: { message: '合成保存失败' } });
        assert.equal(patch.expectedRevision, state.preferences.revision);
        const { expectedRevision, ...changes } = patch;
        state.preferences = { ...state.preferences, ...changes, revision: expectedRevision + 1 };
        state.connectionStatus = state.preferences.integrationEnabled
          ? 'connected'
          : 'disconnected';
      }
      if (url.searchParams.has('sample')) {
        samples++;
        assert.equal(state.preferences.monitoringEnabled, true);
        state.sample = {
          sampledAt: 1700000000000 + samples * 5000,
          backend: { pid: 42, cpuPercent: samples === 1 ? null : 2, memoryBytes: 10485760 },
          host: {
            intervalMs: samples === 1 ? 0 : 5000,
            busyMs: 12,
            work: { scan: { count: 3, totalMs: 12, maxMs: 5 } },
            hostJsHeapBytes: 104857600,
            hostLongTasks: 1,
            hostLongestTaskMs: 85,
          },
        };
      }
      return route.fulfill({ json: state });
    });
    await page.goto('http://performance.test');
    await page.clock.install();
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    const monitor = page.getByRole('switch', { name: '性能监测' }),
      integration = page.getByRole('button', { name: '持续暂停' });
    await integration.waitFor();
    assert.equal(await monitor.isVisible(), false);
    await page.waitForFunction(() => !document.querySelector('[role=switch]').disabled);
    await page.clock.runFor(10000);
    assert.equal(samples, 0);
    assert.equal(
      await page.locator('.performance-dashboard').count(),
      0,
      'disabled monitoring does not render empty instruments',
    );
    await page.locator('#connection-diagnostics > summary').click();
    await monitor.click();
    await page.waitForFunction(
      () =>
        document.querySelector('#performance-monitoring').getAttribute('aria-checked') === 'true',
    );
    await page.getByText('10.0 MB', { exact: true }).waitFor();
    await page.clock.runFor(5100);
    await page.getByText('2.0%', { exact: true }).waitFor();
    await page.getByRole('img', { name: /Palboo 后台 CPU.*1个采样点/ }).waitFor();
    await page.getByRole('img', { name: /Palboo 后台物理内存.*2个采样点/ }).waitFor();
    await page.getByText('工作明细', { exact: true }).click();
    await page.getByText('聊天检查', { exact: true }).waitFor();
    const beforeResize = requests;
    for (const width of [320, 680, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.locator('.performance-dashboard').evaluate((element) => {
        const children = [...element.querySelectorAll('.performance-instrument')];
        return {
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          tops: children.map((child) => child.getBoundingClientRect().top),
        };
      });
      assert.ok(
        geometry.scrollWidth <= geometry.width + 1,
        `${width}px has no horizontal overflow`,
      );
      assert.equal(geometry.tops[0] === geometry.tops[1], width > 480);
    }
    assert.equal(requests, beforeResize, 'layout changes do not add sampling requests');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page
        .locator('.performance-dial-value')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      '0s',
    );
    const sampling = samples;
    await page.locator('#connection-diagnostics > summary').click();
    await page.clock.runFor(11000);
    assert.equal(samples, sampling, 'closed diagnostics never samples');
    await page.locator('#connection-diagnostics > summary').click();
    await page.evaluate(() => window.setActive(false));
    await page.waitForTimeout(10);
    const count = requests;
    await page.clock.runFor(15000);
    assert.equal(requests, count);
    await page.evaluate(() => window.setActive(true));
    await page.waitForTimeout(10);
    reject = true;
    await integration.click();
    await page.getByRole('alert').waitFor();
    assert.equal(
      await page.getByRole('alert').evaluate((e) => !!e.closest('#settings-feedback-center')),
      true,
      'failed toggle reports in the shared fixed region',
    );
    assert.equal(await integration.isVisible(), true);
    reject = false;
    await integration.click();
    await page.getByText('已暂停', { exact: true }).waitFor();
    await monitor.click();
    await page.waitForFunction(
      () =>
        document.querySelector('#performance-monitoring').getAttribute('aria-checked') === 'false',
    );
    const end = samples;
    assert.equal(
      await page.locator('.performance-dashboard').count(),
      0,
      'turning off monitoring removes instruments',
    );
    await page.clock.runFor(15000);
    assert.equal(samples, end);
    await page.getByRole('button', { name: '恢复连接', exact: true }).click();
    await integration.waitFor();
    assert.equal(state.preferences.integrationEnabled, true);
  } finally {
    await browser.close();
  }
});

test('unchanged host sync does not redraw and disabled tools release timers and DOM listeners', async () => {
  const bundle = await buildPanel();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    await page.route('http://host.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: readFileSync('tests/host-fixture.html', 'utf8'),
      }),
    );
    await page.goto('http://host.test');
    await page.evaluate((settings) => {
      window.settings = { ...settings, terminologyEnabled: true };
      window.calls = [];
      window.__companionHostRequest = (raw) => {
        const { id, path, payload } = JSON.parse(raw);
        window.calls.push(path);
        let reply =
          path === '/stepwise/settings'
            ? { settings: window.settings }
            : path === '/features'
              ? { features: [] }
              : path === '/terminology'
                ? { preferences: { enabled: true, semantic: false, mastered: [] }, entries: [] }
                : {};
        queueMicrotask(() => window.__companionDesktop?.complete(id, reply));
      };
    }, fixtureSettings);
    await page.evaluate(bundle);
    await page.waitForFunction(
      () =>
        window.__companionFloatingPanel?.state.settingsLoaded &&
        window.__palbooPromptEnhancer &&
        window.__palbooTerminology,
    );
    const measured = await page.evaluate(() => {
      const p = window.__companionFloatingPanel,
        ui = { ...p.panelPreferences(), layoutMode: 'workbench' };
      p.syncPanelPreferences(ui, 123, false);
      p.samplePerformance();
      for (let i = 0; i < 40; i++) p.syncPanelPreferences(ui, 123, false);
      return p.samplePerformance();
    });
    assert.equal(measured.work.render?.count || 0, 0, 'identical heartbeats do not redraw');
    await page.evaluate(async () => {
      Object.assign(window.settings, {
        promptEnhancementEnabled: false,
        tokenMeterEnabled: false,
        terminologyEnabled: false,
      });
      await window.__companionFloatingPanel.syncSettings(window.settings);
    });
    assert.equal(
      await page.evaluate(
        () =>
          !!window.__palbooPromptEnhancer ||
          !!window.__palbooTerminology ||
          !!window.__palbooTokenMeter,
      ),
      false,
    );
    const termsBefore = await page.evaluate(
      () => window.calls.filter((p) => p === '/terminology').length,
    );
    await page.waitForTimeout(1600);
    assert.equal(
      await page.evaluate(() => window.calls.filter((p) => p === '/terminology').length),
      termsBefore,
    );
    await page.evaluate(async () => {
      Object.assign(window.settings, {
        promptEnhancementEnabled: true,
        terminologyEnabled: true,
        tokenMeterEnabled: true,
      });
      await window.__companionFloatingPanel.syncSettings(window.settings);
    });
    await page.waitForFunction(
      () =>
        window.__palbooPromptEnhancer && window.__palbooTerminology && window.__palbooTokenMeter,
    );
    await page.evaluate(() => window.__companionDesktop.destroy());
    assert.equal(
      await page.evaluate(
        () =>
          !!window.__companionFloatingPanel ||
          !!window.__palbooPromptEnhancer ||
          !!window.__palbooTerminology ||
          !!window.__palbooTokenMeter,
      ),
      false,
    );
    assert.equal(
      await page
        .locator(
          '[data-companion-stepwise-root],[data-palboo-dock],[data-palboo-prompt],[data-buddy-terms]',
        )
        .count(),
      0,
    );
  } finally {
    await browser.close();
  }
});
