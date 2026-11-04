/* [INPUT]: Controlled files/recent selection, authorized catalog and recent note IDs.
 * [OUTPUT]: Keyboard tabs and a compact recent list; the file tree stays mounted while hidden.
 * [POS]: Shared reader/site navigation, without storage, requests or independent history.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useId, useRef, type ReactNode } from 'react';
import type { Summary } from './api';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
export type LibraryTab = 'files' | 'recent';
export function LibraryNavigation({
  tab,
  setTab,
  searching,
  notes,
  recent,
  selected,
  open,
  children,
}: {
  tab: LibraryTab;
  setTab: (tab: LibraryTab) => void;
  searching: boolean;
  notes: Summary[];
  recent: string[];
  selected: string;
  open: (id: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const entries = [...new Set(recent)]
    .map((id) => notes.find((note) => note.id === id))
    .filter((note): note is Summary => !!note);
  const tabs = [
    { id: 'files' as const, label: tr('文件') },
    { id: 'recent' as const, label: tr('最近') },
  ];
  return (
    <div className="reader-library-navigation" hidden={searching}>
      <div role="tablist" aria-label={tr('浏览笔记')} className="reader-library-tabs">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            ref={(node) => {
              buttons.current[index] = node;
            }}
            id={`${id}-tab-${item.id}`}
            aria-controls={`${id}-panel-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
              setTab(tabs[next].id);
              buttons.current[next]?.focus({ preventScroll: true });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-files`}
        aria-labelledby={`${id}-tab-files`}
        hidden={tab !== 'files'}
      >
        <nav aria-label={tr('笔记目录')}>{children}</nav>
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-recent`}
        aria-labelledby={`${id}-tab-recent`}
        hidden={tab !== 'recent'}
      >
        {entries.length ? (
          <ul className="reader-recent reader-sidebar-recent">
            {entries.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  title={note.id}
                  aria-current={note.id === selected ? 'page' : undefined}
                  onClick={() => open(note.id)}
                >
                  <Icon name={note.kind === 'spreadsheet' ? 'reader-sheet' : 'reader-note'} />
                  <span>
                    <strong>{note.title}</strong>
                    <small>{note.id}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="reader-status">{tr('尚未打开笔记')}</p>
        )}
      </div>
    </div>
  );
}
