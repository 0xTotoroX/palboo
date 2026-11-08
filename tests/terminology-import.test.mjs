/* [INPUT]: Isolated Chromium composers and a synthetic terminology queue.
 * [OUTPUT]: Next-user-send handoff, IME/edit intent cancellation, late-task release and retry acceptance.
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

test('pending terminology sends are invalidated by IME and editing events', async (t) => {
  const script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import {installTerminologyImports} from './ui/codex/terminology-import.js';
          window.install = () => installTerminologyImports({
            getTarget:()=>window.target, getSubmit:()=>document.querySelector('#send'), isBusy:()=>false,
            request:async(path,payload)=>{
              window.calls.push(payload);
              if(payload.action==='release-import') return {ok:true};
              return new Promise((resolve,reject)=>window.preparations.push({payload,resolve,reject}));
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
  async function fixture(run) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.route('https://term-import.test/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<main><textarea id="editor"></textarea><button id="send">发送</button></main>',
        }),
      );
      await page.goto('https://term-import.test/');
      await page.addScriptTag({ content: script });
      await page.evaluate(() => {
        const editor = document.querySelector('#editor');
        editor.value = '合成草稿';
        window.target = { id: 'chat-a', composer: editor, scope: document.querySelector('main') };
        window.calls = [];
        window.preparations = [];
        window.sent = [];
        window.composing = false;
        window.frames = [];
        const frame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) =>
          window.holdFrame ? window.frames.push(callback) : frame(callback);
        document.querySelector('#send').onclick = () =>
          window.sent.push({ text: editor.value, composing: window.composing });
        window.batch = (index = 0) => ({
          tasks: [{ id: `job-${index}`, attempt: `attempt-${index}` }],
          prompt: `[Palboo 术语任务：fixture-${index}]\n合成任务`,
        });
        window.edit = (kind) => {
          if (kind.startsWith('composition')) {
            window.composing = true;
            editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            if (kind === 'composition-ended') {
              window.composing = false;
              editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
            }
          } else if (kind === 'beforeinput') {
            editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: '改' }));
          } else {
            const original = editor.value;
            editor.value += '修改';
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: '修改' }));
            editor.value = original;
            editor.dispatchEvent(
              new InputEvent('input', { bubbles: true, inputType: 'historyUndo' }),
            );
          }
        };
        window.install();
      });
      await run(page);
    } finally {
      await page.close();
    }
  }
  const start = (page) =>
    page.evaluate(() => {
      document.querySelector('#send').click();
      return window.preparations.length;
    });
  try {
    for (const change of ['composition', 'composition-ended', 'edit-restore', 'beforeinput']) {
      await t.test(`${change} invalidates the pending send and releases late tasks`, () =>
        fixture(async (page) => {
          assert.equal(await start(page), 1);
          await page.evaluate((change) => {
            window.edit(change);
            const { token, target } = window.preparations[0].payload;
            window.verified = window.__palbooTerminologyImports.verify(token, target);
            window.preparations[0].resolve(window.batch());
          }, change);
          await page.waitForFunction(() => window.calls.some((v) => v.action === 'release-import'));
          assert.equal(await page.evaluate(() => window.verified), false);
          assert.deepEqual(await page.evaluate(() => window.sent), []);
          assert.equal(await page.locator('#editor').inputValue(), '合成草稿');
          assert.equal(
            await page.evaluate(
              () => window.calls.filter((v) => v.action === 'release-import').length,
            ),
            1,
          );
        }),
      );
    }
    for (const outcome of ['empty', 'failure', 'timeout']) {
      await t.test(`${outcome} does not replay a send cancelled by editing`, () =>
        fixture(async (page) => {
          await start(page);
          await page.evaluate((outcome) => {
            window.edit('edit-restore');
            if (outcome === 'empty') window.preparations[0].resolve({ tasks: [] });
            if (outcome === 'failure') window.preparations[0].reject(Error('offline'));
          }, outcome);
          // Cross the real deadline for timeout; the other outcomes settle on the next frame.
          if (outcome === 'timeout') await page.waitForTimeout(2100);
          else await page.evaluate(() => new Promise(requestAnimationFrame));
          assert.deepEqual(await page.evaluate(() => window.sent), []);
          assert.equal(await page.locator('#editor').inputValue(), '合成草稿');
          if (outcome === 'timeout') {
            await page.evaluate(() => window.preparations[0].resolve(window.batch()));
            await page.waitForFunction(() =>
              window.calls.some((v) => v.action === 'release-import'),
            );
          }
        }),
      );
    }
    await t.test('an unchanged send proceeds when there are no pending tasks', () =>
      fixture(async (page) => {
        await start(page);
        await page.evaluate(() => window.preparations[0].resolve({ tasks: [] }));
        await page.waitForFunction(() => window.sent.length === 1);
        assert.deepEqual(await page.evaluate(() => window.sent), [
          { text: '合成草稿', composing: false },
        ]);
      }),
    );
    for (const change of ['composition', 'edit-restore']) {
      await t.test(`${change} between append and replay leaves a retryable draft`, () =>
        fixture(async (page) => {
          await page.evaluate(() => (window.holdFrame = true));
          await start(page);
          await page.evaluate(() => window.preparations[0].resolve(window.batch()));
          await page.waitForFunction(() => window.frames.length === 1);
          await page.evaluate((change) => {
            window.edit(change);
            window.frames.shift()(performance.now());
          }, change);
          assert.deepEqual(await page.evaluate(() => window.sent), []);
          assert.match(await page.locator('#editor').inputValue(), /Palboo 术语任务/);
          assert.equal(
            await page.evaluate(
              () => window.calls.filter((v) => v.action === 'release-import').length,
            ),
            0,
          );
          await page.evaluate(() => {
            window.composing = false;
            window.target.composer.dispatchEvent(
              new CompositionEvent('compositionend', { bubbles: true }),
            );
          });
          assert.equal(await start(page), 1, 'a deliberate retry does not prepare or append again');
          assert.equal(await page.evaluate(() => window.sent.length), 1);
        }),
      );
    }
    await t.test('manual retry after append replaces the pending automatic replay', () =>
      fixture(async (page) => {
        await page.evaluate(() => (window.holdFrame = true));
        await start(page);
        await page.evaluate(() => window.preparations[0].resolve(window.batch()));
        await page.waitForFunction(() => window.frames.length === 1);
        assert.equal(await start(page), 1, 'retry reuses the visible task');
        assert.equal(await page.evaluate(() => window.sent.length), 1);
        await page.evaluate(() => window.frames.shift()(performance.now()));
        assert.equal(await page.evaluate(() => window.sent.length), 1, 'no second automatic send');
        assert.equal(
          await page.evaluate(
            () => window.calls.filter((v) => v.action === 'release-import').length,
          ),
          0,
          'the task in the submitted draft stays assigned',
        );
      }),
    );
    await t.test('a new deliberate send can proceed before an old cancelled request returns', () =>
      fixture(async (page) => {
        await start(page);
        await page.evaluate(() => window.edit('edit-restore'));
        assert.equal(await start(page), 2);
        await page.evaluate(() => window.preparations[1].resolve(window.batch(1)));
        await page.waitForFunction(() => window.sent.length === 1);
        await page.evaluate(() => window.preparations[0].resolve(window.batch()));
        await page.waitForFunction(() => window.calls.some((v) => v.action === 'release-import'));
        const sent = await page.evaluate(() => window.sent);
        assert.equal(sent.length, 1);
        assert.match(sent[0].text, /fixture-1/);
        assert.doesNotMatch(sent[0].text, /fixture-0/);
        assert.deepEqual(
          await page.evaluate(() =>
            window.calls.filter((v) => v.action === 'release-import').map((v) => v.tasks),
          ),
          [[{ id: 'job-0', attempt: 'attempt-0' }]],
        );
      }),
    );
    await t.test('composition ending outside the current target does not block a later send', () =>
      fixture(async (page) => {
        await start(page);
        await page.evaluate(() => {
          const original = window.target;
          window.edit('composition');
          const other = document.createElement('textarea');
          original.scope.append(other);
          window.target = { ...original, id: 'chat-b', composer: other };
          window.composing = false;
          original.composer.dispatchEvent(
            new CompositionEvent('compositionend', { bubbles: true }),
          );
          window.target = original;
        });
        assert.equal(await start(page), 2);
        await page.evaluate(() => {
          window.preparations[0].resolve(window.batch());
          window.preparations[1].resolve(window.batch(1));
        });
        await page.waitForFunction(() => window.sent.length === 1);
        assert.match(await page.locator('#editor').inputValue(), /fixture-1/);
        assert.equal(await page.evaluate(() => window.sent[0].composing), false);
      }),
    );
  } finally {
    await browser.close();
  }
});
