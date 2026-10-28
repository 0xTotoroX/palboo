/* [INPUT]: Confirmed quick-prompt settings.
 * [OUTPUT]: A content identity shared by host commands and immediately saved feature projections.
 * [POS]: Pure identity helper; no generation state or I/O. [PROTOCOL]: Keep shared/AGENTS.md in sync. */
import { hashText } from './text.js';

/** @param {Pick<import('./contracts').Settings, 'quickPrompts' | 'quickPromptsEnabled'> | undefined} settings */
export function quickPromptToken(settings) {
  return hashText(JSON.stringify([settings?.quickPrompts, settings?.quickPromptsEnabled]));
}
