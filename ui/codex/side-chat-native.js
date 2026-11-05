/*
 * [INPUT]: 当前宿主已加载的 Rspack 模块、已提交的 React 输入区、侧边标签控制器。
 * [OUTPUT]: 受限侧边聊天身份、标题/忙碌回读、关闭标签、持久会话缓存重载和主窗口导航。
 * [POS]: ChatGPT 私有接口兼容边界；未知结构拒绝，不修改 App 包或 CodexHost 文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { tr } from '../shared/i18n.js';

const unsupported = () => Error(tr('当前宿主不支持安全切换此侧边聊天。'));
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
  // 此接口组合由随包源码与只读实机探针核对；符号或形状变化时停止，不能猜测另一会话。
  const panels = runtime.c.XXJV?.exports;
  const manager = runtime.c.Dgwo?.exports;
  const bus = runtime.c.TL6G?.exports?.O1;
  const route = runtime.c.DBCl?.exports?._RT;
  if (
    typeof panels?.getThreadPanelTabController !== 'function' ||
    typeof panels.W3 !== 'function' ||
    typeof bus?.dispatchHostMessage !== 'function' ||
    !bus.handlers?.has('navigate-to-route')
  )
    throw unsupported();
  const scope = nativeScope(target.panel);
  if (!scope) throw unsupported();
  const controller = panels.getThreadPanelTabController('right');
  const tab = scope.get(controller.tabById$, target.tabId);
  const content = tab?.props?.content;
  if (!content || scope.get(panels.getThreadPanelTabController('bottom').tabById$, target.tabId))
    throw unsupported();
  const cloud = content.kind === 'work-side-conversation';
  if (
    !cloud &&
    (typeof manager?.V !== 'function' ||
      typeof route !== 'function' ||
      route('palboo-probe') !== '/local/palboo-probe')
  )
    throw unsupported();
  const id = cloud ? content.sideChat?.conversationId : content.conversationId;
  if (
    !id ||
    (cloud
      ? target.tabId !== `sidechat:work:${content.sideChat.clientThreadId}`
      : content.kind !== 'side-conversation' ||
        target.tabId !== `sidechat:${id}` ||
        content.persistent !== true ||
        content.hostId !== 'local')
  )
    throw unsupported();
  const identity = scope.value.conversationId;
  const instance = tab.contentInstance;
  if (!identity || !tab.contentInstance || typeof controller.closeTab !== 'function')
    throw unsupported();
  const account = cloud ? content.sideChat : null;
  const accountModule = runtime.c.SPnB?.exports;
  const currentAccount = () =>
    !cloud ||
    (accountModule &&
      scope.get(accountModule.chatGptAuthenticatedAccountId$) === account.accountId &&
      scope.get(accountModule.o8) === account.userId);
  const current = () =>
    target.panel.isConnected &&
    nativeScope(target.panel)?.value.conversationId === identity &&
    scope.get(controller.tabById$, target.tabId)?.contentInstance === instance &&
    currentAccount();
  const rpc = cloud ? null : manager.V(scope, content.hostId);
  if (
    !cloud &&
    [
      'getConversation',
      'getThreadExecutionState',
      'getConversationTitleInput',
      'setThreadTitle',
      'discardConversationFromCache',
    ].some((name) => typeof rpc?.[name] !== 'function')
  )
    throw unsupported();
  const mainUnchanged = () => {
    const scopes = [
      ...document.querySelectorAll(
        '.ProseMirror[contenteditable="true"],[data-codex-composer][contenteditable="true"],textarea',
      ),
    ]
      .filter(
        (editor) =>
          editor.getBoundingClientRect().width > 0 &&
          !editor.closest('[hidden],[inert],[aria-hidden="true"]') &&
          !editor.closest(
            '[data-app-shell-focus-area="right-panel"],[data-app-shell-focus-area="bottom-panel"],[data-palboo-features-root],[data-companion-stepwise-root],[data-palboo-prompt],[data-palboo-side-chat],section[role="dialog"]',
          ),
      )
      .map(nativeScope)
      .filter(Boolean);
    return scopes.length === 1 && scopes[0].value.conversationId === identity && currentAccount();
  };
  const cloudIds = runtime.c.OOaz?.exports;
  const cloudState = runtime.c.MrGp?.exports;
  const cloudRoutes = runtime.c.jAnS?.exports;
  if (
    cloud &&
    (typeof cloudIds?.co !== 'function' ||
      typeof cloudState?.iF !== 'function' ||
      typeof cloudRoutes?.mv !== 'function')
  )
    throw unsupported();
  let destinationId = cloud ? null : id;
  const readLocal = async () => {
    const conversation = await rpc.getConversation(id);
    try {
      return conversation
        ? {
            id: conversation.id,
            title: conversation.title ?? null,
            ephemeral: conversation.ephemeral,
            side: conversation.sideConversation,
            requests: conversation.requests?.length || 0,
          }
        : null;
    } finally {
      conversation?.[Symbol.dispose]?.();
    }
  };
  return {
    kind: cloud ? 'cloud' : 'local',
    id,
    title: tab.title || '',
    current,
    mainUnchanged,
    parentId: identity,
    async localState() {
      const state = await readLocal();
      const execution = await rpc.getThreadExecutionState(id);
      return state && typeof execution?.inProgress === 'boolean'
        ? { ...state, busy: execution.inProgress || state.requests > 0 }
        : null;
    },
    async firstQuestion() {
      const input = await rpc.getConversationTitleInput(id);
      return (input?.input || [])
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
    },
    cloudHistory() {
      const read = runtime.c.k675?.exports?.I;
      if (typeof read !== 'function' || !current()) throw unsupported();
      // 空选项取消宿主默认的三轮/2000字截断，读取当前分支而非虚拟滚动 DOM。
      const history = read(scope, id, {});
      if (history?.conversationId !== id || !Array.isArray(history.priorConversation?.conversation))
        throw unsupported();
      return history.priorConversation.conversation;
    },
    async rename(title, previousTitle) {
      if (!current()) throw unsupported();
      if (
        !(await rpc.setThreadTitle(id, title, {
          expectedTitle: previousTitle,
          requireAcknowledgement: true,
        }))
      )
        throw Error(tr('聊天标题已变化，请重试。'));
    },
    close() {
      if (!current()) throw unsupported();
      controller.closeTab(scope, target.tabId, { recordCloseUndo: false });
    },
    isClosed: () =>
      scope.get(controller.tabById$, target.tabId) == null && !target.panel.isConnected,
    async reload() {
      // 已确认非临时且空闲；只清该会话内存缓存，重新加载时不携带 sideConversation。
      await rpc.discardConversationFromCache(id);
    },
    navigate() {
      panels.W3(scope, 'right');
      bus.dispatchHostMessage({ type: 'navigate-to-route', path: route(id) });
      const recent = runtime.c.fKdM?.exports?.v;
      if (recent) scope.query.invalidate(recent);
    },
    openCloudMain() {
      if (!currentAccount() || destinationId) throw unsupported();
      destinationId = cloudIds.co();
      cloudState.iF(scope, destinationId, {
        hideFromHistory: false,
        isDoNotRemember: scope.get(cloudState.Ik, id),
      });
      panels.W3(scope, 'right');
      bus.dispatchHostMessage({ type: 'navigate-to-route', path: cloudRoutes.mv(destinationId) });
    },
    matchesDestination(editor) {
      if (!currentAccount()) return false;
      const value = nativeScope(editor)?.value;
      if (
        !value ||
        value.workSideChat ||
        editor.closest('[role="tabpanel"][data-tab-id^="sidechat:"]')
      )
        return false;
      return cloud
        ? value.conversationId === destinationId && value.routeKind === 'chatgpt-thread'
        : value.routeKind === 'local-thread' &&
            value.conversationId === id &&
            value.hostId === content.hostId;
    },
  };
}
