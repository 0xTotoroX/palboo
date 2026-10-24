/* [INPUT]: Current dock geometry, saved width and shared separator gestures.
 * [OUTPUT]: Sidebar width bounds; pointer and keyboard resizing stop at the minimum without closing.
 * [POS]: Shared by embedded adapters and settings; does not modify business state.
 * [PROTOCOL]: Keep embedded/AGENTS.md in sync. */
import { bindSeparator } from '../workspace/separator.js';
export const DOCK_MIN_WIDTH = 240;
export const CHAT_PREFERRED_WIDTH = 560;
export function bindDockResize(handle, read, change, save = () => {}) {
  handle.setAttribute('aria-valuemin', String(DOCK_MIN_WIDTH));
  bindSeparator(
    handle,
    'x',
    read,
    (start, dx) => {
      const width = start.width - dx;
      change(Math.max(DOCK_MIN_WIDTH, Math.min(start.maximum, width)), true);
    },
    save,
  );
}
