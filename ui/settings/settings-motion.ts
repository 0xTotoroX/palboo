/* [INPUT]: Presentation identity, header geometry, input modality and host motion preferences.
 * [OUTPUT]: Shared timing/reduced-motion helpers, sticky offsets and interruptible navigation/scene and provider-field transitions; keyboard and reduced motion stay immediate.
 * [POS]: Settings-only motion, never remounts controls or changes configuration.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useLayoutEffect, useRef } from 'react';

export function reducedMotion(media: MediaQueryList) {
  return media.matches || document.documentElement.dataset.settingsReducedMotion === 'true';
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

export function useSettingsMotion(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>('.settings-header');
    const pointer = () => (root.dataset.settingsInput = 'pointer');
    const keyboard = () => {
      root.dataset.settingsInput = 'keyboard';
      ref.current?.getAnimations().forEach((animation) => animation.cancel());
    };
    const measure = () => {
      if (header)
        root.style.setProperty('--settings-sticky-offset', `${header.offsetHeight + 18}px`);
    };
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    measure();
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', keyboard, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', keyboard, true);
      delete root.dataset.settingsInput;
      root.style.removeProperty('--settings-sticky-offset');
    };
  }, []);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion(reduce) || document.documentElement.dataset.settingsInput === 'keyboard')
      return;
    const animation = element.animate(
      [
        { opacity: 0.65, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      motionTiming(element, 220),
    );
    const cancel = () => animation.cancel();
    reduce.addEventListener('change', cancel);
    window.addEventListener('settings-motion-change', cancel);
    return () => {
      cancel();
      reduce.removeEventListener('change', cancel);
      window.removeEventListener('settings-motion-change', cancel);
    };
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
    if (reducedMotion(reduce) || document.documentElement.dataset.settingsInput === 'keyboard')
      return;
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
    const cancel = () => animations.forEach((animation) => animation.cancel());
    reduce.addEventListener('change', cancel);
    window.addEventListener('settings-motion-change', cancel);
    window.addEventListener('keydown', cancel, true);
    return () => {
      cancel();
      reduce.removeEventListener('change', cancel);
      window.removeEventListener('settings-motion-change', cancel);
      window.removeEventListener('keydown', cancel, true);
    };
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
    if (
      !root ||
      !before ||
      before === provider ||
      reducedMotion(reduce) ||
      document.documentElement.dataset.settingsInput === 'keyboard'
    )
      return;
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
    const cancel = () => animations.forEach((animation) => animation.cancel());
    reduce.addEventListener('change', cancel);
    window.addEventListener('settings-motion-change', cancel);
    window.addEventListener('keydown', cancel, true);
    return () => {
      cancel();
      reduce.removeEventListener('change', cancel);
      window.removeEventListener('settings-motion-change', cancel);
      window.removeEventListener('keydown', cancel, true);
    };
  }, [provider]);
  return ref;
}
