/* [INPUT]: Real side-chat controller, native adapter and composer helpers with a synthetic host runtime.
 * [OUTPUT]: Promotion/handoff, identity and draft guards, toolbar geometry and disposal regressions.
 * [POS]: Isolated Chromium only; no real conversations, files, models or host processes are changed.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import * as side from './ui/codex/side-chat.js';
import * as native from './ui/codex/side-chat-native.js';
import {rawComposerText} from './ui/codex/composer.js';
import {setLocale} from './ui/shared/i18n.js';
import {mountComposerAction} from './ui/codex/composer-actions.js';
Object.assign(window,{side,native,rawComposerText,setLocale,mountComposerAction});`,
    },
    bundle: true,
    write: false,
    define: { PALBOO_DEVELOPMENT: 'true' },
  })
).outputFiles[0].text;
const compatibility = await readFile('ui/codex/codex-host.js', 'utf8');
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
});

async function fixture(options = {}) {
  const page = await browser.newPage();
  await page.setContent(`<style>
body{display:flex;gap:20px}main,aside{width:420px}form{padding:8px}.ProseMirror{min-height:60px;white-space:break-spaces}
.footer{display:flex;align-items:center;justify-content:flex-end}.native{display:flex}
button{width:32px;height:32px}button[data-codexhost-agent-control]{width:80px}
</style><main data-app-shell-main-content-layout><form><div class="ProseMirror" contenteditable="true">parent draft</div></form></main>
<aside data-app-shell-focus-area="right-panel"><section role="tabpanel" data-tab-id="sidechat:side-a">
<form data-codex-composer-root><div class="ProseMirror" contenteditable="true"></div><div class="footer"><div class="models"></div><div class="native"><button aria-label="Dictate"></button></div></div></form>
</section></aside>`);
  await page.addScriptTag({ content: compatibility });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((options) => {
    const panel = document.querySelector('[role=tabpanel]');
    const editor = panel.querySelector('.ProseMirror');
    const main = document.querySelector('main .ProseMirror');
    editor.textContent = options.draft ?? '  unsent\n\nkeep $1 & <text>\n';
    window.log = [];
    window.enabled = true;
    window.parentScope = {
      routeKind: options.cloud ? 'chatgpt-thread' : 'local-thread',
      conversationId: 'parent',
      hostId: 'local',
    };
    window.parentDraft = main.textContent;
    window.meta = {
      id: 'side-a',
      title: null,
      ephemeral: false,
      sideConversation: true,
      requests: [],
      ...options.meta,
    };
    window.account = 'account';
    window.execution = { inProgress: !!options.busy };
    window.forkSource = { parentId: 'parent', turnId: 'turn-1' };
    window.hooks = {};
    window.historyInput = options.history || [
      { role: 'user', content: [{ content_type: 'text', text: 'first cloud question' }] },
      { role: 'assistant', content: [{ content_type: 'text', text: 'first cloud answer' }] },
    ];
    const stores = { right: new Map(), bottom: new Map() };
    const controllers = Object.fromEntries(
      Object.entries(stores).map(([name, store]) => [
        name,
        {
          tabById$: name,
          closeTab(_scope, id, opts) {
            window.log.push(['close', id, opts]);
            if (window.hooks.close) return window.hooks.close();
            store.delete(id);
            panel.remove();
          },
        },
      ]),
    );
    window.attachScope = (element, value) => {
      const scope = {
        node: {},
        scope: {},
        value,
        get(key, id) {
          if (stores[key]) return stores[key].get(id);
          if (key === 'account') return window.account;
          if (key === 'user') return 'user';
          if (key === 'temporary') return false;
        },
        set() {},
        query: { invalidate: (key) => window.log.push(['invalidate', key]) },
      };
      const fiber = { memoizedState: { memoizedState: { current: scope } } };
      const root = { child: fiber };
      root.stateNode = { current: root };
      fiber.return = root;
      (element.matches('.ProseMirror') ? element.parentElement : element).__reactFiber$test = fiber;
      return scope;
    };
    window.attachScope(panel, window.parentScope);
    window.attachScope(main, window.parentScope);
    window.attachScope(editor, {
      routeKind: options.cloud ? 'chatgpt-thread' : 'local-thread',
      conversationId: 'side-a',
      hostId: 'local',
      workSideChat: !!options.cloud,
    });
    if (options.cloud) panel.dataset.tabId = 'sidechat:work:client-a';
    window.tab = {
      title: options.title ?? 'Side chat',
      contentInstance: Symbol(),
      props: {
        content: options.cloud
          ? {
              kind: 'work-side-conversation',
              sideChat: {
                conversationId: 'side-a',
                clientThreadId: 'client-a',
                parentConversationId: 'parent',
                accountId: 'account',
                userId: 'user',
              },
            }
          : {
              kind: 'side-conversation',
              conversationId: 'side-a',
              hostId: 'local',
              persistent: true,
            },
      },
    };
    stores.right.set(panel.dataset.tabId, window.tab);
    const rpc = {
      async getConversation(id) {
        return { ...window.meta, [Symbol.dispose]: () => window.log.push(['dispose', id]) };
      },
      async getThreadExecutionState() {
        return window.execution;
      },
      async getConversationTitleInput() {
        return {
          input: [
            { type: 'text', text: options.question ?? 'A meaningful first question\nsecond line' },
          ],
        };
      },
      async setThreadTitle(id, title, opts) {
        window.log.push(['rename', id, title, opts]);
        await window.hooks.rename?.();
        if (opts.expectedTitle !== window.meta.title) return false;
        window.meta.title = title;
        return true;
      },
      async discardConversationFromCache(id) {
        window.log.push(['reload', id]);
        await window.hooks.reload?.();
        window.meta.sideConversation = false;
      },
    };
    window.runtime = {
      c: Object.fromEntries(
        Object.entries({
          XXJV: {
            getThreadPanelTabController: (name) => controllers[name],
            W3: (_scope, name) => window.log.push(['hide', name]),
          },
          Dgwo: { V: () => rpc },
          TL6G: {
            O1: {
              handlers: new Set(['navigate-to-route']),
              dispatchHostMessage(message) {
                window.log.push(['navigate', message.path]);
                if (window.hooks.navigate) return window.hooks.navigate();
                main.textContent = options.destinationDraft || '';
                const id = message.path.split('/').at(-1);
                window.attachScope(main, {
                  routeKind: options.cloud ? 'chatgpt-thread' : 'local-thread',
                  conversationId: id,
                  hostId: 'local',
                });
              },
            },
          },
          DBCl: { _RT: (id) => `/local/${id}` },
          fKdM: { v: 'recents' },
          SPnB: { chatGptAuthenticatedAccountId$: 'account', o8: 'user' },
          OOaz: { co: () => 'new-cloud-id' },
          MrGp: {
            Ik: 'temporary',
            iF: (_scope, id, opts) => window.log.push(['new-cloud', id, opts]),
          },
          jAnS: { mv: (id) => `/c/${id}` },
          k675: {
            I: (_scope, id, opts) => {
              window.log.push(['history', opts]);
              return {
                conversationId: id,
                priorConversation: { conversation: window.historyInput },
              };
            },
          },
        }).map(([id, exports]) => [id, { exports }]),
      ),
    };
    window.setup = () =>
      window.side.installSideChatSwitcher({
        isEnabled: () => window.enabled,
        adapter: (target) => window.native.sideChatAdapter(target, window.runtime),
      });
    window.setLocale(options.locale || 'zh-CN');
    window.setup();
    window.control = document
      .querySelector('[data-palboo-side-chat=true]')
      .shadowRoot.querySelector('button');
  }, options);
  return page;
}
const click = (page) => page.evaluate(() => window.control.click());
const settled = (page) =>
  page.waitForFunction(() => window.control.getAttribute('aria-busy') === 'false');
const actions = (page) => page.evaluate(() => window.log.filter(([kind]) => kind !== 'dispose'));

test('persistent local promotion preserves id, ancestry and exact draft, uses acknowledged title and native close', async () => {
  const page = await fixture({ destinationDraft: 'existing destination draft' });
  try {
    await page.getByRole('button', { name: '切至主聊天', exact: true }).focus();
    await page.keyboard.press('Enter');
    await settled(page);
    assert.deepEqual(await actions(page), [
      [
        'rename',
        'side-a',
        'A meaningful first question second line',
        { expectedTitle: null, requireAcknowledgement: true },
      ],
      ['close', 'sidechat:side-a', { recordCloseUndo: false }],
      ['reload', 'side-a'],
      ['hide', 'right'],
      ['navigate', '/local/side-a'],
      ['invalidate', 'recents'],
    ]);
    assert.equal(
      await page.evaluate(() =>
        window.rawComposerText(document.querySelector('main .ProseMirror')),
      ),
      'existing destination draft\n\n  unsent\n\nkeep $1 & <text>\n',
    );
    assert.deepEqual(await page.evaluate(() => window.forkSource), {
      parentId: 'parent',
      turnId: 'turn-1',
    });
    assert.equal(await page.locator('[role=tabpanel]').count(), 0);
    assert.equal(await page.evaluate(() => window.__palbooSideChat.recovery()), null);
    assert.equal(await page.evaluate(() => window.meta.sideConversation), false);
  } finally {
    await page.close();
  }
});

test('title precedence, default labels, stored names and Unicode cap', async () => {
  const page = await fixture();
  try {
    assert.deepEqual(
      await page.evaluate(() => [
        window.side.sideChatTitle(' Actual tab ', 'question', 'stored'),
        window.side.sideChatTitle('侧边聊天 (2)', 'question', 'stored'),
        window.side.sideChatTitle('Side chat', 'question'),
        Array.from(window.side.sideChatTitle('', '🌿'.repeat(70))).length,
      ]),
      ['Actual tab', 'stored', 'question', 60],
    );
  } finally {
    await page.close();
  }
});

test('entry is only in one visible right side composer, matches native geometry and coexists with optimization', async () => {
  const page = await fixture({ locale: 'en' });
  try {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.evaluate(() => {
      document.querySelector('aside').style.width = '240px';
    });
    const button = page.getByRole('button', { name: 'Switch to main chat' });
    assert.equal(await button.getAttribute('title'), 'Switch to main chat');
    assert.equal((await button.textContent()).trim(), '');
    const geometry = await button.evaluate((node) => ({
      hit: node.getBoundingClientRect().height,
      icon: node.querySelector('svg').getBoundingClientRect().width,
    }));
    assert.deepEqual(geometry, { hit: 32, icon: 18 });
    await page.evaluate(() => {
      const form = document.querySelector('[data-codex-composer-root]');
      const host = document.createElement('span');
      host.dataset.palbooPrompt = 'true';
      window.mountComposerAction(host, form);
      window.__palbooSideChat.refresh();
      window.mountComposerAction(host, form);
    });
    assert.equal(await page.locator('[data-palboo-prompt]').count(), 1);
    assert.equal(await page.locator('[data-palboo-side-chat=true]').count(), 1);
    await page.evaluate(() => {
      document.querySelector('aside').dataset.appShellFocusArea = 'bottom-panel';
      window.__palbooSideChat.refresh();
    });
    assert.equal(await page.locator('[data-palboo-side-chat=true]').count(), 0);
    await page.evaluate(() => {
      document.querySelector('aside').dataset.appShellFocusArea = 'right-panel';
      document.querySelector('[role=tabpanel]').hidden = true;
      window.__palbooSideChat.refresh();
    });
    assert.equal(await page.locator('[data-palboo-side-chat=true]').count(), 0);
    await page.evaluate(() => {
      document.querySelector('[role=tabpanel]').remove();
      window.__palbooSideChat.refresh();
    });
    assert.equal(await page.locator('[data-palboo-side-chat=true]').count(), 0);
    assert.deepEqual(await actions(page), []);
  } finally {
    await page.close();
  }
});

test('streaming, IME, backend busy, ephemeral and unknown execution never close the source', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      document.querySelector('[aria-label=Dictate]').setAttribute('aria-label', 'Stop');
      window.__palbooSideChat.refresh();
    });
    assert.equal(await page.evaluate(() => window.control.disabled), true);
    await click(page);
    assert.deepEqual(await actions(page), []);
    await page.evaluate(() => {
      document.querySelector('[aria-label=Stop]').setAttribute('aria-label', 'Dictate');
      document
        .querySelector('aside .ProseMirror')
        .dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => window.control.disabled), true);
    await page.evaluate(() => {
      document
        .querySelector('aside .ProseMirror')
        .dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      window.execution.inProgress = true;
    });
    await click(page);
    await settled(page);
    assert.deepEqual(await actions(page), []);
    await page.evaluate(() => {
      window.execution.inProgress = false;
      window.meta.ephemeral = true;
    });
    await click(page);
    await settled(page);
    assert.deepEqual(await actions(page), []);
    await page.evaluate(() => {
      window.meta.ephemeral = false;
      window.execution = {};
    });
    await click(page);
    await settled(page);
    assert.deepEqual(await actions(page), []);
    assert.equal(await page.locator('[role=tabpanel]').count(), 1);
  } finally {
    await page.close();
  }
});

test('double click is serialized; a source edit or replaced tab during rename cancels further mutations', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      window.hooks.rename = () => new Promise((resolve) => (window.release = resolve));
      window.control.click();
      window.control.click();
    });
    await page.waitForFunction(() => !!window.release);
    await page.evaluate(() => {
      document.querySelector('aside .ProseMirror').textContent = 'user changed draft';
      window.release();
    });
    await settled(page);
    assert.equal((await actions(page)).length, 1);
    assert.equal(await page.locator('aside .ProseMirror').textContent(), 'user changed draft');
    await page.evaluate(() => {
      window.log = [];
      window.meta.title = null;
      window.control.click();
    });
    await page.waitForFunction(() => window.log.some(([kind]) => kind === 'rename'));
    await page.evaluate(() => {
      window.tab.contentInstance = Symbol();
      window.release();
    });
    await settled(page);
    assert.equal((await actions(page)).length, 1);
  } finally {
    await page.close();
  }
});

test('closed-tab cache failure retains recovery across reinjection; copying clears only the recovery', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      window.hooks.reload = () => {
        throw Error('synthetic cache failure');
      };
    });
    await click(page);
    await settled(page);
    assert.equal(
      (await actions(page)).some(([kind]) => kind === 'navigate'),
      false,
    );
    const recovery = await page.evaluate(() => window.__palbooSideChat.recovery());
    assert.equal(recovery.text, '  unsent\n\nkeep $1 & <text>\n');
    await page.evaluate(() => {
      window.setup();
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.copied = text;
          },
        },
      });
    });
    assert.equal(await page.evaluate(() => window.__palbooSideChatRecovery), undefined);
    await page.getByRole('button', { name: '复制保留的草稿' }).click();
    assert.equal(await page.evaluate(() => window.copied), recovery.text);
    assert.equal(await page.evaluate(() => window.__palbooSideChat.recovery()), null);
    assert.equal(await page.locator('main .ProseMirror').textContent(), 'parent draft');
  } finally {
    await page.close();
  }
});

test('navigation during cache reload and destruction during rename do not trigger late navigation or draft writes', async () => {
  for (const stage of ['reload', 'rename']) {
    const page = await fixture();
    try {
      await page.evaluate((stage) => {
        window.hooks[stage] = () => new Promise((resolve) => (window.release = resolve));
      }, stage);
      await click(page);
      await page.waitForFunction(() => !!window.release);
      await page.evaluate((stage) => {
        if (stage === 'reload') window.parentScope.conversationId = 'another-main';
        else window.__palbooSideChat.destroy();
        window.release();
      }, stage);
      await page.waitForTimeout(150);
      assert.equal(
        (await actions(page)).some(([kind]) => kind === 'navigate'),
        false,
      );
      assert.equal(await page.locator('main .ProseMirror').textContent(), 'parent draft');
    } finally {
      await page.close();
    }
  }
});

test('cloud handoff reads the whole current branch and creates a visible-history main draft without sending', async () => {
  const history = Array.from({ length: 90 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: [{ content_type: 'text', text: `message ${i} ${'long '.repeat(80)}` }],
  }));
  const page = await fixture({
    cloud: true,
    history,
    title: 'Research',
    draft: '\n  retain blank lines\n\n',
  });
  try {
    await click(page);
    await settled(page);
    assert.deepEqual(await actions(page), [
      ['history', {}],
      ['close', 'sidechat:work:client-a', { recordCloseUndo: false }],
      ['new-cloud', 'new-cloud-id', { hideFromHistory: false, isDoNotRemember: false }],
      ['hide', 'right'],
      ['navigate', '/c/new-cloud-id'],
    ]);
    const draft = await page.evaluate(() =>
      window.rawComposerText(document.querySelector('main .ProseMirror')),
    );
    assert.ok(draft.includes(history[0].content[0].text));
    assert.ok(draft.includes(history.at(-1).content[0].text));
    assert.ok(draft.endsWith('\n  retain blank lines\n\n'));
    assert.equal(await page.evaluate(() => window.__palbooSideChat.recovery()), null);
  } finally {
    await page.close();
  }
});

test('unknown host, account changes, rich source draft and attachments fail without closing or writing', async () => {
  for (const change of ['unknown', 'account', 'rich', 'attachment']) {
    const page = await fixture({ cloud: true });
    try {
      await page.evaluate((change) => {
        if (change === 'unknown') delete window.runtime.c.XXJV;
        if (change === 'account') window.account = 'other';
        if (change === 'rich')
          document.querySelector('aside .ProseMirror').innerHTML =
            '<span contenteditable="false">reference</span>';
        if (change === 'attachment')
          document
            .querySelector('aside form')
            .insertAdjacentHTML('beforeend', '<div data-attachment-id="file-1"></div>');
      }, change);
      await click(page);
      await settled(page);
      assert.deepEqual(await actions(page), []);
      assert.equal(await page.locator('[role=tabpanel]').count(), 1);
    } finally {
      await page.close();
    }
  }
});

test('unrelated destination is never filled; timeout keeps recoverable draft', async () => {
  const page = await fixture();
  try {
    await page.clock.install();
    await page.evaluate(() => {
      window.hooks.navigate = () => {};
    });
    await click(page);
    await page.waitForFunction(() => window.log.some(([kind]) => kind === 'navigate'));
    await page.clock.runFor(20100);
    await settled(page);
    assert.equal(await page.locator('main .ProseMirror').textContent(), 'parent draft');
    assert.ok(await page.evaluate(() => !!window.__palbooSideChat.recovery()));
  } finally {
    await page.close();
  }
});

test('native scope follows committed alternate and rejects detached ancestry', async () => {
  const page = await fixture();
  try {
    assert.deepEqual(
      await page.evaluate(() => {
        const element = document.querySelector('main .ProseMirror');
        const old = element.parentElement.__reactFiber$test,
          root = old.return;
        const alternate = {
          ...old,
          memoizedState: {
            memoizedState: {
              current: {
                ...window.native.nativeScope(element),
                value: { conversationId: 'new', routeKind: 'local-thread' },
              },
            },
          },
        };
        old.alternate = alternate;
        root.child = alternate;
        let top = root;
        for (let i = 0; i < 320; i++) {
          const parent = { child: top };
          top.return = parent;
          top = parent;
        }
        top.stateNode = { current: top };
        const id = window.native.nativeScope(element)?.value.conversationId;
        root.child = null;
        return [id, window.native.nativeScope(element)];
      }),
      ['new', null],
    );
  } finally {
    await page.close();
  }
});
