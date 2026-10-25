import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Ordered IDs and the owning settings module's save callback.
 * [OUTPUT]: Shared row drag/keyboard ordering with insertion feedback and cancellation.
 * [POS]: Settings presentation only; callers retain their revision checks and persistence.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

const dragType = 'application/x-palboo-settings-order';

// Keep remembered items outside the visible group in their original positions.
export function replaceVisibleOrder(order: string[], next: string[]) {
  const visible = new Set(next);
  let index = 0;
  return order.map((id) => (visible.has(id) ? next[index++] : id));
}

export function SettingsSortableList({
  ids,
  onReorder,
  disabled = false,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
  children: (props: ReturnType<typeof useRows>) => ReactNode;
}) {
  useLocale();
  const rows = useRows(ids, onReorder, disabled);
  return <>{children(rows)}</>;
}

function useRows(ids: string[], onReorder: (ids: string[]) => void, disabled: boolean) {
  const owner = useId();
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; after: boolean } | null>(null);
  const blocked = useRef(false);
  const focused = useRef<string | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  useLayoutEffect(() => {
    if (focused.current) nodes.current.get(focused.current)?.focus({ preventScroll: true });
    focused.current = null;
  }, [ids.join('\0')]);
  function finish() {
    setDragging(null);
    setTarget(null);
  }
  function reorder(id: string, next: string[]) {
    if (next.every((value, index) => value === ids[index])) return;
    focused.current = id;
    onReorder(next);
  }
  function accepts(event: DragEvent<HTMLDivElement>) {
    if (
      disabled ||
      !dragging ||
      !ids.includes(dragging) ||
      !event.dataTransfer.types.includes(dragType)
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    return true;
  }
  function after(event: DragEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY >= rect.top + rect.height / 2;
  }
  return (id: string) => ({
    ref: (node: HTMLDivElement | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    },
    role: 'group',
    tabIndex: 0,
    'data-settings-sort-item': id,
    'data-settings-sort-owner': owner,
    'data-settings-navigation': true,
    'aria-keyshortcuts': disabled ? undefined : 'Alt+ArrowUp Alt+ArrowDown',
    'aria-description': disabled ? undefined : tr('拖动排序，或按 Alt+上下方向键调整'),
    draggable: !disabled && ids.length > 1,
    'data-dragging': dragging === id,
    'data-drop-edge': target?.id === id ? (target.after ? 'after' : 'before') : undefined,
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      blocked.current = !!(event.target as Element).closest('button,input,select,textarea,a');
    },
    onDragStart: (event: DragEvent<HTMLDivElement>) => {
      if (disabled || blocked.current) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.dataTransfer.setData(dragType, owner);
      event.dataTransfer.effectAllowed = 'move';
      setDragging(id);
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!accepts(event)) return;
      if (id === dragging) {
        setTarget(null);
        return;
      }
      const edge = after(event);
      setTarget((current) =>
        current?.id === id && current.after === edge ? current : { id, after: edge },
      );
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !event.currentTarget.contains(event.relatedTarget)
      )
        setTarget(null);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (accepts(event) && dragging && dragging !== id) {
        const next = ids.filter((item) => item !== dragging);
        next.splice(next.indexOf(id) + (after(event) ? 1 : 0), 0, dragging);
        reorder(dragging, next);
      }
      finish();
    },
    onDragEnd: finish,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        disabled ||
        event.target !== event.currentTarget ||
        !event.altKey ||
        !['ArrowUp', 'ArrowDown'].includes(event.key)
      )
        return;
      event.preventDefault();
      const index = ids.indexOf(id),
        destination = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (destination < 0 || destination >= ids.length) return;
      const next = [...ids];
      [next[index], next[destination]] = [next[destination], next[index]];
      reorder(id, next);
    },
  });
}
