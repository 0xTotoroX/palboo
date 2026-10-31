/* [INPUT]: 跟随主题开关、设置页既有 title 与指针/键盘焦点。
 * [OUTPUT]: 消费宿主变量的悬停提示；支持键盘、Esc、抽屉与切换主题时恢复原生 title。
 * [POS]: 仅替换已有提示的呈现，不添加文案、不改变控件或保存行为。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useId } from 'react';

export function useSettingsTooltip(enabled: boolean) {
  const id = useId();
  useEffect(() => {
    if (!enabled) return;
    const tip = document.createElement('div');
    tip.className = 'settings-host-tooltip';
    tip.id = `settings-tooltip-${id}`;
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('popover', 'manual');
    tip.hidden = true;
    let target: HTMLElement | null = null;
    let title = '';
    let timer = 0;
    let keyboard = false;
    let lastClosed = -Infinity;
    const clear = () => window.clearTimeout(timer);
    const close = () => {
      clear();
      if (target) {
        if (!target.hasAttribute('title')) target.setAttribute('title', title);
        const described = (target.getAttribute('aria-describedby') || '')
          .split(/\s+/)
          .filter((value) => value && value !== tip.id)
          .join(' ');
        if (described) target.setAttribute('aria-describedby', described);
        else target.removeAttribute('aria-describedby');
      }
      if (!tip.hidden) lastClosed = performance.now();
      if (tip.hidePopover && tip.isConnected && tip.matches(':popover-open')) tip.hidePopover();
      tip.hidden = true;
      tip.remove();
      target = null;
      keyboard = false;
    };
    const position = () => {
      if (!target?.isConnected || !target.getClientRects().length) return close();
      const anchor = target.getBoundingClientRect(),
        box = tip.getBoundingClientRect();
      const below = anchor.bottom + box.height + 16 <= window.innerHeight;
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, anchor.x + (anchor.width - box.width) / 2))}px`;
      tip.style.top = `${Math.max(8, below ? anchor.bottom + 8 : anchor.top - box.height - 8)}px`;
    };
    const show = () => {
      if (!target?.isConnected || !target.getClientRects().length) return close();
      (target.closest('dialog') || document.body).append(tip);
      tip.textContent = title;
      tip.hidden = false;
      try {
        tip.showPopover?.();
      } catch {
        tip.removeAttribute('popover');
      }
      target.setAttribute(
        'aria-describedby',
        [target.getAttribute('aria-describedby'), tip.id].filter(Boolean).join(' '),
      );
      position();
    };
    const enter = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === 'touch') return;
      if (event.type === 'pointerover' && keyboard && document.activeElement === target) return;
      const node = event.target;
      if (!(node instanceof Element)) return;
      if (tip.contains(node)) {
        clear();
        return;
      }
      if (target?.contains(node)) {
        if (event.type === 'focusin') keyboard = true;
        if (event.type === 'focusin' && tip.hidden) {
          clear();
          show();
        } else if (!tip.hidden) clear();
        return;
      }
      const next = node.closest<HTMLElement>('.settings-app [title]');
      close();
      const value = next?.getAttribute('title')?.trim();
      if (!next || !value) return;
      target = next;
      title = value;
      keyboard = event.type === 'focusin';
      next.removeAttribute('title');
      if (event.type === 'focusin') show();
      else timer = window.setTimeout(show, performance.now() - lastClosed < 300 ? 0 : 150);
    };
    const leave = (event: Event) => {
      if (!target) return;
      if (event.type === 'pointerout' && keyboard) return;
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Node && (target.contains(next) || tip.contains(next))) return;
      if (event.type === 'focusout') close();
      else {
        clear();
        timer = window.setTimeout(close, 100);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const scroll = () => {
      if (keyboard && !tip.hidden) position();
      else close();
    };
    document.addEventListener('pointerover', enter);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', enter);
    document.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      close();
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', enter);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [enabled, id]);
}
