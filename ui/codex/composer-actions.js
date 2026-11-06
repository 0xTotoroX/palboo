/*
 * [INPUT]: 已确认的输入区与宿主语音/发送按钮。
 * [OUTPUT]: 共用右侧操作挂载位置、原生按钮尺寸及输入操作互斥锁。
 * [POS]: 提示词优化与侧聊带回共用的布局和写入边界；不写宿主样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
let owner = null;
const listeners = new Set();
const notify = () => {
  for (const listener of listeners) listener();
};
export const composerActionBusy = () => owner !== null;
export function observeComposerAction(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
// 页面内两个功能可能操作来源和父聊天，必须覆盖整个异步读取/写入过程。
// 每次持有独立令牌，取消后的迟到回调不能解开另一项操作的锁。
export function acquireComposerAction() {
  if (owner) return null;
  const token = {};
  owner = token;
  notify();
  return () => {
    if (owner !== token) return;
    owner = null;
    notify();
  };
}

export function mountComposerAction(host, composerRoot) {
  if (!composerRoot) return false;
  const actions = [...composerRoot.querySelectorAll('button[aria-label]')].filter(
    (node) =>
      !node.closest('[data-palboo-prompt],[data-palboo-side-chat]') &&
      node.getBoundingClientRect().width > 0,
  );
  const action =
    actions.find((node) => /^(听写|dictate|dictation)$/i.test(node.getAttribute('aria-label'))) ||
    actions.find((node) =>
      /^(发送|发送消息|停止|停止生成|send|send message|stop|stop generating|语音|voice)$/i.test(
        node.getAttribute('aria-label'),
      ),
    );
  if (!action) return false;
  const agent = composerRoot.querySelector('[data-codexhost-agent-control]');
  let parent, before;
  if (agent) {
    parent = action.parentElement;
    before = parent === agent.parentElement ? action.nextSibling : action;
    // 两个自有控件作为一组，不互相搬动，避免干扰 CodexHost 的相邻节点观察。
    while (before?.matches?.('[data-palboo-prompt],[data-palboo-side-chat]'))
      before = before.nextSibling;
  } else {
    let anchor = action;
    while (
      anchor.parentElement !== composerRoot &&
      anchor.parentElement &&
      getComputedStyle(anchor.parentElement).display === 'contents'
    )
      anchor = anchor.parentElement;
    if (
      anchor === action &&
      action.parentElement !== composerRoot &&
      getComputedStyle(action.parentElement).display === 'flex'
    )
      anchor = action.parentElement;
    parent = anchor.parentElement;
    before = anchor;
  }
  const height = Math.max(28, parseFloat(getComputedStyle(action).height) || 28) + 'px';
  if (host.style.getPropertyValue('--buddy-composer-button-size') !== height)
    host.style.setProperty('--buddy-composer-button-size', height);
  let next = host.nextSibling;
  while (next?.matches?.('[data-palboo-prompt],[data-palboo-side-chat]')) next = next.nextSibling;
  if (host.parentElement !== parent || next !== before) parent.insertBefore(host, before);
  return true;
}
