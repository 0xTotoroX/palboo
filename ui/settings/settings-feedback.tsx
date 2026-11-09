/* [INPUT]: Existing request state, active settings page and modal scope.
 * [OUTPUT]: One fixed feedback area; controls and drafts never move when feedback changes.
 * [POS]: Settings-only presentation; owns no request or saved configuration.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';

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

const FeedbackScope = createContext(false);
function reconcileFeedback() {
  const center = document.getElementById('settings-feedback-center');
  const seen = new Set<string>();
  for (const item of [...(center?.children || [])].reverse()) {
    if (!(item instanceof HTMLElement)) continue;
    const text = item.querySelector('[data-feedback-content]')?.textContent?.trim() || '';
    const duplicate = !item.hidden && seen.has(text);
    item.style.display = duplicate ? 'none' : '';
    if (!item.hidden) seen.add(text);
  }
}
export function NearbyFeedback(props: { target?: HTMLElement | null; children: ReactNode }) {
  return useContext(FeedbackScope) ? <>{props.children}</> : <FeedbackRegion {...props} />;
}
function FeedbackRegion({
  target,
  children,
}: {
  target?: HTMLElement | null;
  children: ReactNode;
}) {
  const [slot] = useState(() => document.createElement('div'));
  const marker = useRef<HTMLSpanElement>(null);
  const signature = useRef('');
  const expires = useRef(0);
  useLayoutEffect(() => {
    const content = slot.querySelector<HTMLElement>('[data-feedback-content]');
    const text = content?.textContent?.trim() || '';
    if (!text || slot.dataset.dismissed === text) {
      slot.remove();
      reconcileFeedback();
      return;
    }
    let center = document.getElementById('settings-feedback-center');
    if (!center) {
      center = document.createElement('aside');
      center.id = 'settings-feedback-center';
    }
    center.setAttribute('aria-label', tr('操作反馈'));
    const place = () => {
      const host = document.querySelector('.settings-app') || document.body;
      if (center.parentElement !== host) host.append(center);
      const scope = marker.current?.parentElement;
      const hidden =
        !!scope?.closest('[hidden], dialog:not([open])') ||
        !!content?.firstElementChild?.hasAttribute('hidden');
      if (slot.hidden !== hidden) slot.hidden = hidden;
      reconcileFeedback();
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'hidden'],
    });
    slot.className = 'settings-feedback-item';
    // A persistent error must remain reachable when another operation succeeds.
    slot.dataset.failed = String(!!content?.querySelector('[role="alert"]'));
    const changed = signature.current !== text;
    if (changed) {
      signature.current = text;
      expires.current = Date.now() + 6000;
    }
    if (changed || slot.parentElement !== center) {
      center.append(slot);
    }
    reconcileFeedback();
    const actionable = !!content?.querySelector('button');
    slot.dataset.actionable = String(actionable);
    const timer =
      slot.dataset.failed === 'true' || actionable
        ? undefined
        : window.setTimeout(
            () => {
              slot.dataset.dismissed = text;
              slot.remove();
              reconcileFeedback();
            },
            Math.max(0, expires.current - Date.now()),
          );
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  });
  useLayoutEffect(
    () => () => {
      slot.remove();
      reconcileFeedback();
    },
    [slot],
  );
  return (
    <>
      <span hidden ref={marker} data-feedback-source />
      {createPortal(
        <>
          <div data-feedback-content>
            <FeedbackScope.Provider value={true}>{children}</FeedbackScope.Provider>
          </div>
          <button
            type="button"
            className="settings-feedback-dismiss"
            aria-label={tr('关闭提示')}
            onClick={() => {
              for (const item of document.querySelectorAll<HTMLElement>(
                '.settings-feedback-item',
              )) {
                if (
                  item.querySelector('[data-feedback-content]')?.textContent?.trim() ===
                  signature.current
                ) {
                  item.dataset.dismissed = signature.current;
                  item.remove();
                }
              }
              reconcileFeedback();
            }}
          >
            <Icon name="close" />
          </button>
        </>,
        slot,
      )}
    </>
  );
}
