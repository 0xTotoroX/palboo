/*
 * [INPUT]: 已加载 Rspack 模块、已提交 React 树、标签控制器和 side-chat-attachment 适配。
 * [OUTPUT]: 可按谓词寻找的 nativeScope；父聊天卡片/文字、原位转正、历史分支与云端接力接口。
 * [POS]: ChatGPT 私有接口兼容边界；未知结构拒绝，不修改 App 包或 CodexHost 文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { tr } from '../shared/i18n.js';
import { localSideHistory, cloudSideHistory } from './side-chat-history.js';
import { attachLocalSideChatText } from './side-chat-attachment.js';

const unsupported = () => Error(tr('当前宿主不支持此侧聊操作。'));
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
export function nativeScope(element, accepts = (value) => !!value.value?.routeKind) {
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
        accepts(value)
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
  const mainEditors = () =>
    [
      ...document.querySelectorAll(
        '.ProseMirror[contenteditable="true"],[data-codex-composer][contenteditable="true"],textarea',
      ),
    ].filter(
      (editor) =>
        editor.getBoundingClientRect().width > 0 &&
        !editor.closest(
          '[hidden],[inert],[aria-hidden="true"],[data-app-shell-active-page="false"],[data-app-shell-focus-area="right-panel"],[data-app-shell-focus-area="bottom-panel"],[data-palboo-features-root],[data-companion-stepwise-root],section[role="dialog"]',
        ),
    );
  const mainUnchanged = () => {
    const editors = mainEditors();
    return editors.length === 1 && matchesDestination(editors[0]);
  };
  let independentId = null,
    navigated = false;
  const bus = runtime.c.TL6G?.exports?.O1;
  const route = runtime.c.DBCl?.exports?._RT;
  const cloudState = runtime.c.MrGp?.exports;
  const independentMatches = (editor) => {
    const next = nativeScope(editor);
    return (
      editor?.isConnected &&
      currentAccount() &&
      !next?.value.workSideChat &&
      !editor.closest(
        '[role="tabpanel"][data-tab-id^="sidechat:"],[data-app-shell-active-page="false"]',
      ) &&
      next?.value.conversationId === independentId &&
      next.value.routeKind === parent.routeKind &&
      (cloud || localHost(next) === content.hostId)
    );
  };
  return {
    kind: cloud ? 'cloud' : 'local',
    id,
    title: tab.title || '',
    parentId: parent.conversationId,
    current,
    matchesDestination: (editor) =>
      navigated ? independentMatches(editor) : matchesDestination(editor),
    mainUnchanged,
    async attachText(editor, text, preview, guard) {
      if (cloud) return false;
      const accepts = (value) => value.value?.kind === 'local';
      const composer = nativeScope(editor, accepts);
      return attachLocalSideChatText(runtime, composer, text, preview, () => {
        guard();
        if (
          nativeScope(editor, accepts) !== composer ||
          !(navigated ? independentMatches(editor) : matchesDestination(editor)) ||
          composer?.value.conversationId !== (navigated ? independentId : parentId)
        )
          throw unsupported();
      });
    },
    async localState() {
      const conversation = await rpc.getConversation(id);
      let state;
      try {
        state = conversation
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
      const execution = await rpc.getThreadExecutionState(id);
      return state && typeof execution?.inProgress === 'boolean'
        ? { ...state, busy: execution.inProgress || state.requests > 0 }
        : null;
    },
    async history(check = () => {}, cutoff = null) {
      check();
      if (!current()) throw unsupported();
      if (cloud) {
        if (cutoff) {
          const key = runtime.c.ISgP?.exports?.O;
          if (!key) throw unsupported();
          // 与宿主展示/接力共用的当前分支，保留 turn.id，不以文本或 DOM 顺序猜历史边界。
          let turns = scope.get(key, id);
          if (turns == null) {
            const query = runtime.c.lBzi?.exports?.chatGptConversationQueryById$;
            const convert = runtime.c.zyJC?.exports?.hd;
            const orders = runtime.c.zbjM?.exports?.B;
            const data = query && scope.query.getData(query, id);
            if (!data || typeof convert !== 'function' || !orders) throw unsupported();
            turns = convert(data, { streamingOrders: scope.get(orders, id) });
          }
          return cloudSideHistory(turns, runtime.c.kkdx?.exports?.o, cutoff);
        }
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
      return localSideHistory(
        rpc,
        id,
        () => {
          check();
          if (!current()) throw unsupported();
        },
        cutoff,
      );
    },
    prepareIndependent(cutoff) {
      if (
        !current() ||
        typeof bus?.dispatchHostMessage !== 'function' ||
        !bus.handlers?.has('navigate-to-route') ||
        typeof controller.closeTab !== 'function'
      )
        throw unsupported();
      // Do not close the side tab while another main editor (for example an
      // in-place message edit) would make navigation/draft ownership ambiguous.
      const editors = mainEditors();
      if (editors.length && (editors.length !== 1 || !matchesDestination(editors[0])))
        throw Error(tr('无法确认原主聊天输入框。'));
      if (cloud) {
        if (
          typeof runtime.c.OOaz?.exports?.co !== 'function' ||
          typeof cloudState?.iF !== 'function' ||
          typeof runtime.c.jAnS?.exports?.mv !== 'function'
        )
          throw unsupported();
      } else if (
        typeof route !== 'function' ||
        route('palboo-probe') !== '/local/palboo-probe' ||
        ['setThreadTitle', 'discardConversationFromCache'].some(
          (key) => typeof rpc[key] !== 'function',
        ) ||
        (cutoff && typeof runtime.c.IhcX?.exports?.y !== 'function')
      )
        throw unsupported();
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
    closedParent() {
      panels.W3(scope, 'right');
      if (!mainUnchanged()) throw Error(tr('草稿或聊天已变化，未继续带回。'));
    },
    reload: () => rpc.discardConversationFromCache(id),
    async fork(cutoff, title, expectedHistory, check) {
      if (!current()) throw unsupported();
      const result = await runtime.c.IhcX.exports.y(scope, content.hostId, {
        sourceConversationId: id,
        sourceTitle: title,
        targetTurnId: cutoff.turnKey,
        beforeTargetTurn: false,
        threadSource: 'user',
      });
      // 不回滚源会话；旧服务端的截取也由原生 helper 仅对新分支执行。
      if (
        !result?.conversationId ||
        result.conversationId === id ||
        result.synchronization?.status !== 'complete'
      )
        throw Error(tr('独立聊天未完整准备，原侧聊已保留。'));
      independentId = result.conversationId;
      check();
      const copied = await localSideHistory(rpc, independentId, check);
      if (JSON.stringify(copied) !== JSON.stringify(expectedHistory))
        throw Error(tr('独立聊天的截取范围不一致，未切换，原侧聊已保留。'));
      const conversation = await rpc.getConversation(independentId);
      let previousTitle;
      try {
        if (
          conversation?.id !== independentId ||
          conversation.ephemeral !== false ||
          conversation.sideConversation === true
        )
          throw unsupported();
        previousTitle = conversation.title ?? null;
      } finally {
        conversation?.[Symbol.dispose]?.();
      }
      check();
      if (
        previousTitle !== title &&
        !(await rpc.setThreadTitle(independentId, title, {
          expectedTitle: previousTitle,
          requireAcknowledgement: true,
        }))
      )
        throw Error(tr('聊天标题已变化，请重试。'));
      check();
    },
    navigateIndependent() {
      if (!currentAccount()) throw unsupported();
      panels.W3(scope, 'right');
      if (!mainUnchanged()) throw Error(tr('草稿或聊天已变化，未继续带回。'));
      if (cloud) {
        independentId = runtime.c.OOaz.exports.co();
        cloudState.iF(scope, independentId, {
          hideFromHistory: false,
          isDoNotRemember: scope.get(cloudState.Ik, id),
        });
      } else independentId ||= id;
      navigated = true;
      bus.dispatchHostMessage({
        type: 'navigate-to-route',
        path: cloud ? runtime.c.jAnS.exports.mv(independentId) : route(independentId),
      });
      const recent = runtime.c.fKdM?.exports?.v;
      if (recent) scope.query.invalidate(recent);
    },
    async promoted(editor) {
      if (!independentMatches(editor)) return false;
      if (cloud) return true;
      const conversation = await manager
        .V(nativeScope(editor), content.hostId)
        .getConversation(independentId);
      try {
        return (
          conversation?.id === independentId &&
          conversation.ephemeral === false &&
          conversation.sideConversation !== true
        );
      } finally {
        conversation?.[Symbol.dispose]?.();
      }
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
