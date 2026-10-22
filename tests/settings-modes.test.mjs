/* [INPUT]: Built settings page, synthetic authenticated services and isolated Chromium.
 * [OUTPUT]: Shared drafts/DOM, title-free page hierarchy, terminology controls/tools, compact preview geometry and responsive navigation.
 * [POS]: No real user data, model requests or host restarts.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { emulateMedia } from './browser-motion.mjs';
import { fixtureSettings } from './fixtures.mjs';

test(
  'unified settings retain grouped pages, legacy links, drafts, drawers and reading without navigation writes',
  { timeout: 120000 },
  async (testContext) => {
    let settings = structuredClone(fixtureSettings),
      rejectNext = false,
      rejectSurface = false;
    const writes = [];
    const previewGeometry = [];
    let panelTheme = null;
    let connectionStatus = 'connected';
    const streams = new Set();
    const terminology = {
      entries: [
        {
          id: 'fixture-term',
          name: '合成术语',
          english: 'Fixture',
          definition: '合成释义',
          aliases: [],
          category: ['测试'],
          example: '',
          source: '',
        },
      ],
      preferences: {
        enabled: true,
        semantic: false,
        autoExpand: false,
        cardStyle: 'plain',
        mastered: [],
        favorites: [],
        revision: 1,
      },
    };
    let appearance = {
      revision: 1,
      webRevision: 1,
      detached: false,
      alwaysOnTop: true,
      launcherAction: 'inside',
      position: null,
      typography: { mode: 'custom', source: 'body', scale: 100, customSize: 17 },
      ui: {
        width: 500,
        height: 620,
        dockWidth: 340,
        layoutMode: 'workbench',
        open: true,
        dockOpen: true,
        splitRatio: 0.45,
        fontOffset: 0,
        fontSizes: { outline: 17, next: 16, board: 15, model: 14 },
        labelOnly: false,
        promptClickMode: 'fill',
        viewOrder: ['next', 'outline'],
      },
    };
    let surfaces = {
      revision: 1,
      preferences: {
        themes: Object.fromEntries(
          ['sidebar', 'overlay', 'desktop', 'edge'].map((p) => [
            p,
            { theme: 'frosted', liquidVariant: 'regular' },
          ]),
        ),
        edge: { edge: 'right', screen: '', position: 0.5, keepOpen: false },
      },
    };
    const features = {
      mainPlacement: 'sidebar',
      features: ['outline', 'next', 'board', 'model'].map((id) => ({
        id,
        open: true,
        placement: id === 'model' ? 'edge' : 'sidebar',
        owner: id,
        pending: null,
      })),
      layouts: {},
    };
    const tasks = {
      status: '本地看板',
      store: {
        schema: 2,
        revision: 1,
        boardEnabled: true,
        syncEnabled: false,
        bindings: { calendarId: '' },
        columns: [
          { id: 'todo', title: '待办' },
          { id: 'doing', title: '进行中' },
          { id: 'done', title: '完成' },
        ],
        tasks: [],
        inflight: null,
      },
    };
    const view = () => ({
      version: 'fixture',
      configurationRevision: settings.configurationRevision,
      connection: {
        status: connectionStatus,
        targets: [],
        endpoint: 'fixture',
        targetId: 'fixture',
      },
      desktop: { hasAnswer: false, headings: 0 },
      model: { provider: 'api', model: settings.model, available: true },
      panelPreferences: appearance,
      panelTheme,
      panelFontBase: 13,
    });
    const publishTheme = (theme, status = 'connected') => {
      panelTheme = theme;
      connectionStatus = status;
      for (const stream of streams) stream.write('data: ' + JSON.stringify(view()) + '\n\n');
    };
    const server = createServer(async (req, res) => {
      const path = req.url.split('?')[0];
      if (path.startsWith('/api/')) {
        if (req.headers.authorization !== 'Bearer fixture') {
          res
            .writeHead(401, { 'Content-Type': 'application/json' })
            .end('{"message":"unauthorized"}');
          return;
        }
        if (path === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: ' + JSON.stringify(view()) + '\n\n');
          streams.add(res);
          res.on('close', () => streams.delete(res));
          return;
        }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : null;
        if (body && body.op !== 'state') writes.push({ path, body });
        let value;
        if (path === '/api/settings') {
          if (body) {
            if (rejectNext) {
              rejectNext = false;
              res
                .writeHead(409, { 'Content-Type': 'application/json' })
                .end('{"message":"合成保存失败"}');
              return;
            }
            settings = {
              ...settings,
              ...body,
              configurationRevision: settings.configurationRevision + 1,
            };
          }
          value = settings;
        } else if (path === '/api/features') {
          if (body?.op === 'main-placement') {
            features.mainPlacement = body.placement;
            for (const entry of features.features)
              if (entry.placement !== 'edge') entry.placement = body.placement;
          }
          if (body?.op === 'main-layout') features.layouts[body.placement] = body.layout;
          value = body?.op === 'bots-catalog' ? { stale: false, bots: [] } : features;
        } else if (path === '/api/surfaces') {
          if (body?.op === 'save') {
            if (rejectSurface) {
              rejectSurface = false;
              res
                .writeHead(409, { 'Content-Type': 'application/json' })
                .end('{"message":"合成材质保存失败"}');
              return;
            }
            surfaces = {
              ...surfaces,
              revision: surfaces.revision + 1,
              preferences: {
                ...surfaces.preferences,
                themes: { ...surfaces.preferences.themes, [body.placement]: body.theme },
              },
            };
          }
          value = surfaces;
        } else if (path === '/api/surfaces/displays')
          value = { screens: [], nativeGlassAvailable: true };
        else if (path === '/api/appearance') {
          if (body)
            appearance = {
              ...appearance,
              ...body,
              ui: { ...appearance.ui, ...body.ui },
              revision: appearance.revision + 1,
            };
          value = appearance;
        } else if (path === '/api/terminology') {
          if (body?.action === 'settings') {
            assert.equal(body.revision, terminology.preferences.revision);
            const { action, revision, ...patch } = body;
            assert.equal(
              Object.keys(patch).length,
              1,
              'a term preference saves only its own field',
            );
            Object.assign(terminology.preferences, patch, { revision: revision + 1 });
          }
          if (body?.action === 'master') terminology.preferences.mastered = [body.id];
          if (body?.action === 'restore') terminology.preferences.mastered = [];
          value = terminology;
        } else if (path === '/api/tasks/state') value = tasks;
        else if (path === '/api/performance')
          value = {
            preferences: { integrationEnabled: true, monitoringEnabled: false, revision: 0 },
            connectionStatus: 'connected',
            sample: null,
          };
        else if (path === '/api/dev/sources')
          value = {
            active: '/fixture/main',
            loaded: true,
            connected: true,
            resource: 'fixture',
            sources: [
              { path: '/fixture/main', branch: 'main', commit: '1234567', dirty: false },
              {
                path: '/fixture/a-long-worktree-path-for-menu-width-and-wrapping-checks',
                branch: 'codex/long-source-name',
                commit: '7654321',
                dirty: false,
              },
            ],
          };
        else if (path === '/api/model-control/state') value = { preferences: { enabled: true } };
        else value = { ok: true };
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
        return;
      }
      try {
        const data = await readFile(
          join(process.cwd(), 'target/web', path === '/' ? 'index.html' : path),
        );
        res
          .writeHead(200, {
            'Content-Type': path.endsWith('.js')
              ? 'text/javascript'
              : path.endsWith('.css')
                ? 'text/css'
                : path.endsWith('.png')
                  ? 'image/png'
                  : 'text/html',
          })
          .end(data);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browserServer, cleanupPromise;
    const cleanup = () =>
      (cleanupPromise ||= (async () => {
        await browserServer?.kill();
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      })());
    testContext.after(cleanup);
    browserServer = await chromium.launchServer({ headless: true });
    const browser = await chromium.connect(browserServer.wsEndpoint());
    const context = await browser.newContext({
      viewport: { width: 420, height: 800 },
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const category = async (id) => {
      const group = [
        'features',
        'next',
        'prompts',
        'terminology',
        'board',
        'model-control',
      ].includes(id)
        ? '功能'
        : ['surfaces', 'appearance'].includes(id)
          ? '界面'
          : '系统';
      const link = page.locator(`.settings-nav a[href="#settings-${id}"]`);
      await link.waitFor({ state: 'attached' });
      if (!(await link.isVisible()))
        await page.getByRole('button', { name: group, exact: true }).click();
      await link.click();
    };
    const roundTrip = async () => {
      const current = await page.locator('.settings-app').getAttribute('data-settings-category');
      await category(current === 'features' ? 'model' : 'features');
      await category(current);
    };
    const themeButton = (name) =>
      page
        .locator('.settings-theme-menu')
        .getByRole('button', { name, exact: true, includeHidden: true });
    const chooseTheme = async (name, target = page) => {
      await target.locator('.settings-theme-trigger').click();
      await target
        .getByRole('group', { name: '设置页主题' })
        .getByRole('button', { name, exact: true })
        .click();
      await target.waitForFunction(
        () => !document.querySelector('.settings-theme-trigger').disabled,
      );
    };
    const expectTheme = async (theme) => {
      await page.waitForFunction(
        (expected) =>
          document.documentElement.dataset.settingsTheme === expected &&
          getComputedStyle(document.documentElement).colorScheme === expected &&
          getComputedStyle(document.documentElement).backgroundColor ===
            (expected === 'light' ? 'rgb(250, 250, 250)' : 'rgb(25, 25, 27)'),
        theme,
      );
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
        theme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(25, 25, 27)',
      );
      assert.equal(
        await page.locator('.settings-brand img').evaluate((n) => getComputedStyle(n).filter),
        'none',
        'the original brand icon stays unchanged in both themes',
      );
      assert.equal(await page.getByRole('link', { name: 'Palboo 设置', exact: true }).count(), 1);
      await page.waitForFunction(
        (expected) => {
          const wordmark = document.querySelector('.settings-wordmark');
          const brand = document.querySelector('.settings-brand');
          return (
            getComputedStyle(wordmark).fill === expected &&
            getComputedStyle(brand).color === expected
          );
        },
        theme === 'light' ? 'rgb(39, 39, 42)' : 'rgb(238, 238, 239)',
      );
    };
    try {
      await context.addInitScript(() => {
        localStorage.setItem('buddy-settings-mode', 'simple');
      });
      await page.goto(origin + '/#token=fixture');
      await page.getByRole('switch', { name: '启用大纲', exact: true }).waitFor();
      assert.equal(await themeButton('自动').getAttribute('aria-pressed'), 'true');
      await expectTheme('dark'); // Before Codex is known, the browser supplies the fallback.
      await emulateMedia(page, { colorScheme: 'light' });
      await expectTheme('light');
      publishTheme('dark');
      await expectTheme('dark'); // The host wins even when the browser prefers light.
      publishTheme(null, 'unresponsive');
      await page.getByText('页面暂未响应', { exact: true }).waitFor();
      await expectTheme('dark'); // A missing host theme retains the last valid snapshot.
      publishTheme('light');
      await expectTheme('light');
      await emulateMedia(page, { colorScheme: 'dark' });
      await expectTheme('light');
      assert.equal(writes.length, 0, 'theme subscription never writes business preferences');
      // Exercise the styled native picker through actual keyboard/pointer input, not selectOption.
      await category('next');
      const generation = page.getByLabel('建议生成方式', { exact: true });
      await generation.click();
      await page.locator('#generation-mode:open').waitFor();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.equal(await generation.inputValue(), 'manual', 'Escape cancels the pending choice');
      assert.equal(writes.length, 0, 'opening and dismissing a menu never saves');
      await generation.press('Space');
      await page.locator('#generation-mode:open').waitFor();
      await page.keyboard.press('End');
      const menuSave = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings') && response.request().method() === 'POST',
      );
      await page.keyboard.press('Enter');
      await (await menuSave).finished();
      assert.equal(
        settings.generationMode,
        'auto',
        'keyboard selection uses the original save queue',
      );
      await generation.click();
      const restoreSave = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings') && response.request().method() === 'POST',
      );
      await page.getByRole('option', { name: '手动刷新', exact: true }).click();
      await (await restoreSave).finished();
      assert.equal(settings.generationMode, 'manual', 'pointer selection uses the same queue');
      writes.length = 0;
      await category('features');
      assert.equal(await page.locator('.settings-mode').count(), 0);
      assert.equal(await page.getByRole('navigation', { name: '设置分类' }).isVisible(), true);
      assert.equal(await page.getByRole('switch').count(), 7);
      assert.equal(await page.getByRole('button', { name: /^打开/ }).count(), 0);
      await category('model');
      await category('features');
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector('.settings-app').dataset.settingsCategory === 'model',
      );
      assert.equal(await page.getByLabel('模型名称', { exact: true }).isVisible(), true);
      assert.equal(writes.length, 0);
      const model = page.getByLabel('模型名称', { exact: true }),
        key = page.getByLabel('API 密钥', { exact: true });
      const modelNode = await model.elementHandle();
      const firstSave = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings') && response.request().method() === 'POST',
      );
      await model.fill('未保存模型草稿');
      await key.fill('fixture-secret-draft');
      // Blur of model to key schedules a normal save; wait for it before exercising navigation-only edits.
      await (await firstSave).finished();
      await page.locator('.settings-save[data-save-state="dirty"]').waitFor({ state: 'attached' });
      writes.length = 0;
      await key.fill('fixture-unsaved-key');
      await chooseTheme('深色');
      await expectTheme('dark');
      publishTheme('light');
      await expectTheme('dark');
      await chooseTheme('浅色');
      await expectTheme('light');
      await chooseTheme('自动');
      assert.equal(await key.inputValue(), 'fixture-unsaved-key');
      assert.equal(await model.evaluate((n, original) => n === original, modelNode), true);
      assert.equal(writes.length, 3);
      assert.ok(
        writes.every(
          (w) =>
            w.path === '/api/appearance' &&
            Object.keys(w.body).sort().join(',') === 'expectedRevision,settingsTheme',
        ),
      );
      writes.length = 0; // Theme-only saves never submit the focused model/key draft.
      await category('model');
      assert.equal(await model.inputValue(), '未保存模型草稿');
      assert.equal(await key.inputValue(), 'fixture-unsaved-key');
      assert.equal(await model.evaluate((n, original) => n === original, modelNode), true);
      await roundTrip();
      assert.equal(await model.isVisible(), true);
      assert.equal(await key.inputValue(), 'fixture-unsaved-key');
      assert.equal(writes.length, 0, 'page changes do not save typed drafts');
      const splitWrites = writes.length;
      for (const id of [
        'features',
        'next',
        'prompts',
        'board',
        'model-control',
        'surfaces',
        'appearance',
        'connection',
        'codex-host',
      ]) {
        await category(id);
        assert.equal(await model.isVisible(), false, `${id} does not include model configuration`);
        assert.equal(await model.inputValue(), '未保存模型草稿');
        assert.equal(await key.inputValue(), 'fixture-unsaved-key');
        assert.equal(await model.evaluate((n, original) => n === original, modelNode), true);
        assert.equal(await page.getByLabel('搜索术语', { exact: true }).isVisible(), false);
        if (['next', 'prompts', 'board', 'model-control'].includes(id))
          assert.equal(await page.locator('.preview-scene[data-active="true"]').count(), 1);
        if (id === 'features') {
          assert.equal(await page.getByRole('switch').count(), 7);
          assert.equal(
            await page.getByRole('button', { name: '模型分组', exact: true }).isVisible(),
            false,
          );
        }
        if (id === 'surfaces')
          assert.equal(await page.getByLabel('侧栏主题', { exact: true }).isVisible(), false);
        if (id === 'appearance')
          assert.equal(await page.getByLabel('主界面布局', { exact: true }).isVisible(), false);
      }
      assert.equal(
        writes.length,
        splitWrites,
        'all subpage navigation preserves unsaved fields without writes',
      );
      // A not-yet-loaded library remains searchable and opens its own page and drawer.
      const splitSearch = page.getByRole('searchbox', { name: '搜索设置' });
      await page.getByRole('button', { name: '搜索设置', exact: true }).click();
      await splitSearch.fill('词库管理');
      await splitSearch.press('Enter');
      await page.getByRole('dialog', { name: '词库管理', exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, '#settings-terminology/settings-library');
      await page.getByRole('button', { name: '关闭词库管理', exact: true }).click();
      await page.getByLabel('搜索术语', { exact: true }).waitFor();
      assert.equal(
        await page.getByText('结合问答核对词义与识别概念', { exact: true }).isVisible(),
        true,
      );
      await page.getByRole('button', { name: '已掌握：合成术语', exact: true }).click();
      await page.getByRole('button', { name: '恢复提示：合成术语', exact: true }).click();
      await page.getByRole('button', { name: '已掌握：合成术语', exact: true }).waitFor();
      assert.deepEqual(terminology.preferences.mastered, []);
      const termSettings = page.locator('#settings-terminology');
      const termSwitch = page.getByRole('switch', {
        name: '结合问答核对词义与识别概念',
        exact: true,
      });
      await termSwitch.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="结合问答核对词义与识别概念"]')
            .getAttribute('aria-checked') === 'true',
      );
      assert.equal(terminology.preferences.semantic, true);
      await termSwitch.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="结合问答核对词义与识别概念"]')
            .getAttribute('aria-checked') === 'false',
      );
      await page.getByLabel('术语卡片背景', { exact: true }).selectOption('native-glass');
      await page.getByLabel('术语卡片液态变体', { exact: true }).selectOption('clear');
      await page.getByLabel('术语卡片背景', { exact: true }).selectOption('custom');
      await page.getByLabel('术语卡片自定义颜色', { exact: true }).fill('#334455');
      await page.waitForFunction(
        () =>
          document.querySelector('.term-preview .term-card')?.getAttribute('data-material') ===
          'custom',
      );
      await page.getByLabel('术语卡片背景', { exact: true }).selectOption('matte');
      await page.waitForFunction(
        () =>
          document.querySelector('.term-preview .term-card')?.getAttribute('data-material') ===
          'matte',
      );
      const beforeTermNavigation = writes.length;
      await page.getByRole('searchbox', { name: '搜索术语', exact: true }).fill('Fixture');
      await termSettings.locator('.term-result-name').click();
      assert.equal(
        await termSettings.locator('.term-result-name').getAttribute('aria-pressed'),
        'true',
      );
      await page.getByLabel('只看收藏', { exact: true }).check();
      await termSettings.getByText('没有匹配的术语', { exact: true }).waitFor();
      await page.getByLabel('只看收藏', { exact: true }).uncheck();
      await page.getByRole('button', { name: '词库管理', exact: true }).click();
      await page.getByLabel('中文术语名', { exact: true }).fill('未保存的术语');
      await page.getByRole('button', { name: '关闭词库管理', exact: true }).click();
      await category('next');
      await category('terminology');
      await page.getByRole('button', { name: '词库管理', exact: true }).click();
      assert.equal(
        await page.getByLabel('中文术语名', { exact: true }).inputValue(),
        '未保存的术语',
      );
      await page.getByRole('button', { name: '关闭词库管理', exact: true }).click();
      assert.equal(
        await page.getByRole('searchbox', { name: '搜索术语', exact: true }).inputValue(),
        'Fixture',
      );
      assert.equal(
        writes.length,
        beforeTermNavigation,
        'term search, filters, preview and drawer navigation do not save drafts',
      );
      await category('board');
      assert.equal(await page.getByLabel('分组名称：待办', { exact: true }).isVisible(), true);
      const group = page.getByLabel('分组名称：待办', { exact: true });
      await group.fill('未保存分组');
      await roundTrip();
      assert.equal(await group.inputValue(), '未保存分组');
      assert.equal(await group.isVisible(), true);
      await category('model');
      // 前面的普通失焦允许保存；先完成它，再单独验证模式切换不保存新的限额草稿。
      await page.locator('.settings-save[data-save-state="saving"]').waitFor({ state: 'detached' });
      if (await page.locator('.settings-save[data-save-state="dirty"]').count())
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await page.locator('.settings-save[data-save-state="saved"]').waitFor({ state: 'attached' });
      const limits = page.locator('#settings-limits');
      await page.getByRole('button', { name: '高级设置', exact: true }).click();
      await page.getByLabel('输入字符上限', { exact: true }).fill('18000');
      await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
      await roundTrip();
      await page.getByRole('button', { name: '高级设置', exact: true }).click();
      assert.equal(await limits.locator('dialog').getAttribute('open'), '');
      assert.equal(await page.getByLabel('输入字符上限', { exact: true }).inputValue(), '18000');
      await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
      const before = writes.length;
      await roundTrip();
      assert.equal(
        writes.length,
        before,
        JSON.stringify(
          writes.map(({ path, body }) => ({
            path,
            keys: Object.keys(body),
            maxInputChars: body.maxInputChars,
          })),
        ),
      );
      await page.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
      const scroll = await page.evaluate(() => scrollY);
      assert.ok(scroll > 100);
      await roundTrip();
      assert.ok(
        Math.abs((await page.evaluate(() => scrollY)) - scroll) < 3,
        `detail reading position restored: before=${scroll}, after=${await page.evaluate(() => scrollY)}`,
      );
      rejectNext = true;
      await model.fill('失败后保留模型');
      await page.getByRole('region', { name: '共享模型连接', exact: true }).click();
      await page.locator('.settings-feedback').filter({ hasText: '合成保存失败' }).waitFor();
      await roundTrip();
      assert.equal(await model.inputValue(), '失败后保留模型');
      await page.setViewportSize({ width: 1100, height: 850 });
      assert.equal(await page.getByLabel('详细设置分类').isVisible(), false);
      assert.equal(
        await page.getByRole('link', { name: '布局与位置', exact: true }).isVisible(),
        true,
      );
      await page.getByRole('link', { name: '布局与位置', exact: true }).click();
      for (const label of ['侧栏宽度（px）', '大纲默认位置', '贴边屏幕'])
        assert.equal(
          await page.getByLabel(label, { exact: true }).isVisible(),
          true,
          `${label} is directly visible`,
        );
      await category('appearance');
      await page.getByLabel('自定义字号（px）', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('自定义字号（px）', { exact: true }).inputValue(), '17');
      const font = page.getByLabel('自定义字号（px）', { exact: true });
      const beforeFont = writes.length;
      await font.fill('19.5');
      await roundTrip();
      assert.equal(await font.inputValue(), '19.5');
      assert.equal(appearance.typography.customSize, 17);
      assert.equal(appearance.ui.fontSizes.outline, 17);
      assert.equal(writes.length, beforeFont, 'page navigation keeps unsaved font input');
      const theme = page.locator('#theme-sidebar');
      assert.equal(await theme.locator('summary').count(), 0);
      await roundTrip();
      await page.getByLabel('侧栏主题', { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel('侧栏主题', { exact: true }).isVisible(),
        true,
        'theme controls stay visible after page navigation',
      );

      await page.setViewportSize({ width: 360, height: 800 });
      await category('features');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'settings controls fit the narrow viewport',
      );
      await mkdir('target/reports', { recursive: true });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
        await page.screenshot({
          path: 'target/reports/settings-unified-switches.png',
          fullPage: true,
        });
      await category('surfaces');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'settings controls fit the narrow viewport',
      );
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
        await page.screenshot({
          path: 'target/reports/settings-unified-layout.png',
          fullPage: true,
        });
      const count = writes.length;
      await category('features');
      await page.reload();
      await page.getByRole('switch', { name: '启用大纲', exact: true }).waitFor();
      assert.equal(
        await page.locator('.settings-app').getAttribute('data-settings-category'),
        'features',
      );
      assert.equal(writes.length, count);
      for (const hash of ['settings-simple', 'settings-overview']) {
        await page.goto(origin + '/#' + hash);
        await page.getByRole('main', { name: '常用开关', exact: true }).waitFor();
        assert.equal(await page.getByRole('navigation', { name: '设置分类' }).isVisible(), true);
        assert.equal(await page.locator('.settings-mode').count(), 0);
      }
      assert.equal(writes.length, count, 'legacy mode and hashes never reset configuration');
      await page.goto(origin + '/#settings-limits/timeout');
      await page.getByRole('main', { name: '模型服务', exact: true }).waitFor();
      await page.getByLabel('请求超时（秒）', { exact: true }).waitFor();
      assert.equal(await limits.locator('dialog').getAttribute('open'), '');
      assert.equal(settings.directionSource, fixtureSettings.directionSource);
      assert.equal(appearance.ui.fontSizes.outline, 17);
      assert.equal(tasks.store.syncEnabled, false);

      await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
      // Previews consume existing saved snapshots; rejected saves never look successful.
      await page.setViewportSize({ width: 1360, height: 900 });
      await page.getByRole('link', { name: '布局与位置', exact: true }).click();
      const preview = page.getByRole('complementary', { name: '联动预览' });
      await preview.locator('[data-ready="true"]').waitFor();
      assert.equal(
        await preview.locator('[data-preview-workspace]').getAttribute('data-material'),
        'frosted',
      );
      rejectSurface = true;
      await category('appearance');
      await page.getByLabel('侧栏主题', { exact: true }).selectOption('black');
      await page.getByText('合成材质保存失败', { exact: false }).waitFor();
      assert.equal(
        await preview.locator('[data-preview-workspace]').getAttribute('data-material'),
        'frosted',
      );
      await category('appearance');
      await page.getByLabel('侧栏主题', { exact: true }).selectOption('black');
      await preview.locator('[data-preview-workspace][data-material="black"]').waitFor();
      await category('surfaces');
      await page.getByLabel('主界面布局', { exact: true }).selectOption('horizontal');
      await page.waitForFunction(
        () => document.querySelectorAll('.layout-demo .csw-workbench-pane').length === 3,
      );
      assert.equal(
        await preview.locator('.csw-workbench-pane').count(),
        3,
        'only opened main features appear',
      );
      await category('surfaces');
      await page.getByRole('button', { name: '页面浮层', exact: true }).click();
      await preview.locator('.layout-demo-canvas[data-demo-placement="overlay"]').waitFor();
      assert.equal(
        await preview.locator('[data-preview-workspace]').getAttribute('data-material'),
        'frosted',
        'each placement keeps its own material',
      );
      const previewWrites = writes.length;
      await preview.getByRole('button', { name: '贴边 / 刘海', exact: true }).click();
      await preview.locator('.layout-demo-canvas[data-demo-placement="edge"]').waitFor();
      await preview.getByRole('button', { name: '恢复已保存配置', exact: true }).click();
      assert.equal(writes.length, previewWrites, 'preview navigation never moves real features');

      await page.bringToFront();
      features.layouts.overlay = {
        axis: 'vertical',
        groups: [
          { ids: ['outline'], active: 'outline', weight: 1 },
          {
            axis: 'horizontal',
            weight: 2,
            groups: [
              { ids: ['board'], active: 'board', weight: 1 },
              { ids: ['next'], active: 'next', weight: 2 },
            ],
          },
        ],
      };
      await preview.locator('[data-axis="vertical"] [data-axis="horizontal"]').waitFor();
      assert.equal(
        await preview.locator('.csw-workbench-pane').count(),
        3,
        'nested layout comes from the saved tree',
      );
      features.features.find((entry) => entry.id === 'board').open = false;
      await page.waitForFunction(
        () => document.querySelectorAll('.csw-workbench-pane').length === 2,
      );
      assert.equal(await preview.getByRole('tab', { name: '看板', exact: true }).count(), 0);

      await page.getByRole('link', { name: '常用开关', exact: true }).click();
      const demoWrites = writes.length;
      await preview.getByRole('button', { name: /完善实现方案/ }).click();
      assert.equal(await preview.getByRole('status').textContent(), '完善实现方案');
      assert.equal(writes.length, demoWrites, 'sample interactions do not write or send');
      await page.getByRole('link', { name: '模型服务', exact: true }).click();
      await model.fill('新的预览模型草稿');
      await preview.getByText('新的预览模型草稿', { exact: true }).waitFor();
      assert.equal(await preview.locator('.preview-status').innerText(), '包含未保存的编辑');
      const draftWrites = writes.length;
      await category('surfaces');
      await preview.getByRole('button', { name: '贴边 / 刘海', exact: true }).click();
      assert.equal(writes.length, draftWrites);
      await category('model');
      assert.equal(await model.inputValue(), '新的预览模型草稿');
      assert.equal((await preview.textContent()).includes('fixture-unsaved-key'), false);

      for (const colorScheme of ['light', 'dark']) {
        await emulateMedia(page, {
          colorScheme: colorScheme === 'light' ? 'dark' : 'light',
          reducedMotion: 'reduce',
        });
        await chooseTheme(colorScheme === 'light' ? '浅色' : '深色');
        await expectTheme(colorScheme);
        // Chromium applies a changed media preference on its next rendering update.
        await page.waitForFunction(
          (expected) => getComputedStyle(document.documentElement).backgroundColor === expected,
          colorScheme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(25, 25, 27)',
          { timeout: 3000 },
        );
        assert.equal(
          await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
          colorScheme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(25, 25, 27)',
          'production CSS chunk ordering must not overwrite the approved settings palette',
        );
        for (const width of [360, 600, 900, 1360]) {
          await page.setViewportSize({ width, height: 900 });
          const header = await page.locator('.settings-header').evaluate((node) => {
            const rect = (selector) => node.querySelector(selector).getBoundingClientRect();
            const search = rect('.settings-search'),
              brand = rect('.settings-brand'),
              actions = rect('.settings-header-actions');
            return {
              search: search.toJSON(),
              brand: brand.toJSON(),
              actions: actions.toJSON(),
              header: node.getBoundingClientRect().toJSON(),
            };
          });
          if (width > 1100) {
            assert.ok(
              Math.abs(
                header.search.y +
                  header.search.height / 2 -
                  (header.brand.y + header.brand.height / 2),
              ) < 2,
              'wide search shares the brand row',
            );
            assert.ok(
              header.search.x >= header.brand.right && header.search.right <= header.actions.x,
            );
          }
          assert.ok(header.search.width <= 100, 'compact search remains a button at every width');
          assert.ok(header.actions.right <= header.header.right + 1, 'header controls fit');
          publishTheme(colorScheme, 'unresponsive');
          await page.getByText('页面暂未响应', { exact: true }).waitFor();
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            'connection status text fits the narrow header',
          );
          publishTheme(colorScheme);
          await page.getByRole('status', { name: '已连接', exact: true }).waitFor();

          for (const id of [
            'surfaces',
            'appearance',
            'features',
            'next',
            'prompts',
            'board',
            'model-control',
            'bots',
            'terminology',
            'model',
            'connection',
          ]) {
            await category(id);
            assert.equal(
              await page.locator('main h1, .preview-heading').count(),
              0,
              `${id}: no repeated page or preview title`,
            );
            if (id === 'terminology')
              await page.locator('#settings-terminology .settings-row').first().waitFor();
            const previewOrder = await page.evaluate(() => {
              const sample = document
                .querySelector('.settings-preview:not([hidden]), .settings-local-preview')
                ?.getBoundingClientRect();
              const controls = document
                .querySelector(
                  document.querySelector('.settings-app').dataset.settingsCategory === 'terminology'
                    ? '#settings-terminology .settings-row'
                    : '.settings-form-column',
                )
                .getBoundingClientRect();
              return {
                top: sample?.top,
                bottom: sample?.bottom,
                left: sample?.left,
                width: sample?.width,
                height: sample?.height,
                controls: controls.toJSON(),
              };
            });
            assert.ok(
              previewOrder.bottom <= previewOrder.controls.top,
              `${id}: preview above every setting`,
            );
            assert.ok(
              Math.abs(previewOrder.left - previewOrder.controls.left) < 1,
              `${id}: preview and controls align`,
            );
            assert.ok(
              Math.abs(previewOrder.width - previewOrder.controls.width) < 1,
              `${id}: shared preview width`,
            );
            // Keep the preview below half of the 900px desktop viewport, with
            // room for wrapping rather than shrinking text on narrow screens.
            const budget = width <= 760 ? 540 : 420;
            assert.ok(
              previewOrder.height <= budget,
              `${colorScheme} ${width} ${id}: preview ${previewOrder.height}px exceeds ${budget}px`,
            );
            previewGeometry.push({
              theme: colorScheme,
              width,
              page: id,
              height: previewOrder.height,
            });
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              false,
              `${colorScheme} ${width} ${id} fits`,
            );
            if (id === 'terminology') {
              const geometry = await page.locator('#settings-terminology').evaluate((root) => {
                const rect = (selector) => root.querySelector(selector).getBoundingClientRect();
                return {
                  behavior: rect('.term-behavior').toJSON(),
                  appearance: rect('[aria-labelledby="term-appearance-title"]').toJSON(),
                  library: rect('[aria-labelledby="term-library-title"]').toJSON(),
                  search: rect('[aria-label="搜索术语"]').toJSON(),
                  manage: rect('.settings-drawer-trigger').toJSON(),
                  filters: rect('.term-filters').toJSON(),
                  results: rect('.term-results').toJSON(),
                  switches: [...root.querySelectorAll('.term-behavior [role="switch"]')].map(
                    (node) => node.getBoundingClientRect().right,
                  ),
                };
              });
              assert.ok(
                geometry.behavior.bottom <= geometry.appearance.top &&
                  geometry.appearance.bottom <= geometry.library.top,
                'term settings keep behavior, appearance and library in reading order',
              );
              assert.ok(
                geometry.search.bottom <= geometry.filters.top &&
                  geometry.manage.bottom <= geometry.filters.top &&
                  geometry.filters.bottom <= geometry.results.top,
                'term search and management stay beside their filters and results',
              );
              assert.ok(
                Math.max(...geometry.switches) - Math.min(...geometry.switches) < 1,
                'all term switches align',
              );
              assert.ok(
                Math.abs(geometry.search.height - geometry.manage.height) < 1,
                'term search and management use the same control height',
              );
              if (width > 420)
                assert.ok(
                  Math.abs(geometry.search.y - geometry.manage.y) < 1,
                  'term search and management share a row',
                );
            }
          }
          if (width <= 760) await category('surfaces');
          else await page.getByRole('link', { name: '布局与位置', exact: true }).click();
          if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
            await page.screenshot({
              path: `target/reports/settings-tom-${colorScheme}-${width}.png`,
              fullPage: true,
            });
          await page.getByLabel('主界面布局', { exact: true }).click();
          await page.locator('#main-layout:open').waitFor();
          const menuGeometry = await page.locator('#main-layout option').evaluateAll((options) =>
            options.map((option) => {
              const box = option.getBoundingClientRect();
              return {
                x: box.x,
                right: box.right,
                bottom: box.bottom,
                top: box.top,
                viewport: innerWidth,
                height: innerHeight,
              };
            }),
          );
          assert.ok(
            menuGeometry.every(
              (box) =>
                box.x >= 0 && box.right <= box.viewport && box.top >= 0 && box.bottom <= box.height,
            ),
            'menu stays inside the viewport',
          );
          if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
            await page.screenshot({
              path: `target/reports/settings-menu-${colorScheme}-${width}.png`,
            });
          await page.keyboard.press('Escape');
          assert.equal(
            await page.evaluate(
              () =>
                document.querySelector('.settings-content').getAnimations({ subtree: true }).length,
            ),
            0,
            'reduced motion has no active animations',
          );
        }
      }
      await category('bots');
      await writeFile(
        'target/reports/settings-preview-geometry.json',
        JSON.stringify(previewGeometry, null, 2),
      );
      const botWrites = writes.length;
      await page
        .getByRole('group', { name: 'Bot 选择示例' })
        .getByRole('button', { name: '代码审查', exact: true })
        .click();
      assert.ok((await preview.getByRole('status').textContent()).includes('「代码审查」'));
      assert.equal(writes.length, botWrites, 'Bot preview never calls a Bot or saves settings');
      await category('appearance');
      await preview.getByRole('region', { name: '外观效果', exact: true }).waitFor();
      await preview.getByRole('button', { name: '恢复已保存配置', exact: true }).click();
      const sampleStyle = await preview
        .locator('[data-preview-workspace]')
        .evaluate((n) => getComputedStyle(n).fontSize);
      assert.equal(
        sampleStyle,
        `${appearance.typography.customSize}px`,
        'appearance preview uses saved typography',
      );
      await page.getByLabel('页面浮层主题', { exact: true }).selectOption('native-glass');
      await preview.locator('[data-preview-workspace][data-material="native-glass"]').waitFor();
      const regularColor = await preview
        .locator('[data-preview-workspace]')
        .evaluate((n) => getComputedStyle(n).backgroundColor);
      await page.getByLabel('页面浮层液态变体', { exact: true }).selectOption('clear');
      await preview.locator('[data-preview-workspace][data-variant="clear"]').waitFor();
      assert.notEqual(
        await preview
          .locator('[data-preview-workspace]')
          .evaluate((n) => getComputedStyle(n).backgroundColor),
        regularColor,
        'Clear changes the rendered sample material',
      );
      await category('surfaces');
      const themeWrites = writes.length;
      const peer = await context.newPage();
      await peer.goto(origin);
      await peer.locator('html[data-settings-theme="dark"]').waitFor();
      await chooseTheme('浅色', peer);
      await expectTheme('light');
      assert.equal(
        await model.inputValue(),
        '新的预览模型草稿',
        'other tabs do not replace form drafts',
      );
      await page.reload();
      await themeButton('浅色').waitFor({ state: 'attached' });
      assert.equal(await themeButton('浅色').getAttribute('aria-pressed'), 'true');
      await expectTheme('light');
      await peer.evaluate(() => localStorage.setItem('palboo-settings-theme', 'unknown'));
      publishTheme('dark');
      await expectTheme('light'); // Invalid browser storage cannot replace a saved server preference.
      await peer.evaluate(() => localStorage.removeItem('palboo-settings-theme'));
      await chooseTheme('自动');
      await peer.close();
      await page.bringToFront();
      assert.equal(
        writes.length,
        themeWrites + 2,
        'cross-tab theme choices only save the appearance preference',
      );
      await emulateMedia(page, { colorScheme: 'light', reducedMotion: 'no-preference' });
      await preview.locator('.layout-demo-window').evaluate((node) => {
        window.placementFrames = [];
        const sample = () => {
          window.placementFrames.push(node.x.baseVal.value);
          if (window.placementFrames.length < 100) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.getByRole('button', { name: '桌面窗口', exact: true }).click();
      await preview.locator('.layout-demo-canvas[data-demo-placement="desktop"]').waitFor();
      await page.waitForFunction(
        () => document.querySelector('.layout-demo-window').x.baseVal.value === 754,
      );
      assert.ok(
        await page.evaluate(() => window.placementFrames.some((x) => x > 470 && x < 730)),
        'placement changes animate only the illustration',
      );
      const beforeMotion = writes.length;
      await page.getByRole('link', { name: '模型服务', exact: true }).click();
      const drawer = limits.locator('dialog.settings-drawer');
      const entryHeight = await limits.evaluate((n) => n.getBoundingClientRect().height);
      await page.getByRole('button', { name: '高级设置', exact: true }).click();
      await drawer.evaluate(async (n) => {
        await Promise.allSettled(n.getAnimations().map((a) => a.finished));
      });
      assert.equal(
        await limits.evaluate((n) => n.getBoundingClientRect().height),
        entryHeight,
        'drawer does not reflow the main page',
      );
      const bounds = await drawer.boundingBox();
      assert.ok(Math.abs(bounds.x + bounds.width - page.viewportSize().width) < 2);
      assert.ok(bounds.width <= 720);
      await page.keyboard.press('Escape');
      assert.equal(await drawer.evaluate((n) => n.open), false);
      assert.equal(
        await drawer.evaluate((n) => getComputedStyle(n).transitionDuration),
        '0s',
        'keyboard closing is immediate',
      );
      const nav = page.getByRole('link', { name: '布局与位置', exact: true });
      await nav.press('Enter');
      assert.equal(
        await page.locator('.settings-content').evaluate((n) => n.getAnimations().length),
        0,
        'keyboard navigation has no entry animation',
      );
      await page.getByRole('link', { name: '模型服务', exact: true }).click();
      await page.getByRole('button', { name: '高级设置', exact: true }).click();
      await emulateMedia(page, { reducedMotion: 'reduce' });
      assert.equal(await drawer.evaluate((n) => getComputedStyle(n).transitionDuration), '0s');
      assert.equal(await drawer.evaluate((n) => n.getAnimations().length), 0);
      await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
      assert.equal(
        writes.length,
        beforeMotion,
        'drawer motion and navigation never save configuration',
      );
      await category('connection');
      await page.addScriptTag({ content: await readFile('ui/settings/dev-sources.js', 'utf8') });
      await category('dev');
      const sourceWidget = page.locator('#buddy-dev-sources');
      await sourceWidget.getByText('main', { exact: true }).waitFor();
      assert.doesNotMatch(
        await sourceWidget.locator('.source-content').innerText(),
        /1234567|7654321|已同步/,
      );
      assert.equal(await sourceWidget.locator('select, summary').count(), 0);
      const source = sourceWidget.getByRole('radio', { name: /codex\/long-source-name/ });
      const sourceWrites = writes.filter((w) => w.path.startsWith('/api/dev/')).length;
      for (const mode of ['浅色', '深色']) {
        await chooseTheme(mode);
        await page.setViewportSize({ width: 360, height: 900 });
        await source.check();
        const bounds = await sourceWidget.locator('.source-row').evaluateAll((nodes) =>
          nodes.map((node) => ({
            left: node.getBoundingClientRect().left,
            right: node.getBoundingClientRect().right,
            width: innerWidth,
            overflow: node.scrollWidth > node.clientWidth,
          })),
        );
        assert.ok(
          bounds.every((box) => box.left >= 0 && box.right <= box.width && !box.overflow),
          'long Dev source labels remain inside a narrow viewport',
        );
        const edges = await sourceWidget.evaluate((host) => {
          const view = host.shadowRoot;
          return [view.querySelector('form'), view.querySelector('button')].map(
            (n) => n.getBoundingClientRect().right,
          );
        });
        assert.ok(Math.abs(edges[0] - edges[1]) < 1, 'switch action aligns to the right edge');
      }
      assert.equal(
        writes.filter((w) => w.path.startsWith('/api/dev/')).length,
        sourceWrites,
        'selecting a source never switches it before confirmation',
      );
      const restricted = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await restricted.addInitScript(() => {
        const get = Storage.prototype.getItem,
          set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (key === 'palboo-settings-theme')
            throw new DOMException('Storage unavailable', 'SecurityError');
          return get.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (key === 'palboo-settings-theme')
            throw new DOMException('Storage unavailable', 'SecurityError');
          return set.call(this, key, value);
        };
      });
      const restrictedPage = await restricted.newPage();
      restrictedPage.on('pageerror', (e) => errors.push(e.message));
      await restrictedPage.goto(origin + '/#token=fixture');
      await chooseTheme('浅色', restrictedPage);
      await restrictedPage.locator('html[data-settings-theme="light"]').waitFor();
      await restricted.close();
      await category('model');
      const headerWrites = writes.filter((w) => w.path !== '/api/appearance').length;
      await page.locator('.settings-theme-trigger').click();
      await page.keyboard.press('End');
      assert.equal(await themeButton('深色').evaluate((n) => n === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(
        await page.locator('.settings-theme-trigger').getAttribute('aria-expanded'),
        'false',
      );
      assert.equal(
        await page.locator('.settings-theme-trigger').evaluate((n) => n === document.activeElement),
        true,
      );
      await page.keyboard.press('Control+k');
      assert.equal(
        await page
          .getByRole('searchbox', { name: '搜索设置' })
          .evaluate((n) => n === document.activeElement),
        true,
      );
      await page.keyboard.press('Escape');
      for (const color of ['浅色', '深色']) {
        await chooseTheme(color);
        for (const width of [390, 680, 760, 761, 1100, 1440]) {
          await page.setViewportSize({ width, height: 850 });
          await page.evaluate(() => scrollTo(0, 0));
          await page.locator('.settings-theme-trigger').click();
          const box = await page.locator('.settings-theme-menu').boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width);
          await page.keyboard.press('Escape');
          const links = await page.locator('.settings-category-links a').evaluateAll((nodes) =>
            nodes.map((n) => ({
              width: n.clientWidth,
              content: n.scrollWidth,
              visible: !!n.getBoundingClientRect().height,
            })),
          );
          assert.ok(links.length >= 12, 'all original settings leaves remain available');
          assert.ok(links.filter((n) => n.visible).every((n) => n.width >= n.content));
          assert.equal(links.filter((n) => n.visible).length, width <= 760 ? 5 : links.length);
          assert.equal(await page.locator('.settings-nav summary').count(), 0);
          const layout = await page.evaluate(() => {
            const nav = document.querySelector('.settings-nav').getBoundingClientRect();
            const content = document.querySelector('.settings-content').getBoundingClientRect();
            return {
              navRight: nav.right,
              navBottom: nav.bottom,
              contentLeft: content.left,
              contentTop: content.top,
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert.equal(layout.overflow, false, `no horizontal overflow at ${width}px`);
          if (width <= 760)
            assert.ok(layout.navBottom <= layout.contentTop, 'narrow navigation precedes content');
          else
            assert.ok(layout.navRight < layout.contentLeft, 'wide navigation sits left of content');
          if (process.env.PALBOO_TEST_SCREENSHOTS === '1')
            await page.screenshot({
              path: `target/reports/settings-header-${color === '浅色' ? 'light' : 'dark'}-${width}.png`,
            });
        }
      }
      assert.equal(
        writes.filter((w) => w.path !== '/api/appearance').length,
        headerWrites,
        'header navigation never submits business settings',
      );
      assert.deepEqual(errors, []);
    } finally {
      await cleanup();
    }
  },
);
