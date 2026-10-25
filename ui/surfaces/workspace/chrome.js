import { tr } from '../../shared/i18n.js';
/* [INPUT]: Presentation kind and the shared eyes/icon templates.
 * [OUTPUT]: Shared header spacing, hidden legacy source text, desktop actions and a separate pin slot.
 * [POS]: Shared shell markup; no business state or placement policy.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { windowControlsHtml } from './window-controls.js';
export function workbenchHeadHtml(desktop = false) {
  const label = desktop ? tr('双击收回 Codex') : tr('单击收起 · 双击弹出到桌面');
  return `<header class="csw-head csw-workbench-head" data-window="${desktop ? 'desktop' : 'embedded'}"><button hidden tabindex="-1" type="button" class="csw-head-face csw-workbench-face" aria-label="${label}"></button>${desktop ? windowControlsHtml() : ''}<span class="csw-workbench-source" hidden></span><div class="csw-workbench-controls"></div></header>`;
}
