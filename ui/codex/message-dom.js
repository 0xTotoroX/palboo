/* [INPUT]: Explicit Chat role labels and a native action-row reader.
 * [OUTPUT]: Answer-only content containers and uniquely associated sibling reply controls.
 * [POS]: Shared DOM boundary for App Chat and embedded Chat; no runtime, route or composer state.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { CONVERSATION_TURN_SELECTOR as TURN } from '../shared/constants.js';
const ROLE = 'h4[data-conversation-role]';

export function explicitMessageContainer(turn, role) {
  if (!(turn instanceof Element)) return null;
  const labels = [...turn.querySelectorAll(ROLE)].filter(
    (node) => node.getAttribute('data-conversation-role') === role && node.closest(TURN) === turn,
  );
  if (labels.length !== 1) return null;
  const label = labels[0];
  if (role === 'user') return label.parentElement;
  if (role !== 'assistant') return null;
  // Chat can put both speakers inside one group and controls outside the answer.
  // Stop before the shared parent so user headings never become answer entries.
  let node = label.parentElement;
  while (node.parentElement && node.parentElement !== turn) {
    const parent = node.parentElement;
    if (parent.querySelector(`${ROLE}[data-conversation-role="user"]`)) break;
    node = parent;
  }
  return node;
}

export function siblingReplyActionRow(message, nativeActionRow) {
  if (!(message instanceof Element)) return null;
  const turn = message.closest(TURN);
  const rows = [...(turn?.querySelectorAll('.turn-action-controls') || [])]
    .filter(
      (row) =>
        row.closest(TURN) === turn &&
        (message.contains(row) ||
          Boolean(message.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)),
    )
    .map(nativeActionRow)
    .filter(Boolean);
  return rows.length === 1 ? rows[0] : null;
}
