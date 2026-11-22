/* [INPUT]: Actual settings motion primitives, real built settings shell in isolated Chromium.
 * [OUTPUT]: Regression coverage for disclosure expand/collapse, rapid reversal, live height sync (160->60), live keepMounted updates, archive details.
 * [POS]: Synthetic fixtures only; never touches live ChatGPT, user settings, real chats or host processes.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { emulateMedia, finishAnimations } from './browser-motion.mjs';

const inlineCssPlugin = {
  name: 'inline-css',
  setup(b) {
    b.onResolve({ filter: /\.css\?inline$/ }, (a) => ({
      path: resolve(dirname(a.importer), a.path.split('?')[0]),
      namespace: 'inline-css',
    }));
    b.onLoad({ filter: /.*/, namespace: 'inline-css' }, (a) => ({
      contents: readFileSync(a.path, 'utf8'),
      loader: 'text',
    }));
  },
};

test(
  'SettingsCollapse and useHeightTransition handle live growth (160->60), rapid reversal, live hidden updates and keyboard/reduced motion',
  { timeout: 45000 },
  async (t) => {
    const script = (
      await build({
        stdin: {
          loader: 'tsx',
          resolveDir: process.cwd(),
          contents: `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsCollapse, useHeightTransition } from './ui/settings/settings-collapse';

function Harness() {
  const [ready, setReady] = useState(false);
  const [keepOpen, setKeepOpen] = useState(true);
  const [label, setLabel] = useState('初始值');
  const [draft, setDraft] = useState('未提交草稿');
  const [unmountOpen, setUnmountOpen] = useState(false);
  const [showUnmountHost, setShowUnmountHost] = useState(true);
  const [mode, setMode] = useState<'a' | 'b'>('a');
  const [boxHeight, setBoxHeight] = useState(80);
  const heightRef = useHeightTransition<HTMLDivElement>(mode, { ready: true });

  return (
    <div className="settings-app">
      <button id="hydrate-closed" type="button" onClick={() => { setKeepOpen(false); setReady(true); }}>完成异步载入并收起</button>
      <button id="toggle-keep" type="button" onClick={() => setKeepOpen((v) => !v)}>切换保留节点</button>
      <button id="update-label" type="button" onClick={() => setLabel('后台新值')}>更新隐藏数据</button>
      <button id="toggle-unmount" type="button" onClick={() => setUnmountOpen((v) => !v)}>切换卸载展开</button>
      <button id="destroy-unmount" type="button" onClick={() => setShowUnmountHost(false)}>卸载组件</button>

      <SettingsCollapse id="keep-collapse" open={keepOpen} ready={ready}>
        <div style={{ height: 120, padding: 8 }}>
          <span id="keep-live-label">{label}</span>
          <input id="keep-draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
      </SettingsCollapse>

      {showUnmountHost && (
        <SettingsCollapse id="unmount-collapse" open={unmountOpen} unmountOnExit>
          <div style={{ height: 100 }}>可卸载详情内容</div>
        </SettingsCollapse>
      )}

      <div style={{ marginTop: 24 }}>
        <button id="grow-same-mode" type="button" onClick={() => setBoxHeight(160)}>同模式撑高到160</button>
        <button id="switch-to-60" type="button" onClick={() => { setMode('b'); setBoxHeight(60); }}>切模式到60</button>
        <button id="switch-back-160" type="button" onClick={() => { setMode('a'); setBoxHeight(160); }}>切回160</button>
        <div id="sync-height" ref={heightRef} style={{ height: boxHeight, background: '#eee' }}>
          高度容器
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
`,
        },
        bundle: true,
        write: false,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
      })
    ).outputFiles[0].text;

    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.route('http://collapse.test/**', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
    );
    await page.goto('http://collapse.test/');
    await page.evaluate(() => {
      window.animLog = [];
      const orig = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        window.animLog.push({
          id: this.id || this.parentElement?.id || this.className,
          frames,
          duration: typeof options === 'number' ? options : options?.duration,
        });
        return orig.call(this, frames, options);
      };
    });
    await page.addScriptTag({ content: script });

    // 1. Async hydration (ready false -> true while closing) never animates first paint.
    await page.locator('#hydrate-closed').click();
    assert.equal(
      (await page.evaluate(() => window.animLog)).filter((e) => e.id === 'keep-collapse').length,
      0,
      'hydration skips initial collapse animation',
    );
    assert.equal(await page.locator('#keep-collapse').isHidden(), true);

    // 2. Hidden keepMounted child still receives live prop updates and retains draft.
    await page.locator('#update-label').click();
    assert.equal(
      await page.locator('#keep-live-label').textContent(),
      '后台新值',
      'keepMounted children continue receiving fresh props while collapsed',
    );
    await page.evaluate(() => (window.animLog = []));
    await page.locator('#toggle-keep').click();
    await finishAnimations(page.locator('#keep-collapse'));
    assert.equal(await page.locator('#keep-draft').inputValue(), '未提交草稿');
    const expandEntry = (await page.evaluate(() => window.animLog)).find(
      (e) => e.id === 'keep-collapse' && e.frames[0]?.height === '0px',
    );
    assert.ok(expandEntry && expandEntry.duration === 240, 'expand uses 240ms height animation');

    // 3. Rapid mid-flight reversal continues from live height without snapping.
    const renderedHeight = await page.evaluate(async () => {
      window.animLog = [];
      const box = document.querySelector('#keep-collapse');
      const toggle = document.querySelector('#toggle-keep');
      toggle.click();
      await Promise.resolve();
      const heightAnimation = box.getAnimations()[0];
      heightAnimation.pause();
      heightAnimation.currentTime = 55;
      const height = box.getBoundingClientRect().height;
      toggle.click();
      return height;
    });
    await finishAnimations(page.locator('#keep-collapse'));
    const reverseEntries = (await page.evaluate(() => window.animLog)).filter(
      (e) => e.id === 'keep-collapse' && e.frames[0]?.height,
    );
    assert.equal(reverseEntries.length, 2, 'collapse then reverse expand recorded');
    const midHeight = parseFloat(reverseEntries[1].frames[0].height);
    assert.ok(renderedHeight > 0 && renderedHeight < 135);
    assert.ok(Math.abs(midHeight - renderedHeight) < 1, 'reversal starts at the displayed height');
    assert.equal(
      await page.locator('#keep-collapse').evaluate((el) => el.style.height || el.style.overflow),
      '',
      'inline height/overflow cleaned on settle',
    );

    // A completed exit must release its filled height/opacity before a later reopen.
    await page.locator('#toggle-keep').click();
    await page.locator('#keep-collapse').waitFor({ state: 'hidden' });
    await page.locator('#toggle-keep').click();
    await finishAnimations(page.locator('#keep-collapse'));
    const reopened = await page.locator('#keep-collapse').evaluate((box) => ({
      outer: box.offsetHeight,
      content: box.firstElementChild.offsetHeight,
      opacity: getComputedStyle(box.firstElementChild).opacity,
    }));
    assert.ok(reopened.content > 0);
    assert.equal(reopened.outer, reopened.content);
    assert.equal(reopened.opacity, '1');

    // 4. Keyboard collapse is immediate and cancels in-flight; mouse restores motion.
    await page.evaluate(() => (window.animLog = []));
    await page.locator('#toggle-keep').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#keep-collapse').isHidden(), true);
    assert.equal(
      (await page.evaluate(() => window.animLog)).filter((e) => e.id === 'keep-collapse').length,
      0,
      'keyboard collapse runs zero animations',
    );
    await page.locator('#toggle-keep').click();
    await finishAnimations(page.locator('#keep-collapse'));
    assert.ok(
      (await page.evaluate(() => window.animLog)).some((e) => e.id === 'keep-collapse'),
      'mouse click restores disclosure animation after keyboard',
    );

    // 5. unmountOnExit removes DOM after collapse and cleans up safely if unmounted mid-flight.
    await page.locator('#toggle-unmount').click();
    await finishAnimations(page.locator('#unmount-collapse'));
    assert.equal(await page.locator('#unmount-collapse').isVisible(), true);
    await page.locator('#toggle-unmount').click();
    assert.equal(await page.locator('#unmount-collapse').evaluate((n) => n.inert), true);
    await page.locator('#destroy-unmount').click();
    await page.waitForTimeout(240);
    assert.equal(await page.locator('#unmount-collapse').count(), 0);

    // 6. useHeightTransition exact 80 -> 160 (same mode) -> 60 (switch mode) continuity check!
    assert.equal((await page.locator('#sync-height').boundingBox()).height, 80);
    await page.locator('#grow-same-mode').click();
    await page.waitForFunction(
      () => document.getElementById('sync-height').getBoundingClientRect().height === 160,
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await page.evaluate(() => (window.animLog = []));
    await page.locator('#switch-to-60').click();
    await finishAnimations(page.locator('#sync-height'));
    const heightAnim = (await page.evaluate(() => window.animLog)).find(
      (e) => e.id === 'sync-height',
    );
    assert.ok(heightAnim, 'height transition ran on mode change');
    assert.equal(
      heightAnim.frames[0].height,
      '160px',
      'starts from live grown 160px, not stale 80px',
    );
    assert.equal(heightAnim.frames[1].height, '60px', 'ends at 60px');
    assert.equal(heightAnim.duration, 190, 'shrink uses 190ms');

    // Reduced motion immediately suppresses useHeightTransition.
    await emulateMedia(page, { reducedMotion: 'reduce' });
    await page.evaluate(() => (window.animLog = []));
    await page.locator('#switch-back-160').click();
    assert.equal(
      (await page.evaluate(() => window.animLog)).filter((e) => e.id === 'sync-height').length,
      0,
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'board/list top preview height stays synchronized with task disclosure and archive rows respect keyboard vs mouse',
  { timeout: 45000 },
  async (t) => {
    const script = (
      await build({
        stdin: {
          loader: 'tsx',
          resolveDir: process.cwd(),
          contents: `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPreview } from './ui/settings/settings-preview';
import { TaskSettings } from './ui/settings/task-settings';
import { ChatArchiveSettings } from './ui/settings/chat-archive-settings';
import { createDemoTasks } from './ui/shared/demo-state';
import { setLocale } from './ui/shared/i18n.js';

setLocale('zh-CN');
const initial = await createDemoTasks().request('tasks/state');

function App() {
  const [tasks, setTasks] = useState(initial);
  const command = async (data: Record<string, unknown>) => {
    setTasks((prev) => ({
      ...prev,
      store: {
        ...prev.store,
        revision: prev.store.revision + 1,
        ...(data.displayMode ? { displayMode: data.displayMode as 'board' | 'list' } : {}),
        ...(data.viewMode ? { viewMode: data.viewMode as 'merged' | 'expanded' } : {}),
      },
    }));
    return {};
  };
  return (
    <div className="settings-app" style={{ maxWidth: 820, margin: 'auto', padding: 24 }}>
      <SettingsPreview
        page="board"
        tasks={tasks}
        model={null}
        bots={null}
        form={null}
        features={null}
        surfaces={null}
        view={null}
        dirty={false}
        live
      />
      <TaskSettings tasks={{ state: tasks, error: '', busy: false, command, reload: async () => {} }} />
      <ChatArchiveSettings disabled={false} targetId="fixture" notify={() => {}} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
`,
        },
        bundle: true,
        format: 'esm',
        write: false,
        jsx: 'automatic',
        plugins: [inlineCssPlugin],
        define: { 'process.env.NODE_ENV': '"production"' },
      })
    ).outputFiles[0].text;

    const index = await readFile('target/web/index.html', 'utf8');
    let css = '';
    for (const [, href] of index.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
      css += await readFile(`target/web${href}`, 'utf8');

    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1080, height: 960 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.route('http://sync-preview.test/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/chat-archive') {
        const body = route.request().postDataJSON();
        return route.fulfill({
          json:
            body.op === 'list'
              ? {
                  total: 2,
                  groups: [{ cli: 'codex', count: 2 }],
                  projects: [{ id: 'p', label: 'Palboo', count: 2 }],
                }
              : {
                  id: 'plan-1',
                  cli: body.cli,
                  total: 2,
                  groups: [{ cli: 'codex', count: 2 }],
                  count: 2,
                  running: 0,
                  scheduled: 0,
                  sessions: [
                    {
                      id: 'sess-1',
                      cli: 'codex',
                      title: '动效验证会话一',
                      project: 'p',
                      projectLabel: 'Palboo',
                      created: Date.UTC(2026, 10, 10),
                      updated: Date.UTC(2026, 10, 20),
                      active: false,
                      scheduled: false,
                    },
                    {
                      id: 'sess-2',
                      cli: 'codex',
                      title: '动效验证会话二',
                      project: 'p',
                      projectLabel: 'Palboo',
                      created: Date.UTC(2026, 10, 11),
                      updated: Date.UTC(2026, 10, 21),
                      active: false,
                      scheduled: false,
                    },
                  ],
                },
        });
      }
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div>`,
      });
    });

    await page.goto('http://sync-preview.test/#token=fixture');
    await page.evaluate(() => {
      window.animLog = [];
      const orig = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        window.animLog.push({
          cls: this.className,
          frames,
          duration: typeof options === 'number' ? options : options?.duration,
        });
        return orig.call(this, frames, options);
      };
    });
    await page.addScriptTag({ type: 'module', content: script });
    await page.locator('.preview-scenes').waitFor();

    // Preserve unsaved group draft across board -> list -> board transition.
    await page.getByLabel('新分组名称', { exact: true }).fill('草稿分组');
    const boardPreviewHeight = (await page.locator('.preview-scenes').boundingBox()).height;
    assert.equal(Math.round(boardPreviewHeight), 356);

    await page.evaluate(() => (window.animLog = []));
    await page.getByLabel('显示方式', { exact: true }).selectOption('list');
    await finishAnimations(page.locator('.settings-app'));
    const listPreviewHeight = (await page.locator('.preview-scenes').boundingBox()).height;
    assert.equal(Math.round(listPreviewHeight), 312, 'list preview adopts compact 312px height');
    const collapseLogs = await page.evaluate(() => window.animLog);
    assert.ok(
      collapseLogs.some(
        (e) =>
          String(e.cls).includes('preview-scenes') &&
          e.frames[0]?.height === '356px' &&
          e.frames[1]?.height === '312px' &&
          e.duration === 190,
      ),
      'top preview animates 356 -> 312 in 190ms',
    );
    assert.ok(
      collapseLogs.some((e) => String(e.cls).includes('settings-collapse') && e.duration === 190),
      'board options collapse in sync (190ms)',
    );
    assert.equal(await page.locator('#board-view-mode').isVisible(), false);

    await page.evaluate(() => (window.animLog = []));
    await page.getByLabel('显示方式', { exact: true }).selectOption('board');
    await finishAnimations(page.locator('.settings-app'));
    assert.equal(Math.round((await page.locator('.preview-scenes').boundingBox()).height), 356);
    assert.equal(await page.getByLabel('新分组名称', { exact: true }).inputValue(), '草稿分组');
    const expandLogs = await page.evaluate(() => window.animLog);
    assert.ok(
      expandLogs.some(
        (e) =>
          String(e.cls).includes('preview-scenes') &&
          e.frames[0]?.height === '312px' &&
          e.frames[1]?.height === '356px' &&
          e.duration === 240,
      ),
      'top preview animates 312 -> 356 in 240ms',
    );

    // Archive time filter disclosure + archive session detail mouse vs Enter.
    await page.evaluate(() => (window.animLog = []));
    await page.getByLabel('时间条件', { exact: true }).selectOption('range');
    await finishAnimations(page.locator('#chat-archive'));
    assert.ok(
      (await page.evaluate(() => window.animLog)).some(
        (e) => String(e.cls).includes('settings-collapse') && e.duration === 240,
      ),
    );
    await page.getByLabel('时间条件', { exact: true }).selectOption('all');
    await finishAnimations(page.locator('#chat-archive'));
    await page.getByLabel('归档范围', { exact: true }).selectOption('all');
    await page.getByRole('button', { name: '预览归档', exact: true }).click();
    const firstRow = page.locator('.archive-session-row').first();
    await firstRow.waitFor();
    await page.evaluate(() => (window.animLog = []));
    await firstRow.click();
    await finishAnimations(page.locator('.archive-session-list'));
    assert.equal(await firstRow.getAttribute('aria-expanded'), 'true');
    assert.ok(
      (await page.evaluate(() => window.animLog)).some(
        (e) => String(e.cls).includes('settings-collapse') && e.duration === 240,
      ),
      'mouse click expands archive details with animation',
    );
    await page.evaluate(() => (window.animLog = []));
    await firstRow.press('Enter');
    assert.equal(await firstRow.getAttribute('aria-expanded'), 'false');
    assert.equal(
      (await page.evaluate(() => window.animLog)).filter((e) =>
        String(e.cls).includes('settings-collapse'),
      ).length,
      0,
      'Enter collapses archive details immediately',
    );
    assert.deepEqual(errors, []);
  },
);
