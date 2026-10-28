/* [INPUT]: Actual settings components/save queue and isolated synthetic APIs.
 * [OUTPUT]: Confirmation, direction provenance/default restoration, Jev key preservation and partial-import failure coverage.
 * [POS]: Fake configuration only; never deletes live data or restarts Codex.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

test(
  'settings confirm destructive actions, preserve drafts and queue arbitrary files',
  { timeout: 45000 },
  async () => {
    const script = (
      await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'jsx',
          contents: `
import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
import{NextSettings}from'./ui/settings/next-settings';import{QuickPromptSettings}from'./ui/settings/quick-prompt-settings';import{ConnectionSettings}from'./ui/settings/connection-settings';
import{SettingsForm}from'./ui/settings/settings-controls';import{useSettingsForm}from'./ui/settings/use-settings-form';
import{TerminologySettings}from'./ui/settings/terminology-settings';import{CodexHostSettings}from'./ui/settings/codex-host-settings';
function App(){const e=useSettingsForm(false,undefined,v=>Object.fromEntries(["enabled", "quickPromptsEnabled", "quickPromptClickMode", "answerOutlineEnabled", "promptEnhancementEnabled", "generationMode", "hostRestartPolicy", "provider", "protocol", "model", "baseUrl", "apiKeyEnv", "maxItems", "directionSource", "directionLibrary", "selectedDirections", "jev", "quickPrompts", "maxInputChars", "maxOutputTokens", "timeoutMs"].map(key=>[key,v[key]])),()=>{});useEffect(()=>{e.load(window.fixture);window.loadSettings=e.load},[]);
return <div><SettingsForm editor={e} notify={()=>{}} active><NextSettings editor={e}/><QuickPromptSettings editor={e}/><ConnectionSettings editor={e} live view={{connection:{status:'connected',endpoint:'9229',targets:[]}}} notify={()=>{}}/></SettingsForm><CodexHostSettings live active/><TerminologySettings active/></div>}
createRoot(document.getElementById('root')).render(<App/>);`,
        },
        bundle: true,
        write: false,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
      })
    ).outputFiles[0].text;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      let settings = {
        ...fixtureSettings,
        directionSource: 'smart',
        storedJevApiKey: true,
        jevKeyConfigured: true,
      };
      let host = {
        enabled: false,
        revision: 1,
        state: 'pendingDisable',
        version: '0.10.2',
        baseline: '0.10.2',
        canRestore: true,
      };
      const terms = {
        entries: [],
        imports: { revision: 1, jobs: [] },
        preferences: {
          enabled: false,
          semantic: false,
          autoExpand: false,
          cardStyle: 'matte',
          mastered: [],
          favorites: [],
          revision: 1,
        },
      };
      let failKey = false,
        failPrompt = false,
        failImport = false;
      const writes = [];
      await page.route('https://safety.test/**', async (route) => {
        const url = new URL(route.request().url()),
          body =
            url.pathname === '/api/terminology/file'
              ? { file: url.searchParams.get('name') }
              : route.request().postDataJSON();
        if (!url.pathname.startsWith('/api/'))
          return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
        if (body) writes.push({ path: url.pathname, body });
        let result = {};
        if (url.pathname === '/api/settings') {
          if (body?.quickPrompts && failPrompt)
            return route.fulfill({ status: 500, json: { message: '合成提示词删除失败' } });
          if (body?.clearJevApiKey && failKey)
            return route.fulfill({ status: 500, json: { message: '合成密钥删除失败' } });
          if (body) {
            assert.equal(body.expectedRevision, settings.configurationRevision);
            const { expectedRevision, apiKey, clearApiKey, jevApiKey, clearJevApiKey, ...patch } =
              body;
            settings = {
              ...settings,
              ...patch,
              configurationRevision: settings.configurationRevision + 1,
            };
            if (clearJevApiKey)
              settings = { ...settings, storedJevApiKey: false, jevKeyConfigured: false };
          }
          result = settings;
        } else if (url.pathname === '/api/codex-host') {
          if (body) {
            assert.equal(body.expectedRevision, host.revision);
            host = { ...host, revision: host.revision + 1 };
          }
          result = host;
        } else if (url.pathname === '/api/terminology') {
          if (body?.action === 'reset-library' && failImport)
            return route.fulfill({ status: 400, json: { message: '合成重置失败' } });
          if (body?.action === 'reset-library') terms.imports.jobs = [];
          if (body?.action === 'add-names') {
            assert.deepEqual(body.names, ['待补全名称']);
            terms.imports.jobs.push({
              id: 'name-1',
              name: body.names[0],
              kind: 'name',
              status: 'queued',
              count: 0,
              error: '',
            });
            terms.imports.revision++;
          }
          result = terms;
        } else if (url.pathname === '/api/terminology/file') {
          assert.equal(route.request().postDataBuffer().toString(), 'opaque fixture file');
          terms.imports.jobs.push({
            id: 'job-1',
            name: body.file,
            kind: 'file',
            status: 'queued',
            count: 0,
            error: '',
          });
          terms.imports.revision++;
          result = terms;
        }
        await route.fulfill({ json: result });
      });
      await page.goto('https://safety.test/');
      await page.evaluate((value) => (window.fixture = value), settings);
      await page.addScriptTag({ content: script });
      const dialog = page.locator('.settings-key-dialog[open]');
      const cancel = () => dialog.getByRole('button', { name: '取消', exact: true }).click();
      const accept = (label) => dialog.getByRole('button', { name: label, exact: true }).click();
      const jevDelete = page.getByRole('button', { name: '删除已保存的 Jev 密钥', exact: true });
      await page.getByRole('button', { name: '更换 Jev 密钥' }).waitFor();
      assert.equal(await page.locator('input#jev-key').count(), 0);
      await page.getByRole('button', { name: '更换 Jev 密钥' }).click();
      assert.equal(await page.getByRole('button', { name: '显示新密钥' }).count(), 0);
      await page.locator('#jev-key').fill('fixture-new-key');
      await page.getByRole('button', { name: '显示新密钥' }).click();
      assert.equal(writes.length, 0);
      await page.getByRole('button', { name: '取消更换' }).click();
      assert.equal(writes.length, 0);
      await jevDelete.click();
      assert.equal(
        await dialog
          .getByRole('button', { name: '取消', exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.press('Escape');
      assert.equal(writes.length, 0);
      await jevDelete.click();
      await cancel();
      assert.equal(writes.length, 0);
      failKey = true;
      await jevDelete.click();
      await accept('确认删除');
      await dialog.getByRole('alert').filter({ hasText: '合成密钥删除失败' }).waitFor();
      assert.deepEqual(writes.at(-1).body, {
        clearJevApiKey: true,
        expectedRevision: settings.configurationRevision,
      });
      assert.equal(settings.storedJevApiKey, true);
      assert.equal(settings.storedApiKey, fixtureSettings.storedApiKey);
      await cancel();
      const failedCount = writes.length;
      await page.getByRole('heading', { name: '建议生成', exact: true }).click();
      await page.waitForTimeout(250);
      assert.equal(writes.length, failedCount, 'failed deletion is not retried by blur');
      failKey = false;
      await jevDelete.click();
      await accept('确认删除');
      await page.locator('input#jev-key').waitFor();
      assert.equal(settings.storedJevApiKey, false);
      assert.equal(settings.apiKeyConfigured, true);
      assert.equal(
        await page.getByRole('textbox', { name: '方向名称 1', exact: true }).isVisible(),
        false,
      );
      await page.getByRole('button', { name: '方向库', exact: true }).click();
      const builtIns = page.getByRole('region', { name: '内置方向', exact: true });
      assert.equal(await builtIns.locator('[data-direction-open]').count(), 3);
      await builtIns.getByRole('button', { name: '整体推进', exact: true }).click();
      const selectedBefore = [...settings.selectedDirections];
      await page
        .getByRole('textbox', { name: '倾向说明 1', exact: true })
        .fill('自己修改的推进说明');
      await page
        .getByRole('button', { name: '恢复方向 整体推进 的默认内容', exact: true })
        .waitFor();
      assert.equal(await page.getByText('已修改', { exact: true }).count(), 0);
      await page.getByRole('button', { name: '恢复方向 整体推进 的默认内容', exact: true }).click();
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="恢复方向 整体推进 的默认内容"]'),
      );
      await page.getByRole('button', { name: '返回内置方向', exact: true }).click();
      await page.getByRole('button', { name: '我的方向', exact: true }).click();
      const customs = page.getByRole('region', { name: '我的方向', exact: true });
      assert.equal(await customs.locator('[data-direction-open]').count(), 0);
      await page.getByRole('button', { name: '添加方向', exact: true }).click();
      await page.getByRole('textbox', { name: '方向名称 4', exact: true }).fill('用户自定义');
      await page.getByRole('textbox', { name: '倾向说明 4', exact: true }).fill('只对这台设备保存');
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith('/api/settings') && r.request().method() === 'POST',
        ),
        page
          .getByRole('dialog', { name: '方向库', exact: true })
          .getByRole('button', { name: '保存设置', exact: true })
          .click(),
      ]);
      await page.getByRole('button', { name: '返回我的方向', exact: true }).click();
      assert.equal(await customs.locator('[data-direction-open]').count(), 1);
      assert.equal(await customs.getByText('已修改', { exact: true }).count(), 0);
      assert.equal(
        settings.directionLibrary[0].instruction,
        fixtureSettings.builtInDirections[0].instruction,
      );
      assert.deepEqual(settings.selectedDirections, selectedBefore);
      assert.ok(
        writes
          .filter((w) => w.path === '/api/settings')
          .every((w) => !('builtInDirections' in w.body)),
      );
      await page.getByRole('button', { name: '内置方向', exact: true }).click();
      await builtIns.getByRole('button', { name: '整体推进', exact: true }).click();
      const beforeDirections = structuredClone(settings.directionLibrary);
      await page
        .getByRole('button', { name: `删除方向 ${beforeDirections[0].name}`, exact: true })
        .click();
      await cancel();
      assert.deepEqual(settings.directionLibrary, beforeDirections);
      await page
        .getByRole('button', { name: `删除方向 ${beforeDirections[0].name}`, exact: true })
        .click();
      await accept('确认删除');
      await dialog.waitFor({ state: 'hidden' }).catch(async (error) => {
        throw Error(
          `${error.message}\nDialog: ${await dialog.textContent()}\nWrites: ${JSON.stringify(writes.map((w) => ({ path: w.path, keys: Object.keys(w.body), revision: w.body.expectedRevision })))}`,
        );
      });
      assert.equal(settings.directionLibrary.length, beforeDirections.length - 1);
      assert.equal(settings.selectedDirections.includes(beforeDirections[0].id), false);
      await page.getByRole('button', { name: '关闭方向库', exact: true }).click();
      const prompts = structuredClone(settings.quickPrompts);
      await page.getByRole('button', { name: '删除常用提示词 1', exact: true }).click();
      await cancel();
      assert.deepEqual(settings.quickPrompts, prompts);
      failPrompt = true;
      await page.getByRole('button', { name: '删除常用提示词 1', exact: true }).click();
      await accept('确认删除');
      await dialog.getByRole('alert').filter({ hasText: '合成提示词删除失败' }).waitFor();
      assert.deepEqual(settings.quickPrompts, prompts);
      await cancel();
      assert.equal(
        await page.getByRole('textbox', { name: '常用提示词 1 名称', exact: true }).inputValue(),
        prompts[0].label,
      );
      const failedPromptWrites = writes.length;
      await page.getByRole('heading', { name: '建议生成', exact: true }).click();
      await page.waitForTimeout(250);
      assert.equal(writes.length, failedPromptWrites);
      failPrompt = false;
      await page.getByRole('button', { name: '删除常用提示词 1', exact: true }).click();
      await accept('确认删除');
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(settings.quickPrompts, prompts.slice(1));
      for (const [name, label, path, op] of [
        ['断开', '确认断开', '/api/disconnect', undefined],
        ['重启 Codex 并停用', '确认重启', '/api/codex-host', 'restart-disabled'],
        ['恢复上一版本', '确认恢复', '/api/codex-host', 'restore'],
      ]) {
        const button = page.getByRole('button', { name, exact: true }),
          before = writes.length;
        await button.click();
        await cancel();
        assert.equal(writes.length, before);
        await button.click();
        await accept(label);
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(writes.length, before + 1);
        assert.equal(writes.at(-1).path, path);
        if (op) assert.equal(writes.at(-1).body.op, op);
      }
      await page.getByRole('button', { name: '词库管理', exact: true }).click();
      assert.equal(
        await page.getByRole('textbox', { name: '术语名称', exact: true }).isVisible(),
        true,
      );
      const beforeManagementNavigation = writes.length;
      await page.getByRole('textbox', { name: '术语名称', exact: true }).fill('保留的词条草稿');
      await page.getByRole('button', { name: '导入与导出', exact: true }).click();
      assert.equal(
        await page.getByRole('textbox', { name: '术语名称', exact: true }).isVisible(),
        false,
      );
      await page.getByRole('button', { name: '新增词条', exact: true }).click();
      assert.equal(
        await page.getByRole('textbox', { name: '术语名称', exact: true }).inputValue(),
        '保留的词条草稿',
      );
      await page.getByRole('button', { name: '导入与导出', exact: true }).click();
      assert.equal(writes.length, beforeManagementNavigation);
      await page.getByRole('button', { name: '新增词条', exact: true }).click();
      await page.getByRole('textbox', { name: '术语名称', exact: true }).fill('待补全名称');
      await page
        .getByRole('dialog', { name: '词库管理', exact: true })
        .getByRole('button', { name: '添加', exact: true })
        .click();
      await page
        .getByRole('region', { name: '术语处理记录' })
        .getByText('待补全名称', { exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole('textbox', { name: '术语名称', exact: true }).inputValue(),
        '',
      );
      await page.getByRole('button', { name: '导入与导出', exact: true }).click();
      const file = {
        name: 'fixture.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('opaque fixture file'),
      };
      const fileInput = page.getByLabel('导入术语文件');
      assert.equal(await fileInput.getAttribute('accept'), null);
      await fileInput.setInputFiles(file);
      await page
        .getByRole('region', { name: '术语处理记录' })
        .getByText('fixture.pdf', { exact: true })
        .waitFor();
      assert.equal(writes.at(-1).path, '/api/terminology/file');
      assert.equal(await dialog.count(), 0);
      const reset = page.getByRole('button', { name: '重置词库', exact: true });
      const beforeReset = writes.length;
      await reset.click();
      await cancel();
      assert.equal(writes.length, beforeReset);
      failImport = true;
      await reset.click();
      await accept('重置词库');
      await page.getByRole('alert').filter({ hasText: '合成重置失败' }).first().waitFor();
      assert.equal(terms.imports.jobs.length, 2);
      await cancel();
      failImport = false;
      await reset.click();
      await accept('重置词库');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(terms.imports.jobs.length, 0);
      assert.equal(writes.at(-1).body.revision, 3);
      assert.deepEqual(
        settings.jev,
        fixtureSettings.jev,
        'credential removal retains endpoint/model/consent',
      );
      assert.equal(settings.baseUrl, fixtureSettings.baseUrl);
    } finally {
      await browser.close();
    }
  },
);
