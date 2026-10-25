import { tr } from '../../../shared/i18n.js';
/*
 * [INPUT]: 原生窗口桥接、窗口偏好与新聊天/Dots 侧栏许可、远端命令身份。
 * [OUTPUT]: 强制展开的偏好和窗口尺寸、受限远端操作；浮窗统一工作台最低高度，保留返回形态。
 * [POS]: 窗口通信底层，不读取宿主正文或渲染业务视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { HEIGHT_KEY, IS_POPOUT, POPOUT, WIDTH_KEY } from '../../../shared/constants.js';
import { shellState, storage } from '../../../codex/runtime/state.js';

function panelPreferences() {
  return {
    open: IS_POPOUT || shellState.open,
    activeTab: shellState.activeTab,
    layoutMode: shellState.layoutMode,
    feature: shellState.feature,
    dockWidth: shellState.dockWidth,
    splitRatio: shellState.dockLayout.verticalRatio,
    dockLayout: { ...shellState.dockLayout },
    popoutLayout: { ...shellState.popoutLayout },
    dockOpen: shellState.dockOpen,
    sidebarNewChat: shellState.sidebarNewChat,
    sidebarDots: shellState.sidebarDots,
    width: shellState.width,
    height: shellState.height,
    material: shellState.material,
    liquidVariant: shellState.liquidVariant,
    fontOffset: shellState.fontOffset,
    fontSizes: { ...shellState.fontSizes },
    labelOnly: shellState.labelOnly,
    promptClickMode: shellState.promptClickMode,
    viewOrder: shellState.viewOrder.slice(),
  };
}

async function remotePanelAction(kind, fields = {}) {
  if (!shellState.remoteSource) {
    POPOUT.notice(tr('Codex 尚未连接。'));
    return false;
  }
  const command = {
    kind,
    instanceId: shellState.remoteSource.instanceId,
    viewToken: shellState.remoteSource.viewToken,
    context: shellState.remoteSource.context,
    promptToken: shellState.remoteSource.promptToken,
    outlineToken: shellState.remoteSource.outlineToken,
    ...fields,
  };
  try {
    const result = await POPOUT.request('command', { command });
    if (!result.ok) POPOUT.notice(result.message || tr('操作失败，请重试。'));
    return result.ok === true;
  } catch (error) {
    POPOUT.notice(error.message);
    return false;
  }
}

/** @type {Promise<void> | null} */
let nativeSizeTask = null;
/** @type {[number, number] | null} */
let requestedNativeSize = null;

function sizeNativePanel(expanded) {
  if (!IS_POPOUT) return Promise.resolve();
  shellState.height = Math.max(440, shellState.height);
  requestedNativeSize = [shellState.width + 24, shellState.height + 24];
  if (!nativeSizeTask) {
    shellState.nativeSizeChanging = true;
    nativeSizeTask = (async () => {
      try {
        while (requestedNativeSize) {
          const size = requestedNativeSize;
          requestedNativeSize = null;
          await POPOUT.size(...size);
        }
      } finally {
        shellState.nativeSizeChanging = false;
        nativeSizeTask = null;
      }
    })();
  }
  return nativeSizeTask;
}

function nativePanelDrag(event, source) {
  const x = event.clientX,
    y = event.clientY;
  const move = (next) => {
    if (Math.hypot(next.clientX - x, next.clientY - y) < 5) return;
    cleanup();
    if (source === 'fab') shellState.suppressFabClick = true;
    else shellState.suppressHeadFaceClick = true;
    POPOUT.native({ kind: 'drag' });
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', cleanup);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', cleanup, { once: true });
}

function nativeGestureEnded() {
  if (shellState.popover?.dataset.resizing === 'true') {
    shellState.popover.removeAttribute('data-resizing');
    storage.set(WIDTH_KEY, String(shellState.width));
    storage.set(HEIGHT_KEY, String(shellState.height));
    POPOUT.save(panelPreferences());
  }
  setTimeout(() => {
    shellState.suppressFabClick = false;
    shellState.suppressHeadFaceClick = false;
  }, 300);
}

export {
  nativeGestureEnded,
  nativePanelDrag,
  panelPreferences,
  remotePanelAction,
  sizeNativePanel,
};
