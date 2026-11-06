/* [INPUT]: Real Palboo browser modules and synthetic native chat state.
 * [OUTPUT]: Isolated side-chat/parent editors, history pages, native routing and mutation hooks.
 * [POS]: Shared browser fixture for side-chat append, promotion and history-range regressions.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
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
export async function sideChatFixture(browser, options = {}) {
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
    window.forkMeta = null;
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
          if (key === 'cloud-turns') return window.cloudTurns;
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
        return {
          ...(id === 'fork-a' ? window.forkMeta : window.meta),
          [Symbol.dispose]: () => window.log.push(['dispose', id]),
        };
      },
      async getThreadExecutionState() {
        return window.execution;
      },
      async listThreadTurns(id, opts) {
        window.log.push(['turns', opts]);
        await window.hooks.history?.();
        return {
          response: (id === 'fork-a' ? window.forkPages : window.pages)[
            opts.cursor ? Number(opts.cursor) : 0
          ],
        };
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
        const meta = id === 'fork-a' ? window.forkMeta : window.meta;
        if (opts.expectedTitle !== meta.title) return false;
        meta.title = title;
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
          ISgP: { O: 'cloud-turns' },
          kkdx: { o: ({ message }) => message },
          IhcX: {
            y: async (_scope, host, params) => {
              window.log.push(['fork', host, params]);
              await window.hooks.fork?.();
              const turns = window.pages.flatMap((page) => page.data);
              const boundary = turns.findIndex((turn) => turn.id === params.targetTurnId);
              window.forkPages ||= [{ data: turns.slice(0, boundary + 1), nextCursor: null }];
              window.forkMeta = {
                ...window.meta,
                id: 'fork-a',
                title: null,
                sideConversation: false,
              };
              return { conversationId: 'fork-a', synchronization: { status: 'complete' } };
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
    window.independentControl = document
      .querySelector('[data-palboo-side-chat=true]')
      .shadowRoot.querySelector('[data-side-action=independent]');
  }, options);
  return page;
}
