/* [INPUT]: The confirmed right-side chat and native answer action rows used by Outline.
 * [OUTPUT]: Two per-answer actions with a stable cutoff identity and content-change validation.
 * [POS]: Side-chat UI only; no history reads, routing or global outline selection changes.
 * [PROTOCOL]: Keep ui/codex/AGENTS.md in sync. */
import { labeledMessageContainer, actionRowForMessage } from './context.js';
import { iconSvg } from '../shared/icons/index.js';
import { tr } from '../shared/i18n.js';

const SELECTOR = 'button[data-palboo-side-chat="reply"]';
// Local uses div.contents; cloud renders a plain div. Markdown sub-units may repeat
// the same key, so count only the nearest keyed owner of the labeled answer.
const TURN_SELECTOR = '[data-content-search-turn-key]';
const turnsIn = (target) =>
  [...(target?.panel.querySelectorAll(TURN_SELECTOR) || [])].filter(
    (turn) => labeledMessageContainer(turn, 'assistant')?.closest(TURN_SELECTOR) === turn,
  );
const contentSignature = (reply) => {
  const clone = reply.cloneNode(true);
  clone.querySelectorAll('button,[role="button"],svg').forEach((node) => node.remove());
  return clone.textContent;
};

function capture(target, turn) {
  const turnKey = turn.getAttribute('data-content-search-turn-key');
  const reply = labeledMessageContainer(turn, 'assistant');
  if (!turnKey || !reply) return null;
  const cutoff = { turnKey, turn, reply, signature: contentSignature(reply) };
  return validSideReply(target, cutoff) ? cutoff : null;
}

export function validSideReply(target, cutoff) {
  return (
    target?.panel.contains(cutoff.turn) &&
    turnsIn(target).filter(
      (turn) => turn.getAttribute('data-content-search-turn-key') === cutoff.turnKey,
    ).length === 1 &&
    labeledMessageContainer(cutoff.turn, 'assistant') === cutoff.reply &&
    contentSignature(cutoff.reply) === cutoff.signature
  );
}

export function createSideReplyActions(run) {
  const actions = [
    ['parent', 'side-chat-handoff', '带回原主聊天（截至此处）'],
    ['independent', 'side-chat-independent', '创建独立聊天（截至此处）'],
  ];
  return {
    clear() {
      document.querySelectorAll(SELECTOR).forEach((button) => button.remove());
    },
    refresh(target, disabled) {
      document.querySelectorAll(SELECTOR).forEach((button) => {
        if (!target?.panel.contains(button)) button.remove();
      });
      if (!target) return;
      const turns = turnsIn(target);
      const counts = new Map();
      for (const turn of turns) {
        const key = turn.getAttribute('data-content-search-turn-key');
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const turn of turns) {
        const reply = labeledMessageContainer(turn, 'assistant');
        const row = reply && actionRowForMessage(reply);
        const key = turn.getAttribute('data-content-search-turn-key');
        if (!row || !key || counts.get(key) !== 1) {
          turn.querySelectorAll(SELECTOR).forEach((button) => button.remove());
          continue;
        }
        const reference = row.querySelector(
          'button:not([data-palboo-side-chat]):not([data-palboo-outline-reply])',
        );
        for (const [mode, icon, label] of actions) {
          let button = turn.querySelector(`${SELECTOR}[data-side-action="${mode}"]`);
          if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.dataset.palbooSideChat = 'reply';
            button.dataset.sideAction = mode;
            button.innerHTML = iconSvg(icon);
            button.style.cssText =
              'min-width:28px;min-height:28px;display:inline-flex;align-items:center;justify-content:center';
            button.querySelector('svg').style.cssText = 'width:18px;height:18px;flex:none';
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              const cutoff = capture(target, turn);
              if (cutoff && !button.disabled) void run(mode, cutoff);
            });
          }
          if (button.parentElement !== row) row.append(button);
          const className = reference?.className || '';
          if (button.className !== className) button.className = className;
          const title = tr(label);
          if (button.title !== title) button.title = title;
          if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
          if (button.disabled !== disabled) button.disabled = disabled;
        }
      }
    },
  };
}
