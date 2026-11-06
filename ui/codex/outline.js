import { tr } from '../shared/i18n.js';
/*
 * [INPUT]: 当前回答 DOM、context 的统一最新轮次身份与上下文、窗口投影和大纲状态。
 * [OUTPUT]: 本地大纲刷新和定位、本地/云端回复操作栏的目录入口，与侧聊控件共存；聊天/回答身份、完整段落或位置不匹配时拒绝导航。
 * [POS]: Codex 大纲协调；outline-parser 解析原文，features/outline 渲染列表。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  CONVERSATION_TURN_SELECTOR,
  FLASH_MS,
  HIGHLIGHT_CLASS,
  IS_POPOUT,
  MARK_ATTR,
  MIN_OUTLINE_ITEMS,
  MIN_OUTLINE_TEXT_LEN,
  OUTLINE_SCROLL_RECHECK_MS,
  OUTLINE_SCROLL_SETTLE_MS,
  OUTLINE_TARGET_TOP_OFFSET,
  PANEL_SAFE_MARGIN,
  STREAM_IDLE_MS,
} from '../shared/constants.js';
import {
  actionRowForMessage,
  assistantMessageId,
  chatBusy,
  chatRoot,
  bindingSourceReady,
  contextMatches,
  contextSnapshot,
  conversationTurn,
  conversationTurnElements,
  findLatestAssistantMessage,
  labeledMessageContainer,
  latestConversationTurn,
} from './context.js';
import {
  clamp,
  contextState,
  hashText,
  isCurrentRuntime,
  outlineEnabled,
  outlineState,
  shellState,
} from './runtime/state.js';
import { outlineCollectItems } from './outline-parser.js';
import { contentSafeBounds } from './appearance.js';
import { emitSignal } from './runtime/signals.js';
import { remotePanelAction } from '../surfaces/desktop/legacy/transport.js';
import { iconSvg } from '../shared/icons/index.js';

const REPLY_ACTION = 'data-palboo-outline-reply';

function selectedOutlineMessage() {
  const key = outlineState.outlineSelectedTurnKey;
  const turns = conversationTurnElements().filter(
    (turn) => turn.getAttribute('data-content-search-turn-key') === key,
  );
  return turns.length === 1 ? conversationTurn(turns[0])?.assistantMessage : null;
}

function clearOutlineReplyControls() {
  document.querySelectorAll(`[${REPLY_ACTION}]`).forEach((button) => button.remove());
}

function syncOutlineReplyStyle(button, row) {
  const reference = row.querySelector(`button:not([${REPLY_ACTION}]):not([data-palboo-side-chat])`);
  const className = reference?.getAttribute('class') || '';
  if (button.className !== className) button.className = className;
  const native = Boolean(className);
  if (button.hasAttribute('data-palboo-outline-native') !== native)
    button.toggleAttribute('data-palboo-outline-native', native);
  const svg = button.querySelector('svg');
  const iconClass = reference?.querySelector('svg')?.getAttribute('class') || '';
  if (svg && svg.getAttribute('class') !== iconClass) svg.setAttribute('class', iconClass);
}

function syncOutlineReplyControls(reveal, newest) {
  const root = chatRoot();
  const turns = conversationTurnElements(root);
  const turnSet = new Set(turns);
  document.querySelectorAll(`[${REPLY_ACTION}]`).forEach((button) => {
    if (!turnSet.has(button.closest(CONVERSATION_TURN_SELECTOR))) button.remove();
  });
  for (const turn of turns) {
    const key = turn.getAttribute('data-content-search-turn-key');
    if (!key) continue;
    const reply = labeledMessageContainer(turn, 'assistant');
    const previous = turn.querySelector(`[${REPLY_ACTION}]`);
    if (!reply || (key === newest && chatBusy())) {
      previous?.remove();
      continue;
    }
    const row = actionRowForMessage(reply);
    if (!row) {
      previous?.remove();
      continue;
    }
    if (previous && reply.contains(previous) && previous.getAttribute(REPLY_ACTION) === key) {
      if (previous.parentElement !== row) row.append(previous);
      syncOutlineReplyStyle(previous, row);
      previous.setAttribute('aria-pressed', String(outlineState.outlineSelectedTurnKey === key));
      continue;
    }
    previous?.remove();
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(REPLY_ACTION, key);
    button.setAttribute('aria-pressed', String(outlineState.outlineSelectedTurnKey === key));
    button.title = tr('查看此回复的大纲');
    button.setAttribute('aria-label', button.title);
    button.innerHTML = iconSvg('feature-outline');
    syncOutlineReplyStyle(button, row);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!outlineEnabled() || !bindingSourceReady() || !chatRoot()?.contains(turn)) return;
      if (conversationTurn(turn)?.assistantMessage?.node !== reply) return;
      const latest = latestConversationTurn();
      if (chatBusy() && latest?.turnKey === key) return;
      resetOutlineFeature();
      outlineState.outlineSelectedTurnKey = latest?.turnKey === key ? '' : key;
      outlineState.outlineHistorical = Boolean(outlineState.outlineSelectedTurnKey);
      void refreshOutline();
      reveal();
      emitSignal('scan', 0);
    });
    row.append(button);
  }
}

function followLatestOutline() {
  if (IS_POPOUT) return remotePanelAction('outline-latest');
  if (!outlineState.outlineSelectedTurnKey || !bindingSourceReady()) return false;
  resetOutlineFeature();
  void refreshOutline();
  emitSignal('scan', 0);
  return true;
}

function syncSelectedOutline() {
  const message = selectedOutlineMessage();
  if (message) {
    if (
      outlineState.outlineMessage !== message.node ||
      outlineState.outlineSourceHash !== hashText(message.text)
    )
      void refreshOutline();
  } else if (outlineState.outlineStatus !== 'unavailable') {
    void refreshOutline();
  }
}

function outlineMarkItems(items, sourceHash) {
  items.forEach((item, index) => {
    const id = `stepwise-outline-${hashText(`${sourceHash}:${index}:${item.kind}:${item.anchorText}`)}-${index + 1}`;
    item.id = id;
    item.el.setAttribute(MARK_ATTR, id);
  });
  return items;
}

function outlineClearMarks(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(`[${MARK_ATTR}]`).forEach((node) => node.removeAttribute(MARK_ATTR));
  root
    .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
    .forEach((node) => node.classList.remove(HIGHLIGHT_CLASS));
}

function outlineFindScrollContainer(fromElement) {
  let node = fromElement instanceof Element ? fromElement.parentElement : null;
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY || style.overflow;
    if (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 4)
      return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function outlineIsDocumentScroller(container) {
  return (
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body
  );
}

function outlineScrollBounds(container) {
  const maxDistance = Math.max(0, container.scrollHeight - container.clientHeight);
  const style = window.getComputedStyle(container);
  const reversed =
    !outlineIsDocumentScroller(container) &&
    (style.flexDirection === 'column-reverse' || container.scrollTop < -1);
  return reversed ? { min: -maxDistance, max: 0 } : { min: 0, max: maxDistance };
}

function outlineScrollViewportTop(container) {
  const safeTop = Math.max(0, contentSafeBounds().top - PANEL_SAFE_MARGIN);
  if (outlineIsDocumentScroller(container)) return safeTop;
  return Math.max(safeTop, container.getBoundingClientRect().top);
}

function outlineScrollScale(container) {
  const layoutHeight = container.clientHeight;
  const visualHeight = container.getBoundingClientRect().height;
  if (!(layoutHeight > 0) || !(visualHeight > 0)) return 1;
  const scale = visualHeight / layoutHeight;
  return Number.isFinite(scale) && scale > 0.01 ? scale : 1;
}

function outlineTargetScrollTop(element, container) {
  const bounds = outlineScrollBounds(container);
  const elementTop = element.getBoundingClientRect().top;
  const targetViewportTop = outlineScrollViewportTop(container) + OUTLINE_TARGET_TOP_OFFSET;
  const delta = elementTop - targetViewportTop;
  const deltaInScrollSpace = delta / outlineScrollScale(container);
  return clamp(container.scrollTop + deltaInScrollSpace, bounds.min, bounds.max);
}

function outlineScheduleScrollSettle(element, container) {
  outlineState.outlineScrollCleanup?.();
  let settleTimer = 0;
  let recheckTimer = 0;
  let finished = false;
  const cleanup = () => {
    if (settleTimer) window.clearTimeout(settleTimer);
    if (recheckTimer) window.clearTimeout(recheckTimer);
    settleTimer = 0;
    recheckTimer = 0;
    container.removeEventListener('scrollend', settle);
    container.removeEventListener('wheel', cancel);
    container.removeEventListener('pointerdown', cancel);
    if (outlineState.outlineScrollCleanup === cancel) outlineState.outlineScrollCleanup = null;
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };
  const correct = () => {
    if (!isCurrentRuntime() || !element.isConnected || !container.isConnected) return false;
    const targetTop = outlineTargetScrollTop(element, container);
    if (Math.abs(container.scrollTop - targetTop) > 1) container.scrollTop = targetTop;
    return true;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };
  const settle = () => {
    if (finished) return;
    container.removeEventListener('scrollend', settle);
    if (settleTimer) window.clearTimeout(settleTimer);
    settleTimer = 0;
    if (!correct()) {
      finish();
      return;
    }
    recheckTimer = window.setTimeout(() => {
      recheckTimer = 0;
      correct();
      finish();
    }, OUTLINE_SCROLL_RECHECK_MS);
  };
  outlineState.outlineScrollCleanup = cancel;
  container.addEventListener('scrollend', settle, { once: true });
  container.addEventListener('wheel', cancel, { once: true, passive: true });
  container.addEventListener('pointerdown', cancel, { once: true, passive: true });
  settleTimer = window.setTimeout(settle, OUTLINE_SCROLL_SETTLE_MS);
}

function outlineScrollToElement(element) {
  const container = outlineFindScrollContainer(element);
  if (!(container instanceof Element)) return false;
  // Use one bounded destination instead of chaining scrollIntoView with a corrective scroll.
  const targetTop = outlineTargetScrollTop(element, container);
  if (!Number.isFinite(targetTop)) return false;
  if (Math.abs(container.scrollTop - targetTop) < 0.5) {
    outlineState.outlineScrollCleanup?.();
    return true;
  }
  outlineScheduleScrollSettle(element, container);
  try {
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  } catch {
    outlineState.outlineScrollCleanup?.();
    container.scrollTop = targetTop;
  }
  return true;
}

function outlineScrollToEnd(fromElement, historical) {
  const container = outlineFindScrollContainer(fromElement);
  if (!(container instanceof Element)) return false;
  outlineState.outlineScrollCleanup?.();
  const bounds = outlineScrollBounds(container);
  const viewportBottom = outlineIsDocumentScroller(container)
    ? window.innerHeight
    : container.getBoundingClientRect().bottom;
  const targetTop = historical
    ? clamp(
        container.scrollTop +
          (fromElement.getBoundingClientRect().bottom - viewportBottom) /
            outlineScrollScale(container),
        bounds.min,
        bounds.max,
      )
    : bounds.max;
  if (Math.abs(container.scrollTop - targetTop) < 0.5) return true;
  try {
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  } catch {
    container.scrollTop = targetTop;
  }
  return true;
}

function outlineResolveElement(id) {
  const item = outlineState.outlineItems.find((entry) => entry.id === id) || null;
  const historical = Boolean(outlineState.outlineSelectedTurnKey);
  if (!item || !contextMatches(outlineState.outlineContext, { answer: !historical })) return null;
  const message = historical ? selectedOutlineMessage() : findLatestAssistantMessage();
  if (
    !message?.node?.isConnected ||
    assistantMessageId(message) !== outlineState.outlineContext.assistantMessageId ||
    hashText(message.text) !== outlineState.outlineSourceHash
  )
    return null;
  // 标签可能截断或重复；重挂载后按原回答中的次序和完整锚点文本核验，不猜匹配。
  const candidate = outlineCollectItems(message.node)[item.anchorIndex];
  if (!candidate || candidate.kind !== item.kind || candidate.anchorText !== item.anchorText)
    return null;
  candidate.el.setAttribute(MARK_ATTR, id);
  item.el = candidate.el;
  return item.el;
}

function outlineFlash(element) {
  if (!(element instanceof Element)) return;
  element.classList.add(HIGHLIGHT_CLASS);
  if (outlineState.flashTimer) window.clearTimeout(outlineState.flashTimer);
  outlineState.flashTimer = window.setTimeout(() => {
    element.classList.remove(HIGHLIGHT_CLASS);
    outlineState.flashTimer = 0;
  }, FLASH_MS);
}

function outlineSetActiveTarget({ id = '', anchor = '' } = {}) {
  shellState.panel
    ?.querySelectorAll('[data-outline-id],[data-outline-anchor]')
    .forEach((button) => {
      const isActive = id
        ? button.dataset.outlineId === id
        : anchor && button.dataset.outlineAnchor === anchor;
      button.dataset.active = isActive ? 'true' : 'false';
      if (isActive) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
}

function outlineJumpTo(id) {
  if (!bindingSourceReady()) return false;
  if (IS_POPOUT) {
    void remotePanelAction('outline-jump', { id }).then((ok) => {
      if (ok) outlineSetActiveTarget({ id });
    });
    return true;
  }
  if (
    contextState.chatBinding.mode === 'locked' &&
    !contextMatches(contextSnapshot(), {
      answer: !outlineState.outlineHistorical,
    })
  )
    return false;
  const element = outlineResolveElement(id);
  if (!(element instanceof Element)) return false;
  if (!outlineScrollToElement(element)) return false;
  outlineSetActiveTarget({ id });
  outlineFlash(element);
  return true;
}

function outlineCurrentMessageElement() {
  if (outlineState.outlineSelectedTurnKey) {
    const selected = selectedOutlineMessage();
    return selected &&
      contextMatches(outlineState.outlineContext, { answer: false }) &&
      hashText(selected.text) === outlineState.outlineSourceHash
      ? selected.node
      : null;
  }
  if (outlineState.outlineMessage?.isConnected) return outlineState.outlineMessage;
  const latest = findLatestAssistantMessage();
  return latest?.node instanceof Element ? latest.node : null;
}

function outlineTurnStartElement(message) {
  const turn =
    message?.closest?.(CONVERSATION_TURN_SELECTOR) ||
    (contextState.latestTurnAnchor?.turnNode?.isConnected
      ? contextState.latestTurnAnchor.turnNode
      : null);
  if (!(turn instanceof Element)) return message;
  return labeledMessageContainer(turn, 'user') || turn;
}

function outlineJumpToAnchor(anchor) {
  if (!bindingSourceReady()) return false;
  if (IS_POPOUT) {
    void remotePanelAction('outline-anchor', { anchor }).then((ok) => {
      if (ok) outlineSetActiveTarget({ anchor });
    });
    return true;
  }
  if (
    contextState.chatBinding.mode === 'locked' &&
    !contextMatches(contextSnapshot(), {
      answer: !outlineState.outlineHistorical,
    })
  )
    return false;
  const message = outlineCurrentMessageElement();
  if (!(message instanceof Element)) return false;
  if (anchor === 'start') {
    const startElement = outlineTurnStartElement(message);
    if (!(startElement instanceof Element)) return false;
    outlineSetActiveTarget({ anchor });
    outlineScrollToElement(startElement);
    outlineFlash(startElement);
    return true;
  }
  if (anchor === 'end') {
    outlineSetActiveTarget({ anchor });
    return outlineScrollToEnd(message, Boolean(outlineState.outlineSelectedTurnKey));
  }
  return false;
}

function outlineBuild(message, sourceHash) {
  if (!message?.node) {
    outlineClearMarks();
    return { items: [], fingerprint: sourceHash || '', message: null };
  }
  const textLength = message.text.length;
  const items = outlineCollectItems(message.node);
  const structuredEnough = items.length >= Math.max(MIN_OUTLINE_ITEMS, 3) && textLength >= 160;
  outlineClearMarks();
  if (
    !items.length ||
    (items[0].kind !== 'semantic' && textLength < MIN_OUTLINE_TEXT_LEN && !structuredEnough)
  ) {
    return { items: [], fingerprint: `${sourceHash}|empty`, message: message.node };
  }
  outlineMarkItems(items, `${assistantMessageId(message)}:${sourceHash}`);
  return {
    items,
    fingerprint: `${sourceHash}|${hashText(items.map((item) => `${item.level}:${item.text}`).join('|'))}`,
    message: message.node,
  };
}

function invalidateOutline(message = null, sourceHash = '') {
  outlineClearMarks();
  outlineState.outlineItems = [];
  outlineState.outlineStatus = chatBusy() ? 'pending' : 'idle';
  outlineState.outlineError = '';
  outlineState.outlineFingerprint = '';
  outlineState.outlineSourceHash = '';
  outlineState.outlineContext = null;
  outlineState.outlineMessage = message?.node || null;
  if (
    (shellState.layoutMode === 'workbench' || shellState.activeTab === 'outline') &&
    shellState.panel
  )
    emitSignal('render', { preserveMorph: true });
}

async function refreshOutline(options = {}) {
  if (!bindingSourceReady()) return false;
  if (IS_POPOUT) return remotePanelAction('outline-refresh');
  if (!isCurrentRuntime() || !outlineEnabled()) return;
  if (outlineState.outlineRefreshPromise) return outlineState.outlineRefreshPromise;
  const requestContext = contextSnapshot();
  const requestEpoch = outlineState.outlineEpoch;
  const historical = Boolean(outlineState.outlineSelectedTurnKey);
  const requestCurrent = () =>
    outlineEnabled() &&
    requestEpoch === outlineState.outlineEpoch &&
    contextMatches(requestContext, { answer: !historical });
  outlineState.outlineStatus = 'pending';
  outlineState.outlineError = '';
  if (shellState.layoutMode === 'workbench' || shellState.activeTab === 'outline')
    emitSignal('render', { preserveMorph: true });

  const task = Promise.resolve()
    .then(() => {
      if (!requestCurrent()) return;
      const message = historical
        ? selectedOutlineMessage()
        : options.message || findLatestAssistantMessage();
      const sourceHash = (historical ? '' : options.assistantHash) || hashText(message?.text || '');
      if (historical && !message) {
        invalidateOutline();
        outlineState.outlineStatus = 'unavailable';
        return;
      }
      if (!historical && chatBusy()) {
        outlineState.outlineError = tr('回答尚未完成，完成后再试');
        outlineState.outlineStatus = 'pending';
        emitSignal('scan', STREAM_IDLE_MS);
        return;
      }
      const result = outlineBuild(message, sourceHash);
      if (!requestCurrent()) return;
      outlineState.outlineItems = result.items;
      outlineState.outlineFingerprint = result.fingerprint;
      outlineState.outlineSourceHash = sourceHash;
      outlineState.outlineContext = {
        ...requestContext,
        assistantMessageId: assistantMessageId(message),
      };
      outlineState.outlineMessage = result.message;
      outlineState.outlineStatus = result.items.length ? 'ready' : 'empty';
      outlineState.outlineError = '';
    })
    .catch((error) => {
      if (!requestCurrent()) return;
      outlineClearMarks();
      outlineState.outlineItems = [];
      outlineState.outlineStatus = 'error';
      outlineState.outlineError = error?.message || tr('大纲暂不可用');
    })
    .finally(() => {
      if (outlineState.outlineRefreshPromise === task) outlineState.outlineRefreshPromise = null;
      if (!requestCurrent()) return;
      if (shellState.layoutMode === 'workbench' || shellState.activeTab === 'outline')
        emitSignal('render', { preserveMorph: true });
    });
  outlineState.outlineRefreshPromise = task;
  return task;
}

function resetOutlineFeature() {
  outlineState.outlineEpoch += 1;
  outlineState.outlineScrollCleanup?.();
  outlineState.outlineScrollCleanup = null;
  outlineClearMarks();
  outlineState.outlineItems = [];
  outlineState.outlineRefreshPromise = null;
  outlineState.outlineMessage = null;
  outlineState.outlineSelectedTurnKey = '';
  outlineState.outlineHistorical = false;
  outlineState.outlineSourceHash = '';
  outlineState.outlineContext = null;
  outlineState.outlineFingerprint = '';
  outlineState.outlineStatus = 'idle';
  outlineState.outlineError = '';
}

export {
  clearOutlineReplyControls,
  followLatestOutline,
  invalidateOutline,
  outlineClearMarks,
  outlineJumpTo,
  outlineJumpToAnchor,
  refreshOutline,
  resetOutlineFeature,
  syncOutlineReplyControls,
  syncSelectedOutline,
};
