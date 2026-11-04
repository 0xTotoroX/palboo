/* [INPUT]: Authorized catalog and successfully opened note identities.
 * [OUTPUT]: Continue-reading/recent list, first-use file tree and folder-scoped recent IDs.
 * [POS]: Reader landing content; no note bodies, credentials or external requests are persisted.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useCallback, useState } from 'react';
import type { Catalog, Summary } from './api';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
import { NoteTree } from './tree';

export function useRecentNotes(folder: string) {
  const key = `palboo-reader-recent:${folder || 'obsidian'}`;
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string').slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });
  const visit = useCallback(
    (id: string) => {
      setIds((current) => {
        if (!id || current[0] === id) return current;
        const next = [id, ...current.filter((item) => item !== id)].slice(0, 8);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [key],
  );
  return { ids, visit };
}
export function ReaderHome({
  catalog,
  recent,
  open,
}: {
  catalog: Catalog;
  recent: string[];
  open: (id: string) => void;
}) {
  const notes = recent
    .map((id) => catalog.notes.find((note) => note.id === id))
    .filter((note): note is Summary => !!note);
  return (
    <section className="reader-home" aria-label={tr('阅读首页')}>
      <h1>{notes.length ? tr('继续阅读') : catalog.name}</h1>
      {notes.length ? (
        <>
          <ul className="reader-recent">
            {notes.map((note, index) => (
              <li key={note.id}>
                {index === 1 && <h2>{tr('最近打开')}</h2>}
                <button
                  title={note.id}
                  className={index === 0 ? 'reader-resume' : undefined}
                  onClick={() => open(note.id)}
                >
                  <Icon name={note.kind === 'spreadsheet' ? 'reader-sheet' : 'reader-note'} />
                  <span>
                    <strong>{note.title}</strong>
                    <small>{note.id}</small>
                  </span>
                  {index === 0 && <Icon name="chevron-right" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : catalog.notes.length ? (
        <NoteTree notes={catalog.notes} selected="" open={open} />
      ) : (
        <p role="status">{tr('这个文件夹中暂无可阅读的笔记')}</p>
      )}
    </section>
  );
}
