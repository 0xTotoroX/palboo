/* [INPUT]: Model view refs, catalog state and confirmed UI actions.
 * [OUTPUT]: Short catalog transitions and confirmed pointer feedback, cancelled on interruption or teardown.
 * [POS]: Presentation only; never delays an action or changes saved preferences.
 * [PROTOCOL]: Keep model/AGENTS.md in sync. */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export function useModelMotion({
  root,
  favorites,
  picker,
  catalog,
}: {
  root: RefObject<HTMLElement | null>;
  favorites: RefObject<HTMLDivElement | null>;
  picker: RefObject<HTMLDivElement | null>;
  catalog: boolean;
}) {
  const pointer = useRef(false);
  const previous = useRef(catalog);
  const active = useRef(new Set<Animation>());
  const media = () =>
    root.current?.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)');
  function stop() {
    active.current.forEach((animation) => animation.cancel());
    active.current.clear();
  }
  function animate(node: HTMLElement | null, frames: Keyframe[], duration: number) {
    if (
      !pointer.current ||
      !node?.isConnected ||
      !node.animate ||
      !node.getClientRects().length ||
      getComputedStyle(node).visibility !== 'visible' ||
      node.ownerDocument.hidden ||
      media()?.matches
    )
      return;
    const animation = node.animate(frames, {
      duration,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
    active.current.add(animation);
    const release = () => active.current.delete(animation);
    void animation.finished.then(release, release);
  }
  function keyboard() {
    pointer.current = false;
    if (root.current) root.current.dataset.modelInput = 'keyboard';
    stop();
  }
  useLayoutEffect(() => {
    if (previous.current === catalog) return;
    previous.current = catalog;
    stop();
    animate(catalog ? picker.current : favorites.current, [{ opacity: 0.45 }, { opacity: 1 }], 140);
  }, [catalog]);
  useEffect(() => {
    const reduced = media();
    const document = root.current?.ownerDocument;
    const interrupt = () => {
      if (document?.hidden || reduced?.matches) stop();
    };
    reduced?.addEventListener('change', interrupt);
    document?.addEventListener('visibilitychange', interrupt);
    return () => {
      reduced?.removeEventListener('change', interrupt);
      document?.removeEventListener('visibilitychange', interrupt);
      stop();
    };
  }, []);
  return {
    keyboard,
    pointer() {
      pointer.current = true;
      if (root.current) root.current.dataset.modelInput = 'pointer';
    },
    confirm(result: unknown, node: HTMLElement, fromPointer: boolean) {
      if (!result || !fromPointer) return;
      animate(
        node,
        [
          { transform: 'scale(0.96)', opacity: 0.7 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        160,
      );
    },
  };
}
