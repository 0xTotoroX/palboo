/* [INPUT]: Open state, readiness guard, mount mode and shared settings motion preferences.
 * [OUTPUT]: Interruptible height+fade+micro-lift disclosure, synchronized height transitions and subtle view reveals.
 * [POS]: Settings/shared presentation only; preserves drafts, live child updates, DOM identity, focus safety and instant keyboard/reduced-motion fallbacks.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  DISCLOSURE_COLLAPSE_MS,
  DISCLOSURE_EXPAND_MS,
  bindMotionInterrupt,
  disclosureEasing,
  prefersInstantMotion,
} from './settings-motion';
import { useInputModality } from '../shared/use-input-modality';

type CollapseProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  open: boolean;
  ready?: boolean;
  unmountOnExit?: boolean;
  expandMs?: number;
  collapseMs?: number;
  lift?: number;
  outerClassName?: string;
  searchIgnoreWhenClosed?: boolean;
  children: ReactNode;
};

export function SettingsCollapse({
  open,
  ready = true,
  unmountOnExit = false,
  expandMs = DISCLOSURE_EXPAND_MS,
  collapseMs = DISCLOSURE_COLLAPSE_MS,
  lift = 3,
  className,
  outerClassName,
  searchIgnoreWhenClosed = false,
  children,
  ...rest
}: CollapseProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useInputModality();
  const [rendered, setRendered] = useState(open);
  // KeepMounted always renders live children so hidden forms receive updates;
  // only unmountOnExit retains the last painted tree for the brief exit animation.
  const exitSnapshot = useRef<ReactNode>(open ? children : null);
  if (unmountOnExit && open) exitSnapshot.current = children;

  const initialized = useRef(false);
  const wasReady = useRef(ready);
  const prevOpen = useRef(open);
  const openRef = useRef(open);
  openRef.current = open;
  const active = useRef<{ cancel: () => void; primary: Animation } | null>(null);

  const shown = open || rendered;

  useEffect(
    () => () => {
      active.current?.cancel();
      active.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;

    const clearStyles = () => {
      if (!outer) return;
      outer.style.removeProperty('height');
      outer.style.removeProperty('overflow');
    };
    const stopActive = () => {
      active.current?.cancel();
      active.current = null;
      clearStyles();
    };
    const settle = (targetOpen: boolean) => {
      stopActive();
      setRendered(targetOpen);
      if (!targetOpen && unmountOnExit) exitSnapshot.current = null;
    };

    if (!initialized.current) {
      initialized.current = true;
      wasReady.current = ready;
      prevOpen.current = open;
      setRendered(open);
      return;
    }

    const hydrated = !wasReady.current && ready;
    wasReady.current = ready;
    const changed = prevOpen.current !== open;
    prevOpen.current = open;

    if (!ready || hydrated) {
      settle(open);
      return;
    }
    if (!changed) {
      if (open && !rendered) setRendered(true);
      return;
    }

    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const ancestorHidden = !outer || !!outer.parentElement?.closest('[hidden]');
    if (!outer || !inner || prefersInstantMotion(media) || ancestorHidden) {
      settle(open);
      return;
    }

    const liveHeight = active.current
      ? outer.getBoundingClientRect().height
      : open
        ? 0
        : outer.getBoundingClientRect().height;
    const liveOpacity = active.current
      ? Number.parseFloat(getComputedStyle(inner).opacity)
      : open
        ? 0
        : 1;
    const fromOpacity = Number.isFinite(liveOpacity)
      ? Math.min(1, Math.max(0, liveOpacity))
      : open
        ? 0
        : 1;

    stopActive();

    const easing = disclosureEasing(outer);
    const naturalHeight = inner.getBoundingClientRect().height;

    if (open) {
      setRendered(true);
      if (naturalHeight < 0.5 || Math.abs(naturalHeight - liveHeight) < 0.5) {
        clearStyles();
        return;
      }
      const ratio =
        liveHeight > 0 ? Math.max(0.45, (naturalHeight - liveHeight) / naturalHeight) : 1;
      const duration = Math.round(expandMs * ratio);
      const fadeDelay = liveHeight > 0 ? 0 : 24;
      const fadeDuration = Math.max(100, Math.round(duration * 0.82) - fadeDelay);
      const offset = lift > 0 ? -Math.min(4, lift) : 0;

      outer.style.overflow = 'clip';
      const heightAnim = outer.animate(
        [{ height: `${liveHeight}px` }, { height: `${naturalHeight}px` }],
        { duration, easing },
      );
      const contentAnim = inner.animate(
        [
          {
            opacity: fromOpacity,
            transform: offset ? `translateY(${offset}px)` : 'none',
          },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: fadeDuration,
          delay: fadeDelay,
          easing,
          fill: fadeDelay ? 'backwards' : 'none',
        },
      );
      const cancel = bindMotionInterrupt({
        animations: [heightAnim, contentAnim],
        media,
        onInterrupt: () => settle(openRef.current),
        onFinish: () => {
          if (active.current?.primary !== heightAnim) return;
          active.current = null;
          clearStyles();
        },
      });
      active.current = { cancel, primary: heightAnim };
    } else {
      if (liveHeight < 0.5) {
        settle(false);
        return;
      }
      const fullHeight = Math.max(naturalHeight, liveHeight, 1);
      const ratio = Math.max(0.55, liveHeight / fullHeight);
      const duration = Math.round(collapseMs * ratio);
      const fadeDuration = Math.max(85, Math.round(duration * 0.65));
      const offset = lift > 0 ? -Math.min(2, lift) : 0;

      outer.style.overflow = 'clip';
      const heightAnim = outer.animate([{ height: `${liveHeight}px` }, { height: '0px' }], {
        duration,
        easing,
        fill: 'forwards',
      });
      const contentAnim = inner.animate(
        [
          { opacity: fromOpacity, transform: 'none' },
          {
            opacity: 0,
            transform: offset ? `translateY(${offset}px)` : 'none',
          },
        ],
        { duration: fadeDuration, easing: 'ease-out', fill: 'forwards' },
      );
      const cancel = bindMotionInterrupt({
        animations: [heightAnim, contentAnim],
        media,
        onInterrupt: () => settle(openRef.current),
        onFinish: () => {
          if (active.current?.primary !== heightAnim) return;
          // Remove the filled zero-height and opacity effects before this retained node reopens.
          settle(false);
        },
      });
      active.current = { cancel, primary: heightAnim };
    }
  }, [open, ready, unmountOnExit, expandMs, collapseMs, lift]);

  if (unmountOnExit && !shown) return null;

  const closing = !open && shown;

  return (
    <div
      {...rest}
      ref={outerRef}
      hidden={!shown}
      inert={closing || (!open && !unmountOnExit) || undefined}
      aria-hidden={closing || (!open && !unmountOnExit) || undefined}
      data-settings-collapse={open ? 'open' : closing ? 'closing' : 'closed'}
      data-settings-search-ignore={searchIgnoreWhenClosed && !open ? true : undefined}
      className={outerClassName ? `settings-collapse ${outerClassName}` : 'settings-collapse'}
    >
      <div
        ref={innerRef}
        className={className ? `settings-collapse-inner ${className}` : 'settings-collapse-inner'}
        style={{ display: 'flow-root' }}
      >
        {unmountOnExit && !open ? exitSnapshot.current : children}
      </div>
    </div>
  );
}

export function useHeightTransition<T extends HTMLElement = HTMLDivElement>(
  triggerKey: string,
  {
    ready = true,
    enabled = true,
    expandMs = DISCLOSURE_EXPAND_MS,
    collapseMs = DISCLOSURE_COLLAPSE_MS,
  }: {
    ready?: boolean;
    enabled?: boolean;
    expandMs?: number;
    collapseMs?: number;
  } = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useInputModality();
  const previousKey = useRef(triggerKey);
  const wasReady = useRef(ready);
  const lastHeight = useRef<number | null>(null);
  const active = useRef<{ cancel: () => void; animation: Animation } | null>(null);

  // Track settled height continuously while enabled & ready so responsive resizes,
  // visibility changes and async content growth never cause a stale start height.
  useLayoutEffect(() => {
    const node = ref.current;
    const stop = () => {
      active.current?.cancel();
      active.current = null;
      node?.style.removeProperty('overflow');
    };
    if (!node || !enabled || !ready) {
      stop();
      lastHeight.current = null;
      return;
    }
    const sync = () => {
      if (active.current) return;
      if (node.closest('[hidden]')) {
        lastHeight.current = null;
        return;
      }
      const height = node.getBoundingClientRect().height;
      lastHeight.current = height > 0.5 ? height : null;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [enabled, ready]);

  useLayoutEffect(() => {
    const node = ref.current;
    const prevKey = previousKey.current;
    previousKey.current = triggerKey;
    const hydrated = !wasReady.current && ready;
    wasReady.current = ready;

    const stop = () => {
      active.current?.cancel();
      active.current = null;
      node?.style.removeProperty('overflow');
    };

    if (!node || !enabled || !ready || node.closest('[hidden]')) {
      stop();
      lastHeight.current =
        node && !node.closest('[hidden]') ? node.getBoundingClientRect().height || null : null;
      return;
    }

    const currentHeight = node.getBoundingClientRect().height;
    if (hydrated || prevKey === triggerKey) {
      if (!active.current) lastHeight.current = currentHeight > 0.5 ? currentHeight : null;
      return;
    }

    // Read live rendered height when interrupting an in-flight animation, otherwise
    // use the latest settled height kept up to date by the observer above.
    const fromHeight = active.current ? currentHeight : lastHeight.current;
    stop();
    const toHeight = node.getBoundingClientRect().height;
    lastHeight.current = toHeight > 0.5 ? toHeight : null;

    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (
      fromHeight == null ||
      fromHeight < 1 ||
      toHeight < 1 ||
      Math.abs(toHeight - fromHeight) < 1 ||
      prefersInstantMotion(media)
    )
      return;

    const duration = toHeight > fromHeight ? expandMs : collapseMs;
    node.style.overflow = 'clip';
    const animation = node.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], {
      duration,
      easing: disclosureEasing(node),
    });
    const settleHeight = () => {
      node.style.removeProperty('overflow');
      const settled = node.getBoundingClientRect().height;
      lastHeight.current = settled > 0.5 ? settled : null;
    };
    const cancel = bindMotionInterrupt({
      animations: [animation],
      media,
      resize: true,
      onInterrupt: () => {
        active.current = null;
        settleHeight();
      },
      onFinish: () => {
        if (active.current?.animation !== animation) return;
        active.current = null;
        settleHeight();
      },
    });
    active.current = { cancel, animation };
  }, [triggerKey, ready, enabled, expandMs, collapseMs]);

  return ref;
}

export function useRevealTransition<T extends HTMLElement = HTMLDivElement>(
  triggerKey: string,
  {
    enabled = true,
    duration = 190,
    lift = 3,
    fromOpacity = 0.45,
  }: {
    enabled?: boolean;
    duration?: number;
    lift?: number;
    fromOpacity?: number;
  } = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useInputModality();
  const previous = useRef(triggerKey);

  useLayoutEffect(() => {
    const node = ref.current;
    const before = previous.current;
    previous.current = triggerKey;
    if (!node || !enabled || before === triggerKey || node.closest('[hidden]')) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersInstantMotion(media)) return;
    node.getAnimations().forEach((animation) => animation.cancel());
    const offset = Math.min(4, Math.max(0, lift));
    const animation = node.animate(
      [
        { opacity: fromOpacity, transform: offset ? `translateY(${offset}px)` : 'none' },
        { opacity: 1, transform: 'none' },
      ],
      { duration, easing: disclosureEasing(node) },
    );
    return bindMotionInterrupt({ animations: [animation], media });
  }, [triggerKey, enabled, duration, lift, fromOpacity]);

  return ref;
}
