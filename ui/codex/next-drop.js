/* [INPUT]: 原生推荐拖放、当前投影、唯一聊天输入框与受校验 panelCommand。
 * [OUTPUT]: 输入框落点反馈、释放后追加；错误来源或过期推荐不会写入或发送。
 * [POS]: Codex 宿主拖放适配，停用/销毁清理全部监听和临时轮廓。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { NEXT_DRAG_TYPE } from '../shared/next-drag.js';
import {
  composerCandidates,
  mainComposerCandidate,
  bindingSourceReady,
  contextMatches,
} from './context.js';
import { composerRootForContext } from './composer.js';
export function installNextDrop({ read, command }) {
  let ring,
    animation,
    timer = 0;
  const clear = () => {
    clearTimeout(timer);
    animation?.cancel();
    animation = null;
    ring?.remove();
    ring = null;
  };
  const isOurs = (event) => Array.from(event.dataTransfer?.types || []).includes(NEXT_DRAG_TYPE);
  const targetAt = (event) => {
    const snapshot = read();
    if (
      !snapshot?.settings?.enabled ||
      snapshot.scanBusy ||
      !bindingSourceReady() ||
      !contextMatches(snapshot.context)
    )
      return null;
    const root = composerRootForContext(snapshot.context);
    const target = root && mainComposerCandidate(composerCandidates(root), root);
    if (
      !target ||
      target.disabled ||
      target.readOnly ||
      target.getAttribute('aria-disabled') === 'true'
    )
      return null;
    return event
      .composedPath()
      .some((node) => node === target || (node instanceof Node && target.contains(node)))
      ? target
      : null;
  };
  const show = (target) => {
    if (!ring) {
      ring = document.createElement('div');
      ring.dataset.buddyNextDrop = 'ready';
      ring.setAttribute('aria-hidden', 'true');
      ring.style.cssText =
        'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid currentColor;border-radius:10px;opacity:.55;background:transparent';
      document.body.append(ring);
    }
    const rect = target.getBoundingClientRect();
    Object.assign(ring.style, {
      left: `${rect.left - 5}px`,
      top: `${rect.top - 5}px`,
      width: `${rect.width + 10}px`,
      height: `${rect.height + 10}px`,
      color: getComputedStyle(target).color,
    });
  };
  const over = (event) => {
    if (!isOurs(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = targetAt(event);
    event.dataTransfer.dropEffect = target ? 'copy' : 'none';
    if (target) show(target);
    else clear();
  };
  const drop = (event) => {
    if (!isOurs(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = targetAt(event);
    if (!target) {
      clear();
      return;
    }
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData(NEXT_DRAG_TYPE));
    } catch {
      clear();
      return;
    }
    if (data?.kind !== 'fill' || !Number.isInteger(data.index)) {
      clear();
      return;
    }
    // 接收端始终强制只填入，并从当前权威推荐读取正文。
    const result = command({ ...data, submit: false });
    if (!result?.ok) {
      clear();
      return;
    }
    show(target);
    ring.dataset.buddyNextDrop = 'inserted';
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      timer = window.setTimeout(clear, 160);
    } else {
      animation = ring.animate(
        [
          { opacity: 0.65, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(1.035)' },
        ],
        { duration: 240, easing: 'ease-out' },
      );
      animation.onfinish = clear;
    }
  };
  const leave = (event) => {
    if (!event.relatedTarget) clear();
  };
  const end = () => {
    if (ring?.dataset.buddyNextDrop !== 'inserted') clear();
  };
  const key = (event) => {
    if (event.key === 'Escape') clear();
  };
  /** @type {Array<[string, EventListener]>} */
  const listeners = [
    ['dragover', over],
    ['dragenter', over],
    ['drop', drop],
    ['dragleave', leave],
    ['dragend', end],
    ['keydown', key],
  ];
  for (const [name, handler] of listeners) window.addEventListener(name, handler, true);
  window.addEventListener('blur', clear);
  return () => {
    clear();
    for (const [name, handler] of listeners) window.removeEventListener(name, handler, true);
    window.removeEventListener('blur', clear);
  };
}
