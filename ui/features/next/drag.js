/* [INPUT]: 推荐按钮、拖动开始时的投影及计时器取消回调。
 * [OUTPUT]: 原生复制拖放、跟随指针的预览副本与可回收的源反馈。
 * [POS]: 只负责抓取反馈；落点及最终写入由 Codex 重新校验。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { NEXT_DRAG_TYPE, nextDragCommand } from '../../shared/next-drag.js';
export function bindNextDrag(button, read, cancelClick) {
  let preview,
    frame = 0,
    suppressClick = false;
  const clean = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    preview?.remove();
    preview = null;
    button.removeAttribute('data-dragging');
  };
  const start = (event) => {
    const snapshot = read();
    const index = Number(button.dataset.index);
    const data = nextDragCommand(snapshot, index);
    if (button.disabled || !data || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    cancelClick();
    clean();
    suppressClick = true;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'copy';
    // 不传 text/plain：过期或错误落点不能绕过宿主校验自动粘贴。
    event.dataTransfer.setData(NEXT_DRAG_TYPE, JSON.stringify(data));
    const item = snapshot.prompts[index];
    const style = getComputedStyle(button);
    preview = document.createElement('div');
    preview.dataset.buddyNextDrag = 'preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.style.cssText = `position:fixed;left:12px;top:12px;z-index:2147483647;pointer-events:none;box-sizing:border-box;width:280px;max-width:80vw;padding:12px 16px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;box-shadow:0 8px 28px #0003;white-space:normal;overflow-wrap:anywhere;color:${style.color};background:${style.getPropertyValue('--csw-surface-opaque').trim() || 'Canvas'};font:500 14px/1.5 ${style.fontFamily};`;
    const title = document.createElement('div');
    title.textContent = item.label || item.prompt.slice(0, 60);
    const text = document.createElement('div');
    text.textContent = item.prompt.slice(0, 120);
    text.style.cssText =
      'margin-top:4px;font-weight:400;opacity:.72;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden';
    preview.append(title, text);
    document.body.append(preview);
    event.dataTransfer.setDragImage(preview, 24, 20);
    button.dataset.dragging = 'true';
    frame = requestAnimationFrame(() => {
      preview?.remove();
      preview = null;
    });
  };
  const click = (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const resetClick = () => {
    suppressClick = false;
  };
  button.draggable = true;
  button.addEventListener('dragstart', start);
  button.addEventListener('dragend', clean);
  button.addEventListener('click', click, true);
  button.addEventListener('pointerdown', resetClick);
  button.addEventListener('keydown', resetClick);
  return () => {
    clean();
    button.removeEventListener('dragstart', start);
    button.removeEventListener('dragend', clean);
    button.removeEventListener('click', click, true);
    button.removeEventListener('pointerdown', resetClick);
    button.removeEventListener('keydown', resetClick);
    button.draggable = false;
  };
}
