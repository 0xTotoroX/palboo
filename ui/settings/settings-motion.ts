/* [INPUT]: Presentation identity, header geometry, input modality and host motion preferences.
 * [OUTPUT]: Shared timing/reduced-motion helpers, unified motion interrupt binding, sticky offsets and interruptible navigation/scene and provider-field transitions; keyboard and reduced motion stay immediate.
 * [POS]: Settings-only motion, never remounts controls or changes configuration.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useInputModality } from '../shared/use-input-modality';

export const DISCLOSURE_EXPAND_MS = 240;
export const DISCLOSURE_COLLAPSE_MS = 190;
export const CONTENT_SWITCH_MS = 220;
const DISCLOSURE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function reducedMotion(media: MediaQueryList) {
  return media.matches || document.documentElement.dataset.settingsReducedMotion === 'true';
}

export function prefersInstantMotion(media?: MediaQueryList) {
  const query = media ?? matchMedia('(prefers-reduced-motion: reduce)');
  return reducedMotion(query) || document.documentElement.dataset.settingsInput === 'keyboard';
}

export function disclosureEasing(element?: Element | null) {
  if (!element) return DISCLOSURE_EASE;
  return (
    getComputedStyle(element).getPropertyValue('--settings-disclosure-ease').trim() ||
    DISCLOSURE_EASE
  );
}

export function motionTiming(element: Element, fallback: number) {
  const style = getComputedStyle(element);
  const value =
    document.documentElement.dataset.settingsStyle === 'chatgpt'
      ? style.getPropertyValue('--settings-content-enter').trim()
      : '';
  const duration = value ? parseFloat(value) * (value.endsWith('ms') ? 1 : 1000) : fallback;
  return {
    duration: Number.isFinite(duration) ? duration : fallback,
    easing: style.getPropertyValue('--settings-ease').trim() || 'cubic-bezier(.2,.7,.2,1)',
  };
}

// Unified interrupt & cleanup helper shared by all WAAPI transitions in settings.
export function bindMotionInterrupt({
  animations,
  onInterrupt,
  onFinish,
  keyboard = true,
  resize = false,
  media = matchMedia('(prefers-reduced-motion: reduce)'),
  extraMedia,
}: {
  animations: Animation[];
  onInterrupt?: () => void;
  onFinish?: () => void;
  keyboard?: boolean;
  resize?: boolean;
  media?: MediaQueryList;
  extraMedia?: MediaQueryList;
}) {
  let disposed = false;
  const primary = animations[0];
  const unbind = () => {
    if (disposed) return;
    disposed = true;
    media.removeEventListener('change', interrupt);
    extraMedia?.removeEventListener('change', interrupt);
    window.removeEventListener('settings-motion-change', interrupt);
    if (keyboard) window.removeEventListener('keydown', interrupt, true);
    if (resize) window.removeEventListener('resize', interrupt);
  };
  const cancel = () => {
    unbind();
    for (const animation of animations) animation.cancel();
  };
  const interrupt = () => {
    if (disposed) return;
    cancel();
    onInterrupt?.();
  };
  const finish = () => {
    if (disposed) return;
    unbind();
    onFinish?.();
  };
  media.addEventListener('change', interrupt);
  extraMedia?.addEventListener('change', interrupt);
  window.addEventListener('settings-motion-change', interrupt);
  if (keyboard) window.addEventListener('keydown', interrupt, true);
  if (resize) window.addEventListener('resize', interrupt);
  primary?.addEventListener('finish', finish, { once: true });
  primary?.addEventListener('cancel', unbind, { once: true });
  return cancel;
}

export function useSettingsMotion(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(identity);
  useInputModality();
  useLayoutEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>('.settings-header');
    const picker = document.querySelector<HTMLElement>('.settings-nav-trigger');
    const keyboard = () => {
      ref.current?.getAnimations().forEach((animation) => animation.cancel());
    };
    const measure = () => {
      if (header)
        root.style.setProperty('--settings-sticky-offset', `${header.offsetHeight + 18}px`);
      if (picker) root.style.setProperty('--settings-picker-height', `${picker.offsetHeight}px`);
    };
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    if (picker) observer.observe(picker);
    measure();
    window.addEventListener('keydown', keyboard, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', keyboard, true);
      root.style.removeProperty('--settings-sticky-offset');
      root.style.removeProperty('--settings-picker-height');
    };
  }, []);
  useLayoutEffect(() => {
    const element = ref.current;
    const before = previous.current;
    previous.current = identity;
    if (!element || before === identity) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersInstantMotion(reduce)) return;
    element.getAnimations().forEach((active) => active.cancel());
    const timing = motionTiming(element, CONTENT_SWITCH_MS);
    const animation = element.animate(
      [
        { opacity: 0.72, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: timing.duration, easing: disclosureEasing(element) },
    );
    return bindMotionInterrupt({ animations: [animation], media: reduce, keyboard: false });
  }, [identity]);
  return ref;
}

// Keep scene state mounted; only the common feature switcher reserves inactive geometry.
export function usePreviewTransition(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(identity);
  useLayoutEffect(() => {
    const root = ref.current;
    const before = previous.current;
    previous.current = identity;
    if (!root || before === identity) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersInstantMotion(reduce)) return;
    const options = motionTiming(root, 200);
    const animations: Animation[] = [];
    const outgoing = root.querySelector<HTMLElement>(`[data-preview-scene="${before}"]`);
    const incoming = root.querySelector<HTMLElement>(`[data-preview-scene="${identity}"]`);
    if (outgoing)
      animations.push(
        outgoing.animate(
          [
            { visibility: 'visible', opacity: 1 },
            { visibility: 'visible', opacity: 0 },
          ],
          options,
        ),
      );
    if (incoming)
      animations.push(
        incoming.animate(
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none' },
          ],
          options,
        ),
      );
    return bindMotionInterrupt({ animations, media: reduce });
  }, [identity]);
  return ref;
}

// Animate the existing fields together; no wrapper, remount key or save interception.
export function useProviderFieldsMotion(provider: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(provider);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = provider;
    const root = ref.current;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (!root || !before || before === provider || prefersInstantMotion(reduce)) return;
    const fields = new Set<HTMLElement>();
    root
      .querySelectorAll(
        'label[for="protocol"], label[for="base-url"], label[for="api-key"], label[for="model"]',
      )
      .forEach((label) => {
        const field = label.closest<HTMLElement>('.settings-field');
        if (field?.getBoundingClientRect().height) fields.add(field);
      });
    const animations = [...fields].map((field) =>
      field.animate(
        [
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'none' },
        ],
        motionTiming(root, 180),
      ),
    );
    return bindMotionInterrupt({ animations, media: reduce });
  }, [provider]);
  return ref;
}

// Gentle single blink on the existing PALBOO wordmark eyes; never queues or animates letters.
export function useBrandEyeBlink() {
  const brandRef = useRef<HTMLAnchorElement>(null);
  const active = useRef<{ cancel: () => void; animation: Animation } | null>(null);
  useInputModality();

  const cancel = useCallback(() => {
    active.current?.cancel();
    active.current = null;
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancel();
    };
  }, [cancel]);

  const blink = useCallback(() => {
    cancel();
    const eyes = brandRef.current?.querySelector<SVGGElement>('[data-brand-eyes]');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (!eyes || document.hidden || prefersInstantMotion(media)) return;
    const animation = eyes.animate(
      [
        { transform: 'scaleY(1)', offset: 0, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
        { transform: 'scaleY(0.1)', offset: 0.36, easing: DISCLOSURE_EASE },
        { transform: 'scaleY(1)', offset: 1 },
      ],
      { duration: 220 },
    );
    const stop = bindMotionInterrupt({
      animations: [animation],
      media,
      onInterrupt: () => {
        if (active.current?.animation === animation) active.current = null;
      },
      onFinish: () => {
        if (active.current?.animation === animation) active.current = null;
      },
    });
    active.current = { cancel: stop, animation };
  }, [cancel]);

  return { brandRef, blink };
}
