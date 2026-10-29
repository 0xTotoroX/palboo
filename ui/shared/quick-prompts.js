/* [INPUT]: Confirmed quick-prompt settings.
 * [OUTPUT]: A content identity and an optional-name fallback for quick phrases; display preferences do not change action identity.
 * [POS]: Pure identity helper; no generation state or I/O. [PROTOCOL]: Keep shared/AGENTS.md in sync. */
import { hashText } from './text.js';

/** @param {Pick<import('./contracts').Settings, 'quickPrompts' | 'quickPromptsEnabled'> | undefined} settings */
export function quickPromptToken(settings) {
  return hashText(JSON.stringify([settings?.quickPrompts, settings?.quickPromptsEnabled]));
}

/** @param {{label?: string, prompt: string}} item */
export function quickPromptName(item) {
  if (item.label?.trim()) return item.label.trim();
  const firstLine = Array.from(item.prompt.trim().split(/\r?\n/)[0]);
  return firstLine.slice(0, 20).join('') + (firstLine.length > 20 ? '…' : '');
}
