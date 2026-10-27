import { tr } from '../../shared/i18n.js';
/*
 * [INPUT]: 已识别的 Codex 主内容、标签页、前景聊天及 Dots 官方输入区布局、期望侧栏宽度、开合状态和默认关闭的新聊天/Dots 独立许可。
 * [OUTPUT]: CSS 像素宽度上限、独立调节的聊天/侧栏边界、可撤销占位和屏幕几何；缩窄优先保留最小侧栏，手动收起占位归零。
 * [POS]: 宿主布局适配；不移动聊天节点，不读取正文，不包含功能视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { foregroundSurface, contentKind as dockContentKind } from '../../codex/page-context.js';
import { DOCK_MIN_WIDTH, CHAT_PREFERRED_WIDTH } from './width.js';
import { elementScale } from '../workspace/separator.js';
const SLOT = 'data-palboo-dock';
const OWN_UI = `[${SLOT}],[data-companion-stepwise-root],[data-palboo-features-root]`;
const visible = (node) =>
  node &&
  node.getBoundingClientRect().width > 0 &&
  node.getBoundingClientRect().height > 0 &&
  getComputedStyle(node).visibility === 'visible';

export function findDockHost() {
  const surface = foregroundSurface();
  if (surface) return surface.row ? surface : null;
  const frames = document.querySelectorAll(
    '.app-shell-main-content-frame,[class*="_MainContentFrame_"],[data-app-shell-tabs]',
  );
  for (const frame of frames) {
    if (!visible(frame)) continue;
    for (const row of frame.children) {
      const style = getComputedStyle(row);
      if (style.display !== 'flex' || style.flexDirection !== 'row') continue;
      const content = [...row.children].find(
        (child) => !child.matches(OWN_UI) && visible(child) && dockContentKind(child),
      );
      if (content && getComputedStyle(content).flexGrow !== '0')
        return { row, content, kind: dockContentKind(content) };
    }
  }
  return null;
}

export function dockWidthLimit() {
  const host = findDockHost();
  if (!host) return DOCK_MIN_WIDTH;
  const slot = host.row.querySelector(`[${SLOT}]`);
  const available = Math.min(
    host.row.getBoundingClientRect().width,
    host.content.getBoundingClientRect().width + (slot?.getBoundingClientRect().width || 0),
  );
  return Math.max(DOCK_MIN_WIDTH, available / elementScale(host.row).x - CHAT_PREFERRED_WIDTH);
}

export function createDock(onChange, beforeMove = () => {}) {
  let host = null,
    slot = null,
    frame = 0,
    fingerprint = '';
  let options = { width: 340, open: true, detached: false };
  let destroyed = false;
  let observer = null;
  let attachedRoot = null;
  let dockExpanded = false;
  let allocatedWidth = null;
  let preferredWidth = null;
  let chatReserve = CHAT_PREFERRED_WIDTH;
  let hostResize = null;
  const schedule = () => {
    if (!destroyed && !frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
  };
  const mutations = new MutationObserver((records) => {
    const external = records.filter(
      (record) =>
        !(record.target instanceof Element && record.target.closest(OWN_UI)) &&
        (record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) => !(node instanceof Element && node.matches(OWN_UI)),
          )),
    );
    if (
      external.length &&
      (!slot?.isConnected ||
        foregroundSurface()?.dialog !== host?.dialog ||
        external.some(
          (record) =>
            (record.type === 'childList' && record.target === host?.row) ||
            (record.type === 'attributes' &&
              record.target instanceof Element &&
              (record.target.matches('[role="dialog"],dialog') ||
                record.target.contains(host?.row))) ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(
                  '[role="dialog"],dialog,[class*="MainContent"],.app-shell-main-content-frame,[data-app-shell-tabs]',
                ) ||
                  node.querySelector('[role="dialog"],dialog') ||
                  node.contains(host?.row)),
            ),
        ))
    )
      schedule();
  });
  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'aria-hidden', 'aria-modal', 'style', 'class'],
  });
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('pointerdown', schedule);
  document.addEventListener('pointerdown', startHostResize, true);
  window.addEventListener('pointermove', moveHostResize, true);
  window.addEventListener('pointerup', endHostResize, true);
  window.addEventListener('pointercancel', endHostResize, true);
  window.addEventListener('lostpointercapture', endHostResize, true);
  function startHostResize(event) {
    if (event.button !== 0 || !dockExpanded || !slot) return;
    const separator = event.target instanceof Element && event.target.closest('[role="separator"]');
    if (!separator || separator.closest(OWN_UI)) return;
    const bounds = separator.getBoundingClientRect();
    const rect = slot.getBoundingClientRect();
    // Only the host divider bordering this chat; never intercept its gesture.
    if (
      bounds.height <= bounds.width ||
      Math.abs((bounds.left + bounds.right) / 2 - rect.right) > 24
    )
      return;
    hostResize = { pointerId: event.pointerId, left: rect.left };
    chatReserve = Math.min(
      CHAT_PREFERRED_WIDTH,
      host.content.getBoundingClientRect().width / elementScale(host.row).x,
    );
  }
  function moveHostResize(event) {
    if (hostResize?.pointerId === event.pointerId) schedule();
  }
  function endHostResize(event) {
    if (!hostResize || (event.pointerId !== undefined && event.pointerId !== hostResize.pointerId))
      return;
    update();
    hostResize = null;
  }
  function unavailable(suspended) {
    removeSlot();
    publish({ status: suspended ? 'suspended' : 'unsupported', rect: null });
  }
  function removeSlot() {
    if (slot) beforeMove();
    observer?.disconnect();
    observer = null;
    if (attachedRoot) {
      if (attachedRoot.parentElement !== document.body) document.body.append(attachedRoot);
      delete attachedRoot.dataset.dockMounted;
    }
    host?.row.removeAttribute('data-palboo-chat-row');
    host?.content.removeAttribute('data-palboo-chat-content');
    slot?.remove();
    slot = null;
    host = null;
    allocatedWidth = null;
    preferredWidth = null;
    chatReserve = CHAT_PREFERRED_WIDTH;
    hostResize = null;
  }
  function update(next = options) {
    if (destroyed) return;
    options = next;
    const found = findDockHost();
    if (!found) {
      unavailable(!!foregroundSurface());
      return;
    }
    if (
      (found.kind === 'new-chat' && next.sidebarNewChat !== true) ||
      (found.kind === 'dots' && next.sidebarDots !== true)
    ) {
      unavailable(false);
      return;
    }
    if (host?.row !== found.row || host?.content !== found.content || !slot?.isConnected) {
      removeSlot();
      host = found;
      if (host.dialog) {
        host.row.setAttribute('data-palboo-chat-row', 'true');
        host.content.setAttribute('data-palboo-chat-content', 'true');
      }
      slot = document.createElement('aside');
      slot.setAttribute(SLOT, 'true');
      slot.setAttribute('aria-label', tr('Palboo 工作台入口'));
      slot.style.cssText =
        'order:1;flex:0 0 auto;min-width:0;position:relative;align-self:stretch;overflow:visible;padding:0;border:0;margin:0;box-sizing:border-box;';
      host.row.append(slot);
      observer = new ResizeObserver(schedule);
      observer.observe(host.row);
      observer.observe(host.content);
      if (host.dialog) observer.observe(host.dialog);
    }
    const bounds = host.row.getBoundingClientRect();
    const scale = elementScale(host.row).x;
    // 只计算聊天与自有占位可分配的宽度，不把文件/浏览器侧栏算进来。
    const availableWidth =
      Math.min(
        bounds.width,
        host.content.getBoundingClientRect().width + slot.getBoundingClientRect().width,
      ) / scale;
    if (allocatedWidth === null || preferredWidth !== options.width) {
      allocatedWidth = options.width;
      preferredWidth = options.width;
      chatReserve = CHAT_PREFERRED_WIDTH;
    }
    if (hostResize && options.open)
      allocatedWidth = Math.max(
        DOCK_MIN_WIDTH,
        (slot.getBoundingClientRect().right - hostResize.left) / scale,
      );
    const requestedWidth = Math.min(
      allocatedWidth,
      Math.max(DOCK_MIN_WIDTH, availableWidth - chatReserve),
    );
    const enough =
      availableWidth >= requestedWidth && bounds.bottom - Math.max(bounds.top, 48) >= 426;
    // 空间变化只是暂时让位；聊天切换不能覆盖用户的开合意愿。
    const returnExpanded = options.open && enough;
    const expanded = !options.detached && returnExpanded;
    if (dockExpanded && !expanded) beforeMove();
    dockExpanded = expanded;
    slot.dataset.expanded = String(expanded);
    placeRoot();
    const width = expanded ? requestedWidth : 0;
    if (slot.style.width !== `${width}px`) slot.style.width = `${width}px`;
    slot.dataset.reason = enough ? '' : 'space';
    const rect = slot.getBoundingClientRect();
    const scaleY = slot.offsetHeight > 0 ? rect.height / slot.offsetHeight : 1;
    slot.style.setProperty('--csw-dock-inset', `${Math.max(0, 48 - rect.top) / scaleY}px`);
    // 确认宿主真的让出了空间；失败时撤销，不用浮层冒充停靠。
    if (
      host.content.getBoundingClientRect().right > rect.left + 1 ||
      rect.right > bounds.right + 1
    ) {
      unavailable(!!host.dialog);
      return;
    }
    publish({
      status: expanded ? 'open' : options.detached ? 'detached' : enough ? 'closed' : 'space',
      transient: !!host.dialog,
      rect: {
        left: rect.left,
        top: Math.max(rect.top, 48),
        width: rect.width,
        scale,
        height: rect.bottom - Math.max(rect.top, 48),
        right: rect.right,
        bottom: rect.bottom,
        anchor: {
          left: returnExpanded ? rect.right - requestedWidth * scale : rect.right,
          top: Math.max(rect.top, 48),
          right: rect.right,
          bottom: returnExpanded ? rect.bottom : Math.max(rect.top, 48),
          width: returnExpanded ? requestedWidth * scale : 0,
          height: returnExpanded ? rect.bottom - Math.max(rect.top, 48) : 0,
        },
      },
    });
  }
  function publish(value) {
    const key = JSON.stringify(value);
    if (key === fingerprint) return;
    fingerprint = key;
    onChange(value);
  }
  function placeRoot() {
    if (!attachedRoot) return;
    const parent = dockExpanded && slot ? slot : document.body;
    if (attachedRoot.parentElement !== parent) {
      attachedRoot.dataset.dockMoved = 'true';
      parent.append(attachedRoot);
    }
    if (dockExpanded && slot) attachedRoot.dataset.dockMounted = 'true';
    else delete attachedRoot.dataset.dockMounted;
  }
  return {
    update,
    resize(width) {
      allocatedWidth = width;
      preferredWidth = width;
      chatReserve = CHAT_PREFERRED_WIDTH;
    },
    attachRoot(root) {
      if (destroyed) return;
      attachedRoot = root;
      placeRoot();
    },
    reopen() {
      update({ ...options, open: true });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      mutations.disconnect();
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('pointerdown', schedule);
      document.removeEventListener('pointerdown', startHostResize, true);
      window.removeEventListener('pointermove', moveHostResize, true);
      window.removeEventListener('pointerup', endHostResize, true);
      window.removeEventListener('pointercancel', endHostResize, true);
      window.removeEventListener('lostpointercapture', endHostResize, true);
      cancelAnimationFrame(frame);
      removeSlot();
      attachedRoot = null;
    },
  };
}
