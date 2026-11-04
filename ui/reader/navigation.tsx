/* [INPUT]: Local path segments, controlled sidebar width and optional browser persistence.
 * [OUTPUT]: Resizable sidebar handle and interactive folder/note breadcrumbs without transport.
 * [POS]: Shared reader navigation; website omits persistence and supplies its own state.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SearchText } from './search';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';

export const READER_DEFAULT_SIDEBAR_WIDTH = 268;
const clampWidth = (width: number) => Math.max(180, Math.min(520, width));
export function useSidebarWidth(storageKey?: string, initialWidth = READER_DEFAULT_SIDEBAR_WIDTH) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = storageKey && localStorage.getItem(storageKey);
      if (saved && Number.isFinite(Number(saved))) return clampWidth(Number(saved));
    } catch {}
    return clampWidth(initialWidth);
  });
  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {}
    }
  }, [storageKey, width]);
  return {
    width,
    defaultWidth: clampWidth(initialWidth),
    setWidth,
    style: { '--reader-sidebar-width': `${width}px` } as CSSProperties,
  };
}
export function SidebarResize({
  width,
  defaultWidth = READER_DEFAULT_SIDEBAR_WIDTH,
  setWidth,
}: {
  width: number;
  defaultWidth?: number;
  setWidth: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className="reader-resize"
      data-dragging={dragging || undefined}
      role="separator"
      aria-label={tr('调整侧栏宽度')}
      aria-orientation="vertical"
      aria-valuemin={180}
      aria-valuemax={520}
      aria-valuenow={width}
      tabIndex={0}
      title={tr('拖动调整宽度，双击恢复默认')}
      onDoubleClick={() => setWidth(clampWidth(defaultWidth))}
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
        setDragging(true);
        document.body.dataset.readerResizing = 'true';
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) setWidth(clampWidth(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={(event) => {
        drag.current = null;
        setDragging(false);
        delete document.body.dataset.readerResizing;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
        delete document.body.dataset.readerResizing;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
        delete document.body.dataset.readerResizing;
      }}
    />
  );
}
function cleanLeaf(part: string) {
  return part.replace(/\.(?:md|xlsx|xls|xlsm|xlsb|ods|csv|tsv)$/i, '');
}
export function Breadcrumbs({
  id,
  title,
  query = '',
  onSelectFolder,
}: {
  id: string;
  title?: string;
  query?: string;
  onSelectFolder?: (folderPath: string) => void;
}) {
  const parts = id.split('/').filter(Boolean);
  return (
    <nav className="reader-breadcrumbs" aria-label={tr('笔记路径')} title={id}>
      <ol>
        {parts.map((part, index) => {
          const isLast = index === parts.length - 1;
          const label = isLast ? title || cleanLeaf(part) : part;
          const folderPath = `${parts.slice(0, index + 1).join('/')}/`;
          return (
            <li key={index}>
              {index > 0 && (
                <span className="reader-crumb-sep" aria-hidden="true">
                  <Icon name="chevron-right" />
                </span>
              )}
              {!isLast && onSelectFolder ? (
                <button
                  type="button"
                  className="reader-crumb-folder"
                  onClick={() => onSelectFolder(folderPath)}
                >
                  <SearchText text={label} query={query} />
                </button>
              ) : (
                <span
                  className={isLast ? 'reader-crumb-current' : undefined}
                  aria-current={isLast ? 'page' : undefined}
                >
                  <SearchText text={label} query={query} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
