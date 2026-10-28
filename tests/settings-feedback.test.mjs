/* [INPUT]: Real settings editor, compact rows, compiled CSS and controlled synthetic requests.
 * [OUTPUT]: Scaled typography, readable rows and nearby feedback across pending/error/retry states.
 * [POS]: Isolated Chromium; never connects to the user's settings or model service.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

test(
  'settings feedback stays with the saved edit and compact rows scale with typography',
  { timeout: 30000 },
  async () => {
    const initial = {
      ...fixtureSettings,
      quickPrompts: [
        { label: '继续', prompt: '继续' },
        { label: '检查', prompt: '检查这个方案的输入、边界与依赖。'.repeat(12) },
      ],
    };
    const bundle = await build({
      stdin: {
        loader: 'jsx',
        resolveDir: process.cwd(),
        contents: `
      import React,{useEffect,useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {useSettingsForm} from './ui/settings/use-settings-form';
      import {SettingsForm,Field,FeatureSwitch,Toggle} from './ui/settings/settings-controls';
      import {Input} from './ui/settings/components/ui/input';
      import {NextSettings} from './ui/settings/next-settings';import {QuickPromptSettings} from './ui/settings/quick-prompt-settings';
      function App(){const [notice,notify]=useState(''); const editor=useSettingsForm(false,undefined,({configurationRevision,generationRevision,...rest})=>rest,notify);
      useEffect(()=>editor.load(${JSON.stringify(initial)}),[]);
      return <div className="settings-app"><main className="settings-content"><div className="settings-form-column">
      <FeatureSwitch name="下一步" checked={!!editor.form?.enabled} onChange={v=>editor.change('enabled',v)}/>
      <SettingsForm editor={editor} notify={notify} active>
      <Field label="模型名称" id="model"><Input id="model" value={editor.form?.model||''} onChange={e=>editor.change('model',e.target.value)}/></Field>
      <Field label="侧栏宽度（px）" id="dock-width"><Input id="dock-width" type="number" defaultValue="426" /></Field>
      <Toggle label="桌面窗口置顶" checked={false} onChange={()=>{}}/>
      <NextSettings editor={editor} appearance={{revision:1,ui:{labelOnly:false,promptClickMode:'fill'}}}/><QuickPromptSettings editor={editor}/></SettingsForm>
      {notice && notice!==editor.saveError && <p role="alert">{notice}</p>}
      </div></main></div>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const html = await readFile('target/web/index.html', 'utf8');
    const css = (
      await Promise.all(
        [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map(([, href]) =>
          readFile(`target/web${href}`, 'utf8'),
        ),
      )
    ).join('\n');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      page.setDefaultTimeout(4000);
      const errors = [],
        writes = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let saved = structuredClone(initial),
        reject = false,
        gate;
      const hold = () => {
        let release;
        gate = new Promise((resolve) => (release = resolve));
        return () => {
          gate = null;
          release();
        };
      };
      await page.route('http://feedback.test/**', async (route) => {
        if (new URL(route.request().url()).pathname === '/api/appearance') {
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: '合成外观保存失败' }),
          });
        }
        if (new URL(route.request().url()).pathname === '/api/settings') {
          const patch = route.request().postDataJSON();
          writes.push(patch);
          const fails = reject;
          if (gate) await gate;
          if (!fails) {
            const { apiKey, clearApiKey, jevApiKey, clearJevApiKey, expectedRevision, ...fields } =
              patch;
            saved = { ...saved, ...fields, configurationRevision: saved.configurationRevision + 1 };
          }
          return route.fulfill({
            status: fails ? 500 : 200,
            contentType: 'application/json',
            body: JSON.stringify(fails ? { message: '合成保存失败' } : saved),
          });
        }
        await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      });
      await page.goto('http://feedback.test/');
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const prompt = page.getByRole('textbox', { name: '常用提示词 1 内容', exact: true });
      await prompt.waitFor();
      for (const width of [360, 740, 1360])
        for (const base of [16, 20, 32])
          for (const theme of ['light', 'dark']) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(
              ({ base, theme }) => {
                document.documentElement.style.setProperty('--buddy-type-size', `${base}px`);
                document.documentElement.style.fontSize = `${base}px`;
                document.documentElement.dataset.settingsTheme = theme;
              },
              { base, theme },
            );
            const geometry = await page.evaluate(() => {
              const size = (selector) =>
                parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
              const row = document.querySelector('.settings-prompt-entry');
              return {
                label: size('label[for=model]'),
                input: size('#model'),
                select: size('#generation-mode'),
                textarea: size('.settings-entry-content'),
                heading: size('#quick-prompts-title'),
                short: row.getBoundingClientRect().height,
                controlHeight: document.querySelector('#generation-mode').getBoundingClientRect()
                  .height,
                numberRight: document.querySelector('#dock-width').getBoundingClientRect().right,
                switchRight: document
                  .querySelector('[aria-label=桌面窗口置顶]')
                  .getBoundingClientRect().right,
                numberWidth: document.querySelector('#dock-width').getBoundingClientRect().width,
                long: document.querySelectorAll('.settings-prompt-entry')[1].getBoundingClientRect()
                  .height,
                cells: [...row.children].map((e) => {
                  const r = e.getBoundingClientRect();
                  return { left: r.left, right: r.right, top: r.top, width: r.width };
                }),
                overflow: document.documentElement.scrollWidth > innerWidth,
              };
            });
            for (const key of ['label', 'input', 'select', 'textarea'])
              assert.equal(
                geometry[key],
                base * 0.875,
                `${key} scales at ${width}/${base}/${theme}`,
              );
            assert.equal(geometry.heading, base);
            assert.ok(
              geometry.short <= geometry.controlHeight + 16 && geometry.long > geometry.short + 20,
              JSON.stringify(geometry),
            );
            assert.ok(
              geometry.cells[0].right < geometry.cells[1].left &&
                geometry.cells[1].right < geometry.cells[2].left,
            );
            assert.ok(geometry.cells[1].width > 100);
            assert.equal(geometry.overflow, false);
            assert.ok(
              Math.abs(geometry.numberRight - geometry.switchRight) < 1,
              'numeric fields share the switch right edge',
            );
            assert.ok(geometry.numberWidth <= 160, 'numeric fields retain a short width');
          }
      assert.equal(writes.length, 0, 'inspection does not save');
      await page.setViewportSize({ width: 740, height: 900 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '16px';
        document.documentElement.style.setProperty('--buddy-type-size', '16px');
      });
      await prompt.fill('合成提示词草稿');
      const save = page.getByRole('button', { name: '保存设置', exact: true });
      assert.equal(
        await save.evaluate((node) =>
          node
            .closest('.settings-feedback-slot')
            .previousElementSibling.classList.contains('settings-prompt-entry'),
        ),
        true,
      );
      let release = hold();
      reject = true;
      await save.click();
      await save.locator('[data-action-state=pending]').waitFor();
      await page.getByLabel('模型名称', { exact: true }).fill('newer-unsaved-draft');
      release();
      const error = page.getByRole('alert').filter({ hasText: '合成保存失败' });
      await error.waitFor();
      // Allow delayed blur saves to run before inspecting the final feedback anchor.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
      assert.equal(writes.length, 1, 'leaving Save does not resubmit an older snapshot');
      assert.equal(await error.count(), 1);
      assert.equal(
        await error.evaluate((node) =>
          node
            .closest('.settings-feedback-slot')
            .previousElementSibling.classList.contains('settings-prompt-entry'),
        ),
        true,
        'a late failure stays with the submitted edit',
      );
      assert.equal(await prompt.inputValue(), '合成提示词草稿');
      assert.equal(
        await page.getByLabel('模型名称', { exact: true }).inputValue(),
        'newer-unsaved-draft',
      );
      assert.equal(
        await page.getByText('已保存', { exact: true }).count(),
        0,
        'new draft and failure never report success',
      );
      reject = false;
      await save.click();
      await save.locator('[data-action-state=success]').waitFor();
      assert.equal(saved.model, 'newer-unsaved-draft');
      assert.equal(saved.quickPrompts[0].prompt, '合成提示词草稿');
      release = hold();
      await page.getByRole('switch', { name: '启用下一步' }).click();
      const pending = page.getByRole('status').filter({ hasText: '正在保存' });
      await pending.waitFor();
      assert.equal(
        await pending.evaluate((node) =>
          node
            .closest('.settings-feedback-slot')
            .previousElementSibling.classList.contains('settings-feature-switch'),
        ),
        true,
        'outside-form switch owns its feedback',
      );
      release();
      await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
      assert.deepEqual(Object.keys(writes.at(-1)).sort(), ['enabled', 'expectedRevision']);
      await page.getByLabel('内容显示', { exact: true }).selectOption('true');
      const appearanceError = page.getByRole('alert').filter({ hasText: '合成外观保存失败' });
      await appearanceError.waitFor();
      assert.equal(
        await appearanceError.evaluate(
          (node) =>
            !!node
              .closest('.settings-feedback-slot')
              .previousElementSibling.querySelector('#suggestion-labels'),
        ),
        true,
        'independent appearance save reports at its select',
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test('board group save failures stay beside the submitted row and retain the draft for retry', async () => {
  const bundle = await build({
    stdin: {
      loader: 'jsx',
      resolveDir: process.cwd(),
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TaskSettings} from './ui/settings/task-settings';import {useTasks} from './ui/features/board/api';window.reject=true;window.writes=[];let state={store:{revision:1,columns:[{id:'todo',title:'待办'},{id:'done',title:'完成'}],tasks:[],bindings:{calendarId:''}}};const request=async(path,body)=>{if(body){window.writes.push(body);await new Promise(r=>window.release=r);if(window.reject)throw Error('合成分组保存失败');state={...state,store:{...state.store,revision:state.store.revision+1,columns:state.store.columns.map(c=>c.id===body.id?{...c,title:body.title}:c)}}}return state};function App(){const tasks=useTasks(false,request);return <div className="settings-app"><TaskSettings tasks={tasks}/></div>}createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const input = page.getByRole('textbox', { name: '分组名称：待办' });
    await input.fill('测试草稿');
    await page.getByRole('button', { name: '保存分组：待办' }).click();
    await page.getByRole('status').filter({ hasText: '正在保存' }).waitFor();
    await page.evaluate(() => window.release());
    const error = page.getByRole('alert');
    await error.waitFor();
    assert.equal(
      await error.evaluate(
        (e) =>
          !!e
            .closest('.settings-feedback-slot')
            ?.previousElementSibling?.querySelector('[aria-label="分组名称：待办"]'),
      ),
      true,
    );
    assert.equal(await input.inputValue(), '测试草稿');
    await page.evaluate(() => (window.reject = false));
    await page.getByRole('button', { name: '保存分组：待办' }).click();
    await page.getByRole('status').filter({ hasText: '正在保存' }).waitFor();
    await page.evaluate(() => window.release());
    await page.getByRole('textbox', { name: '分组名称：测试草稿' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.evaluate(() => window.writes.length), 2);
  } finally {
    await browser.close();
  }
});
