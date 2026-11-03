/* [INPUT]: CodexHost settings and revision-aware synthetic API.
 * [OUTPUT]: Status rendering, explicit toggles and no implicit installation/start/restart.
 * [POS]: Browser-only migration check; does not touch a live host.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('CodexHost settings use their own authenticated endpoint and preserve explicit activation', async () => {
  const out = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CodexHostSettings}from'./ui/settings/codex-host-settings';createRoot(document.getElementById('root')).render(React.createElement(CodexHostSettings,{live:true,active:true}));`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"production"',
      // The isolated IIFE has no module URL; keep preview assets inside the fixture.
      'import.meta.url': '"https://palboo.test/settings.js"',
    },
    plugins: [
      {
        name: 'api-fixture',
        setup(b) {
          b.onResolve({ filter: /^\.\/api$/ }, () => ({
            path: 'fixture',
            namespace: 'api-fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'api-fixture' }, () => ({
            contents: `window.commands=[];let state={enabled:false,revision:9,startupUpdate:'notify',state:'disabled',version:'0.10.2',executable:'/tmp/fixture',baseline:'0.10.2',canRestore:false};window.stageUpdate=()=>{state={...state,enabled:true,state:'pendingUpdate',runningVersion:'0.10.1'}};export async function request(path,body){if(path==='codex-host/agents'&&!body)return {status:'unavailable',message:'当前宿主未接入 CodexHost',current:null,agents:[]};if(path!=='codex-host')throw Error('wrong endpoint');window.commands.push({path,body});if(body){if(window.fail)throw Error('合成保存失败');if(body.expectedRevision!==state.revision)throw Error('stale');if(body.op==='set-enabled'){state={...state,enabled:body.enabled,state:body.enabled?'pendingEnable':'disabled',revision:state.revision+1}}else if(body.op==='set-startup-update'){state={...state,startupUpdate:body.startupUpdate,revision:state.revision+1}}else if(body.op==='restart'){state={...state,restart:{state:'queued',message:'正在准备重启…'}}}else throw Error('unexpected side effect')}return state;}`,
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://palboo.test/**', (route) => route.fulfill({ status: 404 }));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    assert.deepEqual(errors, []);
    const control = page.getByRole('switch', { name: '启用CodexHost' });
    await control.waitFor();
    await page.getByText('已关闭', { exact: true }).waitFor();
    await control.click();
    await page.getByText('待启动启用', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '启动', exact: true }).count(), 1);
    await control.click();
    await page.getByText('已关闭', { exact: true }).waitFor();
    await page.evaluate(() => (window.fail = true));
    await control.click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.equal(
      await alert.evaluate(
        (e) =>
          !!e
            .closest('.settings-feedback-slot')
            ?.previousElementSibling?.querySelector('[aria-label="启用CodexHost"]'),
      ),
      true,
    );
    assert.equal(await control.getAttribute('aria-checked'), 'false');
    await page.evaluate(() => {
      window.fail = false;
      window.commands.pop();
    });
    const policy = page.getByRole('combobox', { name: '启动时检查 CodexHost 更新' });
    assert.equal(await policy.inputValue(), 'notify');
    for (const mode of ['automatic', 'off']) {
      await policy.selectOption(mode);
      await page.waitForFunction((value) => {
        const control = document.querySelector('#codex-host-startup-update');
        return control?.value === value && !control.disabled;
      }, mode);
    }
    await page.evaluate(() => {
      window.stageUpdate();
      window.dispatchEvent(new Event('focus'));
    });
    await page.getByRole('button', { name: '重启并应用更新', exact: true }).click();
    await page.getByText('正在准备重启…', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '正在重启…', exact: true }).isDisabled(),
      true,
    );
    const writes = await page.evaluate(() => window.commands.filter((x) => x.body));
    assert.deepEqual(
      writes.map((x) => [
        x.body.op,
        x.body.expectedRevision,
        x.body.enabled ?? x.body.startupUpdate,
      ]),
      [
        ['set-enabled', 9, true],
        ['set-enabled', 10, false],
        ['set-startup-update', 11, 'automatic'],
        ['set-startup-update', 12, 'off'],
        ['restart', 13, undefined],
      ],
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
