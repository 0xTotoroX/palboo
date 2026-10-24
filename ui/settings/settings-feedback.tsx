/* [INPUT]: The edited setting's DOM row and existing request state.
 * [OUTPUT]: Feedback beside its originating control without moving that control or its draft.
 * [POS]: Settings-only presentation; owns no request or saved configuration.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';

export function feedbackTarget(element: Element | null = document.activeElement) {
  if (element?.closest('[data-settings-navigation], .settings-feedback-slot')) return null;
  return (
    element?.closest<HTMLElement>(
      '.settings-entry, .settings-field, .settings-row, .settings-actions, .direction-slots, .settings-choice, [data-settings-feedback-anchor]',
    ) || null
  );
}

export function useFeedbackTarget() {
  const candidate = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return {
    target,
    track(event: SyntheticEvent) {
      if (event.target instanceof Element) candidate.current = feedbackTarget(event.target);
    },
    capture() {
      setTarget(candidate.current || feedbackTarget());
      candidate.current = null;
    },
  };
}

export function NearbyFeedback({
  target,
  children,
}: {
  target?: HTMLElement | null;
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const mounted = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!target?.isConnected) {
      if (mounted.current) {
        mounted.current.remove();
        mounted.current = null;
        setSlot(null);
      }
      return;
    }
    if (mounted.current?.isConnected && mounted.current.previousElementSibling === target) return;
    mounted.current?.remove();
    const node = document.createElement('div');
    node.className = 'settings-feedback-slot';
    target.after(node);
    mounted.current = node;
    setSlot(node);
  });
  useLayoutEffect(() => () => mounted.current?.remove(), []);
  return slot ? createPortal(children, slot) : children;
}
