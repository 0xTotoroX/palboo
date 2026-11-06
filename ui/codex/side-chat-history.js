/* [INPUT]: Native local turn pages or cloud rendered turns and an optional stable cutoff key.
 * [OUTPUT]: Complete text messages through the selected answer; rejects missing or ambiguous boundaries.
 * [POS]: Read-only history normalization, independent of virtualized DOM and chat navigation.
 * [PROTOCOL]: Keep ui/codex/AGENTS.md in sync. */
import { tr } from '../shared/i18n.js';

const invalid = () => Error(tr('无法确认所选回答或完整聊天记录，请重新选择。'));
const message = (role, text) => {
  if (typeof text !== 'string') throw invalid();
  return { role, content: [{ content_type: 'text', text }] };
};

export function boundedHistory(messages) {
  const size = messages.reduce(
    (size, entry) => size + entry.content.reduce((sum, part) => sum + part.text.length, 0),
    0,
  );
  if (size > 2_000_000) throw Error(tr('侧边聊天内容过长，未截断或关闭原聊天。'));
  return messages;
}

export async function localSideHistory(rpc, id, check, cutoff = null) {
  const history = [],
    cursors = new Set(),
    turns = new Set();
  let cursor = null,
    found = false,
    size = 0;
  const append = (entry) => {
    size += entry.content[0].text.length;
    if (size > 2_000_000) throw Error(tr('侧边聊天内容过长，未截断或关闭原聊天。'));
    history.push(entry);
  };
  do {
    check();
    const { response } = await rpc.listThreadTurns(id, {
      cursor,
      limit: 100,
      sortDirection: 'asc',
      itemsView: 'full',
      itemLimit: null,
      requestOptions: { timeoutMs: 15000 },
    });
    check();
    if (!Array.isArray(response?.data)) throw invalid();
    for (const turn of response.data) {
      if (!turn.id || turns.has(turn.id) || turn.itemsView !== 'full' || !Array.isArray(turn.items))
        throw invalid();
      turns.add(turn.id);
      // Continue validating page identities after the boundary, without copying later content.
      if (found) continue;
      let answered = false;
      for (const item of turn.items) {
        if (item.type === 'userMessage') {
          if (!Array.isArray(item.content)) throw invalid();
          append(
            message(
              'user',
              item.content
                .filter((part) => part.type === 'text')
                .map((part) => {
                  if (typeof part.text !== 'string') throw invalid();
                  return part.text;
                })
                .join('\n'),
            ),
          );
        } else if (item.type === 'agentMessage') {
          append(message('assistant', item.text));
          answered = true;
        }
      }
      if (cutoff?.turnKey === turn.id) {
        if (!answered || (turn.status && turn.status !== 'completed')) throw invalid();
        found = true;
      }
    }
    cursor = response.nextCursor;
    if (cursor != null) {
      if (typeof cursor !== 'string' || cursors.has(cursor)) throw invalid();
      cursors.add(cursor);
    }
  } while (cursor != null);
  if (cutoff && !found) throw invalid();
  return history;
}

export function cloudSideHistory(entries, userText, cutoff) {
  if (!Array.isArray(entries) || typeof userText !== 'function') throw invalid();
  const keys = new Set();
  for (const entry of entries) {
    if (!entry.id || keys.has(entry.id)) throw invalid();
    keys.add(entry.id);
  }
  const matches = entries.filter((entry) => entry.id === cutoff.turnKey);
  if (matches.length !== 1) throw invalid();
  const history = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.turn?.items)) throw invalid();
    let answered = false;
    for (const item of entry.turn.items) {
      if (item.type === 'user-message') {
        if (!Array.isArray(item.attachments) || !Array.isArray(item.images)) throw invalid();
        history.push(
          message(
            'user',
            userText({
              attachmentCount: item.attachments.length,
              imageCount: item.images.length,
              message: item.message,
            }),
          ),
        );
      } else if (item.type === 'assistant-message') {
        if (!item.completed) throw invalid();
        history.push(message('assistant', item.content));
        answered = true;
      }
    }
    if (entry === matches[0]) {
      if (!answered) throw invalid();
      return boundedHistory(history);
    }
  }
  throw invalid();
}
