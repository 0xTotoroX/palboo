/*
 * [INPUT]: 已确认的输入区与宿主语音/发送按钮。
 * [OUTPUT]: 共用右侧操作挂载位置和原生按钮尺寸，不写宿主样式。
 * [POS]: 提示词优化与侧边聊天转正共用的布局边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
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
