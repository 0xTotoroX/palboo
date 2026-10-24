/* [INPUT]: Isolated Chromium composers and a synthetic terminology queue.
 * [OUTPUT]: Next-user-send handoff, draft/target guards, retry and teardown acceptance.
 * [POS]: Offline tests; no real Agent requests or user data.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('terminology handoff preserves the user draft and binds to one deliberate send', async () => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
    import {installTerminologyImports} from './ui/codex/terminology-import.js';
    window.install = () => installTerminologyImports({
      getTarget:()=>window.target, getSubmit:()=>document.querySelector('#send'), isBusy:()=>window.busy,
      isEnabled:()=>window.enabled,
      request:async(path,payload)=>{
        window.calls.push(payload);
        if(payload.action==='release-import') return {ok:true};
        if(window.delayed) await new Promise(resolve=>window.release=resolve);
        if(window.fail) throw Error('offline');
        return {tasks:[{id:'job',attempt:'attempt'}],prompt:'[Palboo 术语任务：fixture]\\n读取合成文件\\n[/Palboo 术语任务]'};
      }
    });`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      define: { 'process.env.NODE_ENV': '"test"' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route('https://term-import.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<main></main>' }),
    );
    await page.goto('https://term-import.test/');
    await page.setContent(
      '<main><textarea id="editor"></textarea><button id="send">发送</button><div contenteditable="true" id="rich"></div></main>',
    );
    await page.evaluate(() => {
      window.calls = [];
      window.sent = [];
      window.enabled = true;
      window.busy = false;
      window.target = {
        id: 'chat-a',
        composer: document.querySelector('#editor'),
        scope: document.querySelector('main'),
      };
      document.querySelector('#send').onclick = () =>
        window.sent.push(window.target.composer.value ?? window.target.composer.innerText);
    });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => window.install());
    const editor = page.locator('#editor');
    await editor.fill('原有草稿\n\n第二段');
    await editor.press('Shift+Enter');
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    await editor.fill('原有草稿\n\n第二段');
    await editor.press('Enter');
    await page.waitForFunction(() => window.sent.length === 1);
    assert.match((await page.evaluate(() => window.sent))[0], /^原有草稿\n\n第二段\n\n\[Palboo/);
    assert.equal(
      await page.evaluate(() => window.calls.filter((v) => v.action === 'prepare-import').length),
      1,
    );
    // If the official editor kept the draft, its retry must not append the job again.
    await page.locator('#send').click();
    assert.equal(await page.evaluate(() => window.sent.length), 2);
    assert.equal(await page.evaluate(() => window.calls.length), 1);

    for (const change of ['edit', 'target', 'destroy']) {
      await page.evaluate(() => {
        window.sent = [];
        window.calls = [];
        window.delayed = true;
        window.target.id = 'chat-a';
        window.install();
      });
      await editor.fill('不要丢失');
      await editor.press('Enter');
      await page.waitForFunction(() => typeof window.release === 'function');
      if (change === 'edit') await editor.fill('我继续编辑了');
      if (change === 'target')
        await page.evaluate(() => (window.target = { ...window.target, id: 'chat-b' }));
      if (change === 'destroy')
        await page.evaluate(() => window.__palbooTerminologyImports.destroy());
      await page.evaluate(() => {
        window.release();
        delete window.release;
      });
      await page.waitForFunction(() => window.calls.some((v) => v.action === 'release-import'));
      assert.equal(await page.evaluate(() => window.sent.length), 0);
      assert.doesNotMatch(await editor.inputValue(), /Palboo/);
    }
    await page.evaluate(() => {
      window.delayed = false;
      window.fail = true;
      window.calls = [];
      window.sent = [];
      window.target.id = 'chat-a';
      window.install();
    });
    await editor.fill('网络失败也保留这次发送');
    await editor.press('Enter');
    await page.waitForFunction(() => window.sent.length === 1);
    assert.equal((await page.evaluate(() => window.sent))[0], '网络失败也保留这次发送');
    await page.evaluate(() => {
      window.fail = false;
      window.delayed = true;
      window.calls = [];
      window.sent = [];
    });
    await editor.fill('慢连接不阻塞发送');
    await editor.press('Enter');
    await page.waitForFunction(() => window.sent.length === 1);
    assert.equal((await page.evaluate(() => window.sent))[0], '慢连接不阻塞发送');
    await page.evaluate(() => {
      window.release();
      delete window.release;
      window.delayed = false;
    });
    await page.waitForFunction(() => window.calls.some((v) => v.action === 'release-import'));
    await page.evaluate(() => {
      window.fail = false;
      window.calls = [];
      window.sent = [];
    });
    await editor.fill('输入法');
    await editor.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(await page.evaluate(() => window.calls.length), 0);

    await page.evaluate(() => {
      const rich = document.querySelector('#rich');
      rich.innerHTML =
        '<p>第一段 <span contenteditable="false" data-mention="true">@引用</span></p><p><br></p><p>第二段</p>';
      window.target = { ...window.target, composer: rich };
    });
    await page.locator('#send').click();
    await page.waitForFunction(() => window.sent.length === 1);
    assert.equal(
      await page.locator('[data-mention]').count(),
      1,
      'append preserves rich editor nodes',
    );
    assert.match(await page.locator('#rich').innerText(), /第一段 @引用/);
    assert.match(await page.locator('#rich').innerText(), /第二段/);
    await page.evaluate(() => {
      window.__palbooTerminologyImports.destroy();
      window.calls = [];
    });
    await page.locator('#send').click();
    assert.equal(await page.evaluate(() => window.calls.length), 0);
  } finally {
    await browser.close();
  }
});
