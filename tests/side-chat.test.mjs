/* [INPUT]: Real side-chat controller, native adapter and composer helpers with a synthetic host runtime.
 * [OUTPUT]: Parent append/handoff, identity and draft guards, toolbar geometry and disposal regressions.
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
import {mountComposerAction,composerActionBusy} from './ui/codex/composer-actions.js';
import {installPromptEnhancer} from './ui/codex/prompt-enhancement.js';
Object.assign(window,{side,native,rawComposerText,setLocale,mountComposerAction,composerActionBusy,installPromptEnhancer});`,
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
</style><main data-app-shell-main-content-layout><form data-codex-composer-root><div class="ProseMirror" contenteditable="true">parent draft</div></form></main>
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
    window.pages = options.pages || [
      {
        data: [
          {
            id: 'turn-1',
            itemsView: 'full',
            items: [
              { type: 'userMessage', content: [{ type: 'text', text: 'first local question' }] },
              { type: 'agentMessage', text: 'first local answer' },
            ],
          },
        ],
        nextCursor: null,
      },
    ];
    window.installOptimizer = () => {
      window.prompt = window.installPromptEnhancer({
        getTarget: () => ({
          id: 'side-a',
          composer: editor,
          root: panel,
          scope: editor.closest('form'),
        }),
        request: async () => {
          window.log.push(['optimize']);
          return new Promise((resolve) => (window.resolvePrompt = resolve));
        },
      });
      window.promptButton = document
        .querySelector('span[data-palboo-prompt]')
        .shadowRoot.querySelector('button');
    };
    document.addEventListener('submit', (e) => {
      e.preventDefault();
      window.log.push(['send']);
    });
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
          if (key === 'thread-host') return options.destinationHost ?? 'local';
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
      async listThreadTurns(id, opts) {
        window.log.push(['turns', opts]);
        await window.hooks.history?.();
        return { response: window.pages[opts.cursor ? Number(opts.cursor) : 0] };
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
            W3: (_scope, name) => {
              window.log.push(['hide', name]);
              document.querySelector('aside').hidden = true;
              document.querySelector('main').hidden = false;
            },
          },
          Dgwo: {
            V: (scope) =>
              options.staleSource && scope.value.conversationId === 'parent'
                ? {
                    ...rpc,
                    getConversation(id) {
                      if (window.navigated) throw Error('Disposed source scope');
                      return rpc.getConversation(id);
                    },
                  }
                : rpc,
          },
          TL6G: {
            O1: {
              handlers: new Set(['navigate-to-route']),
              dispatchHostMessage(message) {
                window.log.push(['navigate', message.path]);
                window.navigated = true;
                if (window.hooks.navigate) return window.hooks.navigate();
                main.textContent = options.destinationDraft || '';
                const id = message.path.split('/').at(-1);
                window.attachScope(main, {
                  routeKind: options.cloud ? 'chatgpt-thread' : 'local-thread',
                  conversationId: id,
                  hostId: options.explicitDestinationHost ? 'local' : null,
                });
              },
            },
          },
          DBCl: { _RT: (id) => `/local/${id}` },
          tl5a: { qX: 'thread-host' },
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
    const button = page.getByRole('button', { name: 'Bring to original chat' });
    assert.equal(await button.getAttribute('title'), 'Bring to original chat');
    assert.equal((await button.textContent()).trim(), '');
    const geometry = await button.evaluate((node) => ({
      hit: node.getBoundingClientRect().height,
      icon: node.querySelector('svg').getBoundingClientRect().width,
    }));
    assert.deepEqual(geometry, { hit: 32, icon: 18 });
    await page.evaluate(() => {
      const form = document.querySelector('aside [data-codex-composer-root]');
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

test('a retained side chat mounts after becoming visible without a subtree mutation', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      window.__palbooSideChat.destroy();
      document.querySelector('aside').style.display = 'none';
      window.setup();
    });
    assert.equal(await page.locator('[data-palboo-side-chat=true]').count(), 0);
    // Allow the hidden initial layout to settle; reveal changes only an ancestor's style.
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      document.querySelector('aside').style.display = '';
    });
    await page
      .getByRole('button', { name: '带回原主聊天', exact: true })
      .waitFor({ timeout: 2000 });
    await page.evaluate(() => {
      document.querySelector('aside').dataset.appShellActivePage = 'false';
    });
    await page.waitForFunction(() => !document.querySelector('[data-palboo-side-chat=true]'));
    await page.evaluate(() => {
      document.querySelector('aside').dataset.appShellActivePage = 'true';
    });
    await page.getByRole('button', { name: '带回原主聊天', exact: true }).waitFor();
  } finally {
    await page.close();
  }
});

test('continuous mutations in another chat cannot starve side-chat mounting', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      window.__palbooSideChat.destroy();
      document.querySelector('aside').hidden = true;
      window.setup();
      const noise = document.createElement('span');
      document.querySelector('main').append(noise);
      window.noiseTimer = setInterval(() => noise.replaceChildren(document.createElement('i')), 20);
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      document.querySelector('aside').hidden = false;
    });
    await page
      .getByRole('button', { name: '带回原主聊天', exact: true })
      .waitFor({ timeout: 1500 });
  } finally {
    await page.evaluate(() => clearInterval(window.noiseTimer));
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

const mainText = (page) =>
  page.evaluate(() => window.rawComposerText(document.querySelector('main .ProseMirror')));
const noMigration = async (page) => {
  assert.equal(
    (await actions(page)).some(([kind]) =>
      ['rename', 'close', 'reload', 'navigate', 'new-cloud', 'send'].includes(kind),
    ),
    false,
  );
  assert.equal(await page.evaluate(() => window.parentScope.conversationId), 'parent');
  assert.equal(await page.evaluate(() => window.meta.sideConversation), true);
  assert.equal(await page.locator('[role=tabpanel]').count(), 1);
};

test('local handoff appends full paginated questions, answers and exact side draft to the original draft, never sends', async () => {
  const pages = Array.from({ length: 3 }, (_, i) => ({
    data: [
      {
        id: `turn-${i}`,
        itemsView: 'full',
        items: [
          { type: 'userMessage', content: [{ type: 'text', text: `question ${i}` }] },
          { type: 'agentMessage', text: `answer ${i}` },
          { type: 'commandExecution', aggregatedOutput: 'tool output must not become an answer' },
        ],
      },
    ],
    nextCursor: i === 2 ? null : String(i + 1),
  }));
  const page = await fixture({ pages });
  try {
    await page.getByRole('button', { name: '带回原主聊天', exact: true }).focus();
    await page.keyboard.press('Enter');
    await settled(page);
    const text = await mainText(page);
    assert.ok(text.startsWith('parent draft\n\n'));
    assert.ok(text.endsWith('  unsent\n\nkeep $1 & <text>\n'));
    for (let i = 0; i < 3; i++) {
      assert.ok(text.includes(`question ${i}`));
      assert.ok(text.includes(`answer ${i}`));
    }
    assert.ok(text.indexOf('answer 0') < text.indexOf('question 1'));
    assert.ok(!text.includes('tool output must not'));
    assert.equal((await actions(page)).filter(([kind]) => kind === 'turns').length, 3);
    assert.equal(await page.locator('aside').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__palbooSideChat.recovery()), null);
    await noMigration(page);
    assert.deepEqual(await page.evaluate(() => window.forkSource), {
      parentId: 'parent',
      turnId: 'turn-1',
    });
    // Reopen the retained side tab, even with later parent edits: do not insert the same block twice.
    await page.evaluate(() => {
      document.querySelector('aside').hidden = false;
      document.querySelector('main .ProseMirror').append('\nmore parent draft');
      window.__palbooSideChat.refresh();
    });
    const edited = await mainText(page);
    await click(page);
    await settled(page);
    assert.equal(await mainText(page), edited);
  } finally {
    await page.close();
  }
});

test('cloud current branch including long history returns to the same parent with its existing draft', async () => {
  const history = Array.from({ length: 90 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: [{ content_type: 'text', text: `message ${i} ${'long '.repeat(80)}` }],
  }));
  const page = await fixture({
    cloud: true,
    history,
    title: 'Research',
    draft: '\n  side blank lines\n\n',
  });
  try {
    await click(page);
    await settled(page);
    const text = await mainText(page);
    assert.ok(text.startsWith('parent draft\n\n'));
    assert.ok(text.includes(history[0].content[0].text));
    assert.ok(text.includes(history.at(-1).content[0].text));
    assert.ok(text.endsWith('\n  side blank lines\n\n'));
    assert.deepEqual(await actions(page), [
      ['history', {}],
      ['hide', 'right'],
    ]);
    await noMigration(page);
  } finally {
    await page.close();
  }
});

test('full-width side panel reveals the same parent without closing its tab or losing either draft', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => (document.querySelector('main').hidden = true));
    await click(page);
    await settled(page);
    assert.ok((await mainText(page)).startsWith('parent draft\n\n'));
    assert.equal(await page.locator('main').isVisible(), true);
    assert.ok(
      await page.evaluate(() =>
        window.rawComposerText(document.querySelector('aside .ProseMirror')).startsWith('  unsent'),
      ),
    );
    await noMigration(page);
  } finally {
    await page.close();
  }
});

test('source edits, replaced tabs, parent navigation, disabling and destruction during reads cancel without a late write', async () => {
  for (const change of ['source', 'tab', 'parent', 'disabled', 'destroy']) {
    const page = await fixture();
    try {
      await page.evaluate(
        () => (window.hooks.history = () => new Promise((resolve) => (window.release = resolve))),
      );
      await click(page);
      await page.waitForFunction(() => !!window.release);
      await click(page);
      assert.equal((await actions(page)).filter(([kind]) => kind === 'turns').length, 1);
      await page.evaluate((change) => {
        if (change === 'source')
          document.querySelector('aside .ProseMirror').textContent = 'new source';
        if (change === 'tab') window.tab.contentInstance = Symbol();
        if (change === 'parent') window.parentScope.conversationId = 'another';
        if (change === 'disabled') {
          window.enabled = false;
          window.__palbooSideChat.refresh();
        }
        if (change === 'destroy') window.__palbooSideChat.destroy();
        window.release();
      }, change);
      await page.waitForFunction(() => !window.composerActionBusy());
      await page.waitForTimeout(100);
      assert.equal(await mainText(page), 'parent draft');
      assert.equal(
        (await actions(page)).some(([kind]) => kind === 'hide'),
        false,
      );
    } finally {
      await page.close();
    }
  }
});

test('latest parent edits are preserved; parent IME, streaming, rich text or wrong identity is never overwritten', async () => {
  for (const change of ['draft', 'ime', 'streaming', 'rich', 'wrong', 'account']) {
    const page = await fixture();
    try {
      await page.evaluate(
        () => (window.hooks.history = () => new Promise((resolve) => (window.release = resolve))),
      );
      await click(page);
      await page.waitForFunction(() => !!window.release);
      await page.evaluate((change) => {
        const editor = document.querySelector('main .ProseMirror');
        if (change === 'draft') editor.textContent = 'newest parent draft\n\n';
        if (change === 'ime')
          editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        if (change === 'streaming')
          editor
            .closest('form')
            .insertAdjacentHTML('beforeend', '<button aria-label="Stop"></button>');
        if (change === 'rich')
          editor.innerHTML = '<span contenteditable="false">reference</span>draft';
        if (change === 'wrong')
          window.attachScope(editor, {
            routeKind: 'local-thread',
            conversationId: 'other',
            hostId: 'local',
          });
        if (change === 'account')
          window.attachScope(editor, {
            routeKind: 'local-thread',
            conversationId: 'parent',
            hostId: 'remote',
          });
        window.release();
        window.hooks.history = null;
      }, change);
      if (change === 'wrong' || change === 'account') {
        await page.clock.install();
        await page.clock.runFor(30100);
      }
      await settled(page);
      const text = await mainText(page);
      if (change === 'draft') assert.ok(text.startsWith('newest parent draft\n\n上下文交接'));
      else assert.equal(text, change === 'rich' ? 'referencedraft' : 'parent draft');
    } finally {
      await page.close();
    }
  }
});

test('malformed, repeating, incomplete or oversized history fails without truncating or hiding the source', async () => {
  for (const mode of ['cursor', 'partial', 'malformed', 'oversized', 'empty', 'error']) {
    const page = await fixture({ draft: mode === 'empty' ? '' : 'draft' });
    try {
      await page.evaluate((mode) => {
        if (mode === 'cursor') window.pages = [{ data: [], nextCursor: '0' }];
        if (mode === 'partial') window.pages[0].data[0].itemsView = 'summary';
        if (mode === 'malformed') window.pages[0].data[0].items[1].text = null;
        if (mode === 'oversized') window.pages[0].data[0].items[1].text = 'x'.repeat(2000001);
        if (mode === 'empty') window.pages = [{ data: [], nextCursor: null }];
        if (mode === 'error')
          window.hooks.history = () => {
            throw Error('read failed');
          };
      }, mode);
      await click(page);
      await settled(page);
      assert.equal(await mainText(page), 'parent draft');
      assert.equal(await page.locator('aside').isVisible(), true);
      assert.equal(await page.evaluate(() => window.composerActionBusy()), false);
    } finally {
      await page.close();
    }
  }
});

test('optimizer cancel/restore and handoff share an immediate lock; late optimization cannot unlock or overwrite a handoff', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      window.installOptimizer();
      window.promptButton.click();
    });
    await page.waitForFunction(() => !!window.resolvePrompt);
    assert.equal(await page.evaluate(() => window.control.disabled), true);
    assert.equal(await page.evaluate(() => window.promptButton.disabled), false); // cancel remains usable
    await click(page);
    assert.equal(
      (await actions(page)).some(([kind]) => kind === 'turns'),
      false,
    );
    await page.evaluate(() => {
      window.promptButton.click();
      window.hooks.history = () => new Promise((resolve) => (window.release = resolve));
      window.control.click();
    });
    await page.waitForFunction(() => !!window.release);
    assert.equal(await page.evaluate(() => window.promptButton.disabled), true);
    await page.evaluate(() => {
      window.resolvePrompt({ prompt: 'late replacement' });
      window.promptButton.click();
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.composerActionBusy()), true);
    assert.equal(await page.evaluate(() => window.promptButton.disabled), true);
    await page.evaluate(() => {
      window.hooks.history = null;
      window.release();
    });
    await settled(page);
    assert.ok((await mainText(page)).includes('unsent'));
    assert.ok(!(await mainText(page)).includes('late replacement'));
    assert.equal((await actions(page)).filter(([kind]) => kind === 'optimize').length, 1);
    assert.equal(await page.evaluate(() => window.composerActionBusy()), false);
  } finally {
    await page.close();
  }
});

test('restore icon differs from handoff and the two real controls align without overlap; reinjection releases pending locks', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      window.installOptimizer();
      window.promptButton.click();
      window.resolvePrompt({ prompt: 'optimized text' });
    });
    await page.waitForFunction(
      () => window.promptButton.getAttribute('aria-label') === '恢复原提示词',
    );
    const geometry = await page.evaluate(() => {
      const a = window.control.getBoundingClientRect(),
        b = window.promptButton.getBoundingClientRect();
      return {
        icons: [
          window.control.querySelector('svg').dataset.icon,
          window.promptButton.querySelector('svg').dataset.icon,
        ],
        sameY: a.y === b.y,
        apart: a.right <= b.left || b.right <= a.left,
        heights: [a.height, b.height],
      };
    });
    assert.deepEqual(geometry, {
      icons: ['side-chat-handoff', 'return'],
      sameY: true,
      apart: true,
      heights: [32, 32],
    });
    await page.evaluate(() => {
      window.hooks.history = () => new Promise((resolve) => (window.release = resolve));
      window.control.click();
    });
    await page.waitForFunction(() => !!window.release);
    assert.equal(await page.evaluate(() => window.promptButton.disabled), true);
    await page.evaluate(() => {
      window.setup();
      window.promptButton.click();
      window.release();
    });
    await page.waitForFunction(() => !window.composerActionBusy());
    assert.equal(
      await page.evaluate(() =>
        window.rawComposerText(document.querySelector('aside .ProseMirror')),
      ),
      '  unsent\n\nkeep $1 & <text>\n',
    );
    assert.equal(await mainText(page), 'parent draft');
    await page.evaluate(() => {
      window.promptButton.click();
      window.prompt.destroy();
    });
    assert.equal(await page.evaluate(() => window.composerActionBusy()), false);
  } finally {
    await page.close();
  }
});

test('failed parent writes retain a copyable snapshot across reinjection without touching the side draft', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() =>
      document.querySelector('main .ProseMirror').addEventListener('input', (e) => {
        e.target.textContent = 'parent draft';
      }),
    );
    await click(page);
    await settled(page);
    const recovery = await page.evaluate(() => window.__palbooSideChat.recovery());
    assert.ok(recovery.text.includes('first local answer'));
    await page.evaluate(() => {
      window.setup();
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => (window.copied = text) },
      });
    });
    await page.getByRole('button', { name: '复制保留的草稿' }).click();
    assert.equal(await page.evaluate(() => window.copied), recovery.text);
    assert.equal(await mainText(page), 'parent draft');
    assert.equal(await page.locator('aside').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__palbooSideChat.recovery()), null);
  } finally {
    await page.close();
  }
});

test('cloud server/client aliases resolve the original parent, while reparented tabs fail closed', async () => {
  for (const valid of [true, false]) {
    const page = await fixture({ cloud: true });
    try {
      await page.evaluate((valid) => {
        window.tab.props.content.sideChat.parentConversationId = valid
          ? 'server-parent'
          : 'unrelated';
        window.runtime.c.aFoA = {
          exports: { kc: (_get, id) => (id === 'parent' ? 'server-parent' : id) },
        };
      }, valid);
      await click(page);
      await settled(page);
      if (valid) assert.ok((await mainText(page)).startsWith('parent draft\n\n上下文交接'));
      else {
        assert.equal(await mainText(page), 'parent draft');
        assert.deepEqual(await actions(page), []);
      }
    } finally {
      await page.close();
    }
  }
});
