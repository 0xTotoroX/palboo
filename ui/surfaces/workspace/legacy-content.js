import { tr } from '../../shared/i18n.js';
/* [INPUT]: Legacy runtime state and shared feature content.
 * [OUTPUT]: Legacy views share feature renderers and revision-checked quick-prompt settings saves.
 * [POS]: Compatibility only; remove after legacy panel leases/configuration are retired.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import {
  outlineHtml as markup,
  alignOutlineNestedText as align,
  attachOutlineEvents as bind,
} from '../../features/outline/view.js';
import { API_KEY } from '../../shared/constants.js';
import { createNextView } from '../../features/next/view.js';
import {
  shellState,
  bridgeCall,
  runtimeState,
  outlineState,
  stepwiseState,
  contextState,
} from '../../codex/runtime/state.js';
import { outlineJumpTo, outlineJumpToAnchor } from '../../codex/outline.js';
import { fillComposer } from '../../codex/next.js';
import { syncSettings } from '../../codex/runtime/settings-sync.js';
import { emitSignal } from '../../codex/runtime/signals.js';
import { syncContentFade } from '../embedded/shell/geometry.js';
const reading = {
  get selected() {
    return shellState.promptPreviewIndex;
  },
  set selected(v) {
    shellState.promptPreviewIndex = v;
  },
};
const next = createNextView({
  read: () => ({
    ...stepwiseState,
    ...contextState,
    settings: runtimeState.settings,
    display: shellState,
    promptToken: JSON.stringify(stepwiseState.prompts),
  }),
  reading,
  saveQuickPrompts: async (quickPrompts, expectedRevision) => {
    const result = await bridgeCall('/settings/set', { quickPrompts, expectedRevision });
    if (result?.error) throw Error(result.error);
    const settings = result?.settings || result;
    if (!Number.isFinite(settings?.configurationRevision))
      throw Error(tr('未收到保存确认，请重试'));
    await syncSettings(settings);
    return settings;
  },
  dragSnapshot: () => shellState.remoteSource || window[API_KEY]?.exportPanelState(),
  command: (kind, data) => {
    const item =
      kind === 'quick-fill'
        ? runtimeState.settings?.quickPrompts?.[data.index]
        : stepwiseState.prompts[data.index];
    if (item?.prompt)
      fillComposer(item.prompt, data.submit, {
        quick: kind === 'quick-fill',
      });
  },
  changed: syncContentFade,
});
export const nextHtml = () => next.html();
export const attachNextEvents = (root = shellState.panel) => next.bind(root);
export const clearPromptInteractionTimers = () => next.clear();
export const outlineHtml = () => markup(outlineState);
export const alignOutlineNestedText = () => align(shellState.panel);
export const attachOutlineEvents = (root = shellState.panel) =>
  bind(root, (kind, data) => {
    const ok = kind === 'outline-jump' ? outlineJumpTo(data.id) : outlineJumpToAnchor(data.anchor);
    if (!ok) {
      outlineState.outlineStatus = 'error';
      outlineState.outlineError = tr('找不到对应的小节，刷新后再试。');
      emitSignal('render', { preserveMorph: true });
    }
  });
