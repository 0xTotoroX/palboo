/* [INPUT]: Pointer and keyboard events in the current document.
 * [OUTPUT]: Shared input modality for interruptible motion, retained while a consumer is mounted.
 * [POS]: Used by settings, feature previews and standalone task boards.
 * [PROTOCOL]: Keep shared/AGENTS.md in sync. */
import { useLayoutEffect } from 'react';

let modalityConsumers = 0;
const onGlobalPointerDown = () => {
  document.documentElement.dataset.settingsInput = 'pointer';
};
const onGlobalKeyDown = () => {
  document.documentElement.dataset.settingsInput = 'keyboard';
};

// Track pointer vs keyboard modality wherever shared motion primitives mount
// (settings, website or standalone surfaces) without duplicating window listeners.
export function useInputModality() {
  useLayoutEffect(() => {
    if (++modalityConsumers === 1) {
      window.addEventListener('pointerdown', onGlobalPointerDown, true);
      window.addEventListener('keydown', onGlobalKeyDown, true);
    }
    return () => {
      if (--modalityConsumers === 0) {
        window.removeEventListener('pointerdown', onGlobalPointerDown, true);
        window.removeEventListener('keydown', onGlobalKeyDown, true);
        delete document.documentElement.dataset.settingsInput;
      }
    };
  }, []);
}
