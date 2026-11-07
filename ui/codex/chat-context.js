/* [INPUT]: Ordinary Chat webview DOM, stable conversation route and shared latest-turn cache.
 * [OUTPUT]: Read-only Chat outline context; roles may be nested inside content units, unlike Work.
 * [POS]: Chat-only adapter. No composer, model or host bridge operations.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import {
  actionRowForMessage as nativeActionRow,
  assistantMessageFromTurnAnchor,
  labeledMessageText,
  nextLatestTurnAnchor,
} from './context.js';

const TURN = '[data-content-search-turn-key]';
const ROLE = 'h4[data-conversation-role]';

export function chatConversationId() {
  return location.pathname.match(/(?:^|\/)c\/([^/]+)\/?$/)?.[1] || '';
}

function chatRoot() {
  const roots = [...document.querySelectorAll('.thread-scroll-container')].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
  });
  return roots.length === 1 ? roots[0] : null;
}

function messageContainer(turn, role) {
  if (!(turn instanceof Element)) return null;
  const labels = [...turn.querySelectorAll(ROLE)].filter(
    (node) => node.getAttribute('data-conversation-role') === role && node.closest(TURN) === turn,
  );
  if (labels.length !== 1) return null;
  const label = labels[0];
  if (role === 'user') return label.parentElement;
  // User and assistant can share the outer group in Chat. Keep the answer-only
  // subtree; its controls may be outside that subtree, following the shared group.
  let node = label.parentElement;
  while (node.parentElement && node.parentElement !== turn) {
    const parent = node.parentElement;
    if (parent.querySelector(`${ROLE}[data-conversation-role="user"]`)) break;
    node = parent;
  }
  return node;
}

function actionRowForMessage(message) {
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

function turnElements(root = chatRoot()) {
  const turns = [...(root?.querySelectorAll(TURN) || [])].filter((node) =>
    [...node.querySelectorAll(ROLE)].some((label) => label.closest(TURN) === node),
  );
  const keys = turns.map((turn) => turn.getAttribute('data-content-search-turn-key'));
  return turns.filter(
    (_, index) => keys[index] && keys.indexOf(keys[index]) === keys.lastIndexOf(keys[index]),
  );
}

function conversationTurn(node) {
  const turnKey = node.getAttribute('data-content-search-turn-key');
  const assistant = messageContainer(node, 'assistant');
  const text = labeledMessageText(assistant);
  return {
    node,
    turnKey,
    userText: labeledMessageText(messageContainer(node, 'user')),
    assistantMounted: Boolean(assistant),
    assistantMessage:
      text.length > 8 ? { node: assistant, role: 'assistant', text, turnKey } : null,
  };
}

export function createChatContext(isActive) {
  const contextState = { latestTurnAnchor: null, chatBinding: { mode: 'follow' } };
  let sessionId = '';
  let generation = 0;
  const latestConversationTurn = () => {
    if (sessionId !== chatConversationId()) {
      sessionId = chatConversationId();
      generation += 1;
      contextState.latestTurnAnchor = null;
    }
    contextState.latestTurnAnchor = nextLatestTurnAnchor(
      contextState.latestTurnAnchor,
      turnElements().map(conversationTurn),
      sessionId,
      chatRoot(),
    );
    return contextState.latestTurnAnchor;
  };
  const findLatestAssistantMessage = () => assistantMessageFromTurnAnchor(latestConversationTurn());
  const assistantMessageId = (message) => (message?.turnKey ? `turn:${message.turnKey}` : '');
  const contextSnapshot = () => {
    const latest = latestConversationTurn();
    return {
      runtimeGeneration: 1,
      generation,
      paneKey: 'chat',
      sessionId,
      assistantMessageId: latest?.turnKey ? `turn:${latest.turnKey}` : '',
    };
  };
  const bindingSourceReady = () => Boolean(isActive() && chatConversationId() && chatRoot());
  return {
    contextState,
    chatRoot,
    bindingSourceReady,
    latestConversationTurn,
    findLatestAssistantMessage,
    assistantMessageId,
    contextSnapshot,
    contextMatches: (snapshot, { answer = true } = {}) => {
      const current = contextSnapshot();
      return Boolean(
        bindingSourceReady() &&
        snapshot &&
        snapshot.sessionId === current.sessionId &&
        snapshot.generation === current.generation &&
        (!answer || snapshot.assistantMessageId === current.assistantMessageId),
      );
    },
    conversationTurn,
    conversationTurnElements: turnElements,
    labeledMessageContainer: messageContainer,
    actionRowForMessage,
    chatBusy: () =>
      [...document.querySelectorAll('button')].some(
        (button) =>
          /^(停止(?:生成|回答|响应|流式传输)?|Stop(?: generating| generation| response| streaming)?)$/i.test(
            button.getAttribute('aria-label') || '',
          ) && button.getBoundingClientRect().width > 0,
      ),
    CONVERSATION_TURN_SELECTOR: TURN,
  };
}
