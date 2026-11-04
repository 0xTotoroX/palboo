/* [INPUT]: Browser history, a folder scope and the editor's save gate.
 * [OUTPUT]: Bounded reader back/forward, reload-safe cursor and conflict-safe native navigation.
 * [POS]: Owns reader history metadata only; never stores note bodies or credentials.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
type Cursor = { session: string; index: number; scope: string };
export function useReaderHistory(
  scope: string,
  before: () => Promise<boolean>,
  change: () => void,
) {
  const key = `palboo-reader-history:${scope}`;
  const callbacks = useRef({ before, change });
  callbacks.current = { before, change };
  const state = useRef<{ cursor: Cursor; max: number } | null>(null);
  if (!state.current) {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch {
      /* Optional. */
    }
    const current = history.state?.palbooReader as Cursor | undefined;
    const reuse =
      current?.scope === scope &&
      current.session === saved?.session &&
      Number.isInteger(current.index);
    const cursor = reuse ? current! : { session: crypto.randomUUID(), index: 0, scope };
    state.current = { cursor, max: reuse ? Math.max(cursor.index, Number(saved.max) || 0) : 0 };
    history.replaceState({ ...history.state, palbooReader: cursor }, '');
  }
  const moving = useRef(false);
  const requested = useRef(false);
  const latest = useRef<Cursor | null>(null);
  const restoring = useRef(false);
  const [, render] = useState(0);
  const persist = () => {
    const { cursor, max } = state.current!;
    try {
      sessionStorage.setItem(key, JSON.stringify({ session: cursor.session, max }));
    } catch {
      /* Optional. */
    }
    render((n) => n + 1);
  };
  useEffect(() => {
    persist();
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const pop = async (event: PopStateEvent) => {
      const target = event.state?.palbooReader as Cursor | undefined;
      const current = state.current!;
      if (!target || target.session !== current.cursor.session) return;
      requested.current = false;
      latest.current = target;
      if (restoring.current) {
        if (target.index !== current.cursor.index) {
          history.go(current.cursor.index - target.index);
          return;
        }
        restoring.current = false;
        moving.current = false;
        persist();
        return;
      }
      if (moving.current) return;
      moving.current = true;
      persist();
      let allowed = false;
      try {
        allowed = await callbacks.current.before();
      } catch {
        /* Keep the current draft. */
      }
      const destination = latest.current!;
      if (!allowed && destination.index !== current.cursor.index) {
        restoring.current = true;
        history.go(current.cursor.index - destination.index);
        return;
      }
      if (allowed) {
        current.cursor = destination;
        callbacks.current.change();
      }
      moving.current = false;
      persist();
    };
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      history.scrollRestoration = previous;
    };
  }, []);
  const { cursor, max } = state.current;
  return {
    busy: () => moving.current || requested.current,
    back: !moving.current && !requested.current && cursor.index > 0,
    forward: !moving.current && !requested.current && cursor.index < max,
    go: (delta: number) => {
      if (
        !moving.current &&
        !requested.current &&
        cursor.index + delta >= 0 &&
        cursor.index + delta <= max
      ) {
        requested.current = true;
        persist();
        history.go(delta);
      }
    },
    push: (url: string) => {
      if (new URL(url, location.href).href === location.href) return;
      const current = state.current!;
      current.cursor = { ...current.cursor, index: current.cursor.index + 1 };
      current.max = current.cursor.index;
      history.pushState({ palbooReader: current.cursor }, '', url);
      persist();
    },
  };
}
export function HistoryButtons({
  back,
  forward,
  go,
}: {
  back: boolean;
  forward: boolean;
  go: (delta: number) => void;
}) {
  return (
    <div className="reader-history-actions">
      <button
        className="reader-tool-btn"
        title={tr('后退')}
        aria-label={tr('后退')}
        disabled={!back}
        onClick={() => go(-1)}
      >
        <Icon name="back" />
      </button>
      <button
        className="reader-tool-btn reader-forward"
        title={tr('前进')}
        aria-label={tr('前进')}
        disabled={!forward}
        onClick={() => go(1)}
      >
        <Icon name="back" />
      </button>
    </div>
  );
}
