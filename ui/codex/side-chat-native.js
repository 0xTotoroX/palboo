/*
 * [INPUT]: 当前宿主已加载的 Rspack 模块、已提交的 React 输入区、侧边标签控制器。
 * [OUTPUT]: 受限侧边/父聊天身份、完整文字历史、忙碌回读与父聊天显现；不关闭或迁移会话。
 * [POS]: ChatGPT 私有接口兼容边界；未知结构拒绝，不修改 App 包或 CodexHost 文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { tr } from '../shared/i18n.js';

const unsupported = () => Error(tr('当前宿主不支持将此侧聊带回原主聊天。'));
let loader;
async function loadedRuntime() {
  if (!loader)
    loader = (async () => {
      // 只导入本页已执行的入口，ESM 返回同一个实例；不加载猜测的懒加载块。
      for (const script of [...document.scripts].reverse().slice(0, 8)) {
        if (!/^app:\/\/-\/assets\/[^/]+\.js$/.test(script.src)) continue;
        const module = await import(/* @vite-ignore */ script.src);
        const runtime = module.__webpack_require__;
        if (typeof runtime === 'function' && runtime.c && runtime.m) return runtime;
      }
      throw unsupported();
    })().catch((error) => {
      loader = null;
      throw error;
    });
  return loader;
}

// DOM 指针可能指向 alternate。沿当前发布树验证每条父子边，不使用过期 hook。
export function nativeScope(element) {
  // ProseMirror 自己创建 editor DOM；从最近的 React 承载节点开始。
  let first;
  for (let node = element, depth = 0; node && depth < 30; node = node.parentElement, depth++) {
    const key = Object.getOwnPropertyNames(node).find((key) => key.startsWith('__reactFiber$'));
    if (key) {
      first = node[key];
      break;
    }
  }
  const previous = [],
    seen = new Set();
  for (let node = first; node && previous.length < 1024; node = node.return) {
    if (seen.has(node)) return null;
    seen.add(node);
    previous.push(node);
  }
  let current = previous.at(-1)?.stateNode?.current;
  if (!current) return null;
  const path = [current];
  for (const expected of previous.slice(0, -1).reverse()) {
    let child = current.child,
      count = 0;
    while (child && child !== expected && child !== expected.alternate && count++ < 2000)
      child = child.sibling;
    if (!child || (child !== expected && child !== expected.alternate)) return null;
    path.push(child);
    current = child;
  }
  for (const fiber of path.reverse()) {
    const candidates = [fiber.memoizedProps?.value];
    let hook = fiber.memoizedState;
    for (let i = 0; hook && i < 150; i++, hook = hook.next)
      candidates.push(hook.memoizedState?.current);
    for (const value of candidates) {
      if (
        value &&
        Object.hasOwn(value, 'node') &&
        Object.hasOwn(value, 'scope') &&
        typeof value.get === 'function' &&
        typeof value.set === 'function' &&
        value.value?.routeKind
      )
        return value;
    }
  }
  return null;
}

export async function openSideChatAdapter(target) {
  const runtime = await loadedRuntime();
  return sideChatAdapter(target, runtime);
}

export function sideChatAdapter(target, runtime) {
  // 只使用已加载并核对过的宿主接口；未知形状不猜测目标聊天。
  const panels = runtime.c.XXJV?.exports;
  const manager = runtime.c.Dgwo?.exports;
  const threadHosts = runtime.c.tl5a?.exports;
  if (typeof panels?.getThreadPanelTabController !== 'function' || typeof panels.W3 !== 'function')
    throw unsupported();
  const scope = nativeScope(target.panel);
  if (!scope) throw unsupported();
  const controller = panels.getThreadPanelTabController('right');
  const tab = scope.get(controller.tabById$, target.tabId);
  const content = tab?.props?.content;
  if (!content || scope.get(panels.getThreadPanelTabController('bottom').tabById$, target.tabId))
    throw unsupported();
  const cloud = content.kind === 'work-side-conversation';
  const id = cloud ? content.sideChat?.conversationId : content.conversationId;
  const parent = { ...scope.value };
  const canonical = (value) =>
    runtime.c.aFoA?.exports?.kc((...args) => scope.get(...args), value) ?? value;
  const parentId = cloud ? canonical(parent.conversationId) : parent.conversationId;
  if (
    !id ||
    !parent.conversationId ||
    !tab.contentInstance ||
    (cloud
      ? target.tabId !== `sidechat:work:${content.sideChat.clientThreadId}` ||
        parent.routeKind !== 'chatgpt-thread' ||
        canonical(content.sideChat.parentConversationId) !== parentId
      : content.kind !== 'side-conversation' ||
        target.tabId !== `sidechat:${id}` ||
        content.persistent !== true ||
        content.hostId !== 'local' ||
        parent.routeKind !== 'local-thread' ||
        typeof manager?.V !== 'function' ||
        !threadHosts?.qX)
  )
    throw unsupported();
  const localHost = (value) =>
    value?.value.hostId ??
    (threadHosts?.qX ? value?.get(threadHosts.qX, value.value.conversationId) : null);
  if (!cloud && localHost(scope) !== content.hostId) throw unsupported();
  const instance = tab.contentInstance;
  const account = cloud ? content.sideChat : null;
  const accountModule = runtime.c.SPnB?.exports;
  const currentAccount = () =>
    !cloud ||
    (accountModule &&
      scope.get(accountModule.chatGptAuthenticatedAccountId$) === account.accountId &&
      scope.get(accountModule.o8) === account.userId);
  const sameParent = (candidate) =>
    !!candidate &&
    (cloud ? canonical(candidate.value.conversationId) : candidate.value.conversationId) ===
      parentId &&
    candidate.value.routeKind === parent.routeKind &&
    !candidate.value.workSideChat &&
    (cloud || localHost(candidate) === content.hostId) &&
    currentAccount();
  const current = () =>
    target.panel.isConnected &&
    sameParent(nativeScope(target.panel)) &&
    scope.get(controller.tabById$, target.tabId)?.contentInstance === instance;
  const rpc = cloud ? null : manager.V(scope, content.hostId);
  if (
    !cloud &&
    ['getConversation', 'getThreadExecutionState', 'listThreadTurns'].some(
      (name) => typeof rpc?.[name] !== 'function',
    )
  )
    throw unsupported();
  const matchesDestination = (editor) =>
    editor?.isConnected &&
    !editor.closest(
      '[role="tabpanel"][data-tab-id^="sidechat:"],[data-app-shell-active-page="false"]',
    ) &&
    sameParent(nativeScope(editor));
  return {
    kind: cloud ? 'cloud' : 'local',
    id,
    title: tab.title || '',
    parentId: parent.conversationId,
    current,
    matchesDestination,
    async localState() {
      const conversation = await rpc.getConversation(id);
      let state;
      try {
        state = conversation
          ? {
              id: conversation.id,
              title: conversation.title ?? '',
              ephemeral: conversation.ephemeral,
              requests: conversation.requests?.length || 0,
            }
          : null;
      } finally {
        conversation?.[Symbol.dispose]?.();
      }
      const execution = await rpc.getThreadExecutionState(id);
      return state && typeof execution?.inProgress === 'boolean'
        ? { ...state, busy: execution.inProgress || state.requests > 0 }
        : null;
    },
    async history(check = () => {}) {
      check();
      if (!current()) throw unsupported();
      if (cloud) {
        const read = runtime.c.k675?.exports?.I;
        if (typeof read !== 'function') throw unsupported();
        // 空选项取消默认三轮/2000字截断；读取当前分支而不是虚拟滚动 DOM。
        const history = read(scope, id, {});
        if (
          history?.conversationId !== id ||
          !Array.isArray(history.priorConversation?.conversation)
        )
          throw unsupported();
        return history.priorConversation.conversation;
      }
      const history = [],
        cursors = new Set(),
        turns = new Set();
      let cursor = null,
        size = 0;
      do {
        check();
        if (!current()) throw unsupported();
        // full + itemLimit:null 让原生分页器也读完每轮的 items；CodexHost 同样支持此接口。
        const { response } = await rpc.listThreadTurns(id, {
          cursor,
          limit: 100,
          sortDirection: 'asc',
          itemsView: 'full',
          itemLimit: null,
          requestOptions: { timeoutMs: 15000 },
        });
        check();
        if (!Array.isArray(response?.data)) throw unsupported();
        for (const turn of response.data) {
          if (
            !turn.id ||
            turns.has(turn.id) ||
            turn.itemsView !== 'full' ||
            !Array.isArray(turn.items)
          )
            throw unsupported();
          turns.add(turn.id);
          for (const item of turn.items) {
            let role, text;
            if (item.type === 'userMessage') {
              if (!Array.isArray(item.content)) throw unsupported();
              role = 'user';
              text = item.content
                .filter((part) => part.type === 'text')
                .map((part) => {
                  if (typeof part.text !== 'string') throw unsupported();
                  return part.text;
                })
                .join('\n');
            } else if (item.type === 'agentMessage') {
              role = 'assistant';
              text = item.text;
              if (typeof text !== 'string') throw unsupported();
            } else continue; // 工具输出、思考和附件不冒充问答；交接正文明确文字范围。
            size += text.length;
            if (size > 2_000_000) throw Error(tr('侧边聊天内容过长，未截断或关闭原聊天。'));
            history.push({ role, content: [{ content_type: 'text', text }] });
          }
        }
        cursor = response.nextCursor;
        if (cursor != null) {
          if (typeof cursor !== 'string' || cursors.has(cursor)) throw unsupported();
          cursors.add(cursor);
        }
      } while (cursor != null);
      return history;
    },
    revealParent() {
      if (!current()) throw unsupported();
      // 原生全宽侧栏可能隐藏父输入框；只收起面板，标签和来源草稿都保留。
      panels.W3(scope, 'right');
    },
    finish(editor) {
      if (!matchesDestination(editor)) throw unsupported();
      panels.W3(nativeScope(editor), 'right');
    },
  };
}
