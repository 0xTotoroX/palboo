import { tr } from '../../shared/i18n.js';
/* [INPUT]: Feature metadata, task transport, existing shell placement commands.
 * [OUTPUT]: Pilot feature selector and container-independent board mount.
 * [POS]: Presentation composition; no task mutations or chat parsing.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { revealFeature } from '../embedded/features.js';
import { mountBoard } from './mount';
import { IS_POPOUT, POPOUT } from '../../shared/constants.js';
import { shellState, runtimeState, bridgeCall } from '../../codex/runtime/state.js';
import { emitSignal } from '../../codex/runtime/signals.js';
import { setWorkbench, saveWorkbench } from '../embedded/legacy.js';
export const featureViews = [
  {
    id: 'workbench',
    get title() {
      return tr('工作台');
    },
    context: 'chat',
  },
  {
    id: 'outline',
    get title() {
      return tr('大纲');
    },
    context: 'chat',
  },
  {
    id: 'board',
    get title() {
      return tr('看板');
    },
    context: 'tasks',
  },
];
/** @type {import("../../features/board/api").TaskRequest} */
const taskRequest = async (path, body) => {
  const result = IS_POPOUT
    ? await POPOUT.taskRequest(path, body)
    : await bridgeCall(`/${path}`, body);
  if (result.error) throw new Error(result.error);
  return result;
};
export function installFeatureControls(root) {
  const toolbar = document.createElement('div');
  toolbar.className = 'csw-feature-controls';
  toolbar.innerHTML = `<label>${tr('功能 ')}<select data-feature-picker aria-label="${tr('显示功能')}">${featureViews.map((f) => `<option value="${f.id}">${f.title}</option>`).join('')}</select></label><label>${tr('显示于 ')}<select data-placement-picker aria-label="${tr('功能显示位置')}"><option value="sidebar">${tr('侧栏')}</option><option value="overlay">${tr('页面浮层')}</option><option value="desktop">${tr('桌面窗口')}</option></select></label>`;
  root.querySelector('.csw-workbench-head').after(toolbar);
  if (!IS_POPOUT) {
    const launch = document.createElement('select');
    launch.setAttribute('aria-label', tr('独立打开功能'));
    launch.innerHTML = `<option value="">${tr('独立打开…')}</option><option value="outline">${tr('大纲')}</option><option value="board">${tr('看板')}</option><option value="next">${tr('下一步')}</option><option value="model">${tr('模型切换')}</option>`;
    launch.onchange = () => {
      const id = launch.value;
      launch.value = '';
      if (id) void revealFeature(id).catch((e) => alert(String(e)));
    };
    toolbar.append(launch);
  }
  /** @type {HTMLSelectElement} */ (toolbar.querySelector('[data-feature-picker]')).onchange = (
    event,
  ) => {
    const value = /** @type {HTMLSelectElement} */ (event.target).value;
    shellState.feature = value === 'outline' || value === 'board' ? value : 'workbench';
    emitSignal('render', undefined);
    saveWorkbench();
  };
  /** @type {HTMLSelectElement} */ (toolbar.querySelector('[data-placement-picker]')).onchange = (
    event,
  ) => {
    const value = /** @type {HTMLSelectElement} */ (event.target).value;
    if (IS_POPOUT) {
      if (value !== 'desktop') {
        shellState.layoutMode = value === 'sidebar' ? 'workbench' : 'capsule';
        shellState.dockOpen = true;
        emitSignal('windowToggle', { expand: true });
      }
    } else if (value === 'desktop') emitSignal('windowToggle', undefined);
    else setWorkbench(value === 'sidebar', { expanded: true });
    if (root.isConnected) updateFeatureControls(root);
  };
}
export function updateFeatureControls(root) {
  root.dataset.feature = shellState.feature;
  root.querySelector('[data-feature-picker]').value = shellState.feature;
  const placement = root.querySelector('[data-placement-picker]');
  placement.value = IS_POPOUT
    ? 'desktop'
    : shellState.layoutMode === 'workbench'
      ? 'sidebar'
      : 'overlay';
  placement.querySelector('[value="desktop"]').disabled =
    !IS_POPOUT && runtimeState.settings?.popoutSupported !== true;
  const show = shellState.feature === 'board';
  let mount = root.querySelector('.csw-board-mount');
  if (show && !mount) {
    mount = document.createElement('div');
    mount.className = 'csw-board-mount';
    root.append(mount);
    const dispose = mountBoard(mount, taskRequest, shellState.taskView);
    shellState.featureCleanup = () => {
      dispose();
      shellState.featureCleanup = null;
    };
  }
  if (mount) {
    mount.hidden = !show;
    mount.inert = !show;
  }
  root.querySelector('.csw-workbench-panes').hidden = show || shellState.workbenchSettings;
}
