/* [INPUT]: Catalog title/path matches and folder-scoped full-text search responses.
 * [OUTPUT]: Deduplicated title-first results with stable keyboard selection and paged full-text results.
 * [POS]: Reader search state; shared search.tsx remains transport-free for Markdown and site previews.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useMemo, useState } from 'react';
import { read, type Catalog, type Search } from './api';

export function useReaderSearch(catalog: Catalog | null) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<{ query: string; offset: number; value: Search } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState('');
  const search = response?.query === query && response.offset === offset ? response.value : null;
  const results = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    if (!trimmed || !catalog) return [];
    const words = trimmed.split(/\s+/);
    const quick = offset
      ? []
      : catalog.notes
          .filter((note) =>
            words.every((word) => `${note.title} ${note.id}`.toLocaleLowerCase().includes(word)),
          )
          .sort(
            (a, b) =>
              Number(b.title.toLocaleLowerCase().startsWith(trimmed)) -
              Number(a.title.toLocaleLowerCase().startsWith(trimmed)),
          )
          .slice(0, 50)
          .map((note) => ({ ...note, snippet: '' }));
    const merged = new Map(quick.map((note) => [note.id, note]));
    for (const note of search?.results || []) merged.set(note.id, note);
    return [...merged.values()];
  }, [query, offset, catalog, search]);
  const active = Math.max(
    0,
    results.findIndex((note) => note.id === activeId),
  );
  useEffect(() => {
    if (!query.trim() || !catalog) {
      setResponse(null);
      setError('');
      return;
    }
    const controller = new AbortController();
    setError('');
    const timer = setTimeout(() => {
      void read<Search>('search', { q: query, offset }, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setResponse({ query, offset, value });
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, offset, catalog?.revision]);
  return {
    query,
    offset,
    search,
    error,
    results,
    active,
    setActive: (index: number) => setActiveId(results[index]?.id || ''),
    change: (value: string) => {
      setQuery(value);
      setOffset(0);
      setActiveId('');
      setResponse(null);
    },
    page: (value: number) => {
      setOffset(value);
      setActiveId('');
      setResponse(null);
    },
  };
}
