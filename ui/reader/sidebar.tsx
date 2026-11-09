/* [INPUT]: Reader search input, durable sidebar preference and session-only temporary opening.
 * [OUTPUT]: Docked/sidebar drawer state, shortcuts, focus containment and restoration.
 * [POS]: Standalone reader navigation lifecycle; temporary opening never changes the saved layout.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useReaderPreference } from './preferences';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useReaderSidebar(search: RefObject<HTMLInputElement | null>) {
  const [narrow, setNarrow] = useState(matchMedia('(max-width: 640px)').matches);
  const [pinned, setPinned] = useReaderPreference('sidebarPinned', () => {
    try {
      const saved = sessionStorage.getItem('palboo-reader-sidebar');
      if (saved !== null) return saved === 'true';
    } catch {}
    return !matchMedia('(max-width: 640px)').matches;
  });
  const [drawer, setDrawer] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<'search' | 'tree' | null>(null);
  const restoreFocus = useRef<number | null>(null);
  const docked = pinned && !narrow;
  const overlay = drawer && !docked;
  const visible = docked || overlay;
  useEffect(() => {
    const media = matchMedia('(max-width: 640px)');
    const update = () => {
      setNarrow(media.matches);
      setDrawer(false);
    };
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
      if (restoreFocus.current !== null) cancelAnimationFrame(restoreFocus.current);
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem('palboo-reader-sidebar', String(pinned));
    } catch {}
  }, [pinned]);
  const navigationFocus = () =>
    [
      ...(panel.current?.querySelectorAll<HTMLElement>(
        '[role="tabpanel"] [aria-current="page"], [role="tabpanel"] summary, [role="tabpanel"] button, [role="tab"][aria-selected="true"]',
      ) || []),
    ].find((node) => node.getClientRects().length);
  const show = useCallback(
    (kind: 'search' | 'tree' = 'tree') => {
      // A quick reopen must cancel the previous close's deferred focus restoration.
      if (restoreFocus.current !== null) cancelAnimationFrame(restoreFocus.current);
      restoreFocus.current = null;
      if (!visible) trigger.current = document.activeElement as HTMLElement;
      pendingFocus.current = kind;
      if (visible) {
        const node = kind === 'search' ? search.current : navigationFocus();
        node?.focus();
        if (kind === 'search') search.current?.select();
        pendingFocus.current = null;
      } else setDrawer(true);
    },
    [docked, visible, search],
  );
  const close = useCallback(() => {
    setDrawer(false);
    if (docked) setPinned(false);
    if (restoreFocus.current !== null) cancelAnimationFrame(restoreFocus.current);
    restoreFocus.current = requestAnimationFrame(() => {
      restoreFocus.current = null;
      const target =
        trigger.current?.isConnected && trigger.current.getClientRects().length
          ? trigger.current
          : document.querySelector<HTMLElement>('.reader-open-directory');
      target?.focus({ preventScroll: true });
    });
  }, [docked]);
  useLayoutEffect(() => {
    if (!visible || !pendingFocus.current) return;
    const kind = pendingFocus.current;
    pendingFocus.current = null;
    const target = kind === 'search' ? search.current : navigationFocus();
    (target || search.current)?.focus();
    if (kind === 'search') search.current?.select();
  }, [visible, search]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        ['o', 'k'].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        show('search');
      } else if (event.key === 'Escape' && overlay) {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab' && overlay) {
        const nodes = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, select, summary, [tabindex="0"]',
          ) || []),
        ].filter((node) => node.getClientRects().length);
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [show, close, overlay]);
  return {
    panel,
    visible,
    docked,
    overlay,
    narrow,
    show,
    close,
    pin: () => {
      setPinned(true);
      setDrawer(false);
    },
    dismiss: () => {
      if (overlay) close();
    },
  };
}
