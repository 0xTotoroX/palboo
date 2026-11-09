/* [INPUT]: Reader layout changes, local migration fallback and reader-authenticated preference API.
 * [OUTPUT]: Durable reader preferences with pending-write recovery across reloads; unkeyed previews stay in memory.
 * [POS]: Reader layout persistence only; no credentials, note bodies or reading history enter backups.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState, type SetStateAction } from 'react';
export function useReaderPreference<T extends number | boolean>(
  key: string | undefined,
  initial: () => T,
) {
  const pendingKey = key ? `palboo-reader-pending:${key}` : undefined;
  const [first] = useState(() => {
    const value = initial();
    try {
      const cached = pendingKey && localStorage.getItem(pendingKey);
      if (cached) {
        const pending = JSON.parse(cached);
        if (
          typeof pending === typeof value &&
          (typeof pending !== 'number' ||
            (Number.isFinite(pending) && pending >= 160 && pending <= 640))
        )
          return { value: pending as T, pending: true };
      }
    } catch {}
    return { value, pending: false };
  });
  const [value, setValue] = useState(first.value);
  const current = useRef(value);
  current.current = value;
  const [ready, setReady] = useState(false);
  const dirty = useRef(first.pending);
  const edited = useRef(first.pending);
  const revision = useRef(0);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!key) return;
    let canceled = false;
    void import('./api')
      .then((api) => api.read<Record<string, T>>('preferences'))
      .then((saved) => {
        if (canceled) return;
        if (!edited.current) {
          if (typeof saved[key] === typeof value) setValue(saved[key]);
          else dirty.current = true;
        }
        setReady(true);
      })
      .catch(() => {
        if (!canceled) setReady(true);
      });
    return () => {
      canceled = true;
    };
  }, [key]);
  useEffect(() => {
    if (!key || !ready || !dirty.current) return;
    const timer = window.setTimeout(() => {
      const pending = revision.current;
      writes.current = writes.current
        .then(() => import('./api'))
        .then((api) => api.savePreferences({ [key]: value }))
        .then(() => {
          if (revision.current === pending) {
            dirty.current = false;
            try {
              if (pendingKey && localStorage.getItem(pendingKey) === JSON.stringify(value))
                localStorage.removeItem(pendingKey);
            } catch {}
          }
        })
        .catch(() => {});
    }, 200);
    return () => window.clearTimeout(timer);
  }, [key, ready, value]);
  return [
    value,
    (next: SetStateAction<T>) => {
      edited.current = true;
      dirty.current = true;
      revision.current += 1;
      const updated = typeof next === 'function' ? next(current.current) : next;
      current.current = updated;
      // A reload before the debounced request completes must not restore an older server value.
      try {
        if (pendingKey) localStorage.setItem(pendingKey, JSON.stringify(updated));
      } catch {}
      setValue(updated);
    },
  ] as const;
}
