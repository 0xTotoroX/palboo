/* [INPUT]: Local note summaries, controlled navigation and optional browser preferences.
 * [OUTPUT]: Resizable sidebar, breadcrumb path and keyboard quick switcher without transport.
 * [POS]: Shared reader navigation; website can omit persistence and owns its navigation adapter.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SearchText } from './search';
import type { Summary } from './api';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';

const defaultWidth = 232;
const clampWidth = (width: number) => Math.max(180, Math.min(520, width));
export function useSidebarWidth(storageKey?: string) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = storageKey && localStorage.getItem(storageKey);
      if (saved && Number.isFinite(Number(saved))) return clampWidth(Number(saved));
    } catch {}
    return defaultWidth;
  });
  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {}
    }
  }, [storageKey, width]);
  return { width, setWidth, style: { '--reader-sidebar-width': `${width}px` } as CSSProperties };
}
export function SidebarResize({
  width,
  setWidth,
}: {
  width: number;
  setWidth: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="reader-resize"
      role="separator"
      aria-label={tr('调整侧栏宽度')}
      aria-orientation="vertical"
      aria-valuemin={180}
      aria-valuemax={520}
      aria-valuenow={width}
      tabIndex={0}
      title={tr('拖动调整宽度，双击恢复默认')}
      onDoubleClick={() => setWidth(defaultWidth)}
      onKeyDown={(event) => {
        const next =
          event.key === 'Home'
            ? defaultWidth
            : event.key === 'ArrowLeft'
              ? width - 12
              : event.key === 'ArrowRight'
                ? width + 12
                : null;
        if (next === null) return;
        event.preventDefault();
        setWidth(clampWidth(next));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) setWidth(clampWidth(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
export function Breadcrumbs({ id, query = '' }: { id: string; query?: string }) {
  return (
    <nav className="reader-breadcrumbs" aria-label={tr('笔记路径')} title={id}>
      <ol>
        {id.split('/').map((part, index, parts) => (
          <li key={index}>
            {index > 0 && <span aria-hidden="true">/</span>}
            <span aria-current={index === parts.length - 1 ? 'page' : undefined}>
              <SearchText text={part} query={query} />
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
export function QuickSwitcher({
  notes,
  visible,
  close,
  open,
}: {
  notes: Summary[];
  visible: boolean;
  close: () => void;
  open: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return notes
      .filter((note) =>
        terms.every((term) => `${note.title} ${note.id}`.toLocaleLowerCase().includes(term)),
      )
      .sort(
        (a, b) =>
          Number(b.title.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) -
          Number(a.title.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())),
      )
      .slice(0, 100);
  }, [notes, query]);
  useEffect(() => {
    if (visible) {
      setQuery('');
      setActive(0);
      dialog.current?.showModal();
      input.current?.focus();
    } else dialog.current?.close();
  }, [visible]);
  useLayoutEffect(() => {
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);
  return (
    <dialog
      ref={dialog}
      className="reader-switcher"
      aria-labelledby="reader-switcher-title"
      onClose={close}
    >
      <div className="reader-switcher-heading">
        <h2 id="reader-switcher-title">{tr('快速切换笔记')}</h2>
        <button aria-label={tr('关闭')} onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <input
        ref={input}
        role="combobox"
        aria-label={tr('按标题或路径查找')}
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="reader-switcher-results"
        aria-activedescendant={
          results.length ? `reader-option-${Math.min(active, results.length - 1)}` : undefined
        }
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((value) =>
              Math.max(
                0,
                Math.min(results.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)),
              ),
            );
          } else if (event.key === 'Enter' && results.length) {
            event.preventDefault();
            close();
            open(results[Math.min(active, results.length - 1)].id);
          }
        }}
      />
      <ul id="reader-switcher-results" role="listbox" aria-label={tr('笔记')}>
        {results.map((note, index) => (
          <li
            key={note.id}
            id={`reader-option-${index}`}
            role="option"
            aria-selected={index === Math.min(active, results.length - 1)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              close();
              open(note.id);
            }}
          >
            <strong>{note.title}</strong>
            <small>{note.id}</small>
          </li>
        ))}
      </ul>
      {!results.length && <p role="status">{tr('没有匹配的笔记')}</p>}
    </dialog>
  );
}
