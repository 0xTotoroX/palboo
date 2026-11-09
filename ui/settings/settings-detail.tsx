import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Mounted settings content and requests to enter or return from a detail page.
 * [OUTPUT]: Full content-area detail with one return action, preserving native form ownership, focus and scroll.
 * [POS]: Settings presentation only; the parent page owns navigation history and persistence.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './components/ui/button';
import { Icon } from '../shared/icons/react';

const openEvent = 'buddy-settings-detail-open';
const closeEvent = 'buddy-settings-detail-close';
export const settingsDetailRouteEvent = 'buddy-settings-detail-route';
export type SettingsDetailRoute = {
  action: 'open' | 'back';
  entry: HTMLElement;
  target: HTMLElement;
};
type DetailClose = { except?: HTMLElement; focus?: boolean; navigate?: boolean };

export function revealSettingsDetail(target: HTMLElement) {
  target.dispatchEvent(new Event('buddy-settings-detail-reveal', { bubbles: true }));
}
export function closeSettingsDetails({ except, focus = true, navigate = true }: DetailClose = {}) {
  for (const entry of document.querySelectorAll<HTMLElement>('[data-settings-detail-open]')) {
    if (entry !== except)
      entry.dispatchEvent(new CustomEvent(closeEvent, { detail: { focus, navigate } }));
  }
}
export function showSettingsDetail(target: HTMLElement, navigate = true) {
  revealSettingsDetail(target);
  const entry = target.closest<HTMLElement>('[data-settings-detail]');
  if (!entry) return target;
  entry.dispatchEvent(new CustomEvent(openEvent, { detail: { target, navigate } }));
  return entry === target
    ? entry.querySelector<HTMLElement>('[data-settings-detail-heading]') || target
    : target;
}
function route(action: SettingsDetailRoute['action'], entry: HTMLElement, target = entry) {
  return !document.dispatchEvent(
    new CustomEvent<SettingsDetailRoute>(settingsDetailRouteEvent, {
      cancelable: true,
      detail: { action, entry, target },
    }),
  );
}

export function SettingsDetail({
  id,
  title,
  children,
  toolbar,
  footer,
  hidden = false,
  triggerLabel,
  hideTrigger = false,
  onClose,
  compact = false,
}: {
  id?: string;
  title: string;
  children: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  hidden?: boolean;
  triggerLabel?: string;
  hideTrigger?: boolean;
  onClose?: () => void;
  compact?: boolean;
}) {
  useLocale();
  const generated = useId();
  const entryId = id || `settings-detail-${generated}`;
  const panelId = `${entryId}-detail`;
  const entry = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const parentScroll = useRef(0);
  const detailScroll = useRef(0);
  const afterClose = useRef(onClose);
  afterClose.current = onClose;
  const [open, setOpen] = useState(false);

  function show(target: HTMLElement, navigate: boolean) {
    const root = entry.current;
    const view = panel.current;
    if (!root || !view || !view.hidden || root.closest('[hidden]')) return;
    if (navigate && route('open', root, target)) return;
    closeSettingsDetails({ except: root, focus: false, navigate: false });
    parentScroll.current = window.scrollY;
    // Reveal synchronously so deep links and native validation can focus the original control.
    view.hidden = false;
    root.setAttribute('data-settings-detail-open', '');
    setOpen(true);
    window.scrollTo({ top: detailScroll.current, behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }
  function close({ focus = true, navigate = true } = {}) {
    const root = entry.current;
    const view = panel.current;
    if (!root || !view || view.hidden) return;
    if (navigate && route('back', root)) return;
    detailScroll.current = window.scrollY;
    for (const confirmation of view.querySelectorAll<HTMLDialogElement>('dialog[open]'))
      confirmation.close();
    // Navigating away must not commit a draft through a blur with no related target.
    if (view.contains(document.activeElement)) back.current?.focus({ preventScroll: true });
    view.hidden = true;
    root.removeAttribute('data-settings-detail-open');
    setOpen(false);
    if (focus) {
      window.scrollTo({ top: parentScroll.current, behavior: 'instant' });
      trigger.current?.focus({ preventScroll: true });
    }
    afterClose.current?.();
  }
  useLayoutEffect(() => {
    const root = entry.current;
    const openListener = (event: Event) => {
      const { target, navigate } = (
        event as CustomEvent<{ target: HTMLElement; navigate: boolean }>
      ).detail;
      show(target, navigate);
    };
    const closeListener = (event: Event) => close((event as CustomEvent<DetailClose>).detail);
    root?.addEventListener(openEvent, openListener);
    root?.addEventListener(closeEvent, closeListener);
    return () => {
      root?.removeEventListener(openEvent, openListener);
      root?.removeEventListener(closeEvent, closeListener);
    };
  }, []);
  useLayoutEffect(() => {
    if (hidden) close({ focus: false, navigate: false });
  }, [hidden]);
  useLayoutEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);

  return (
    <section
      id={entryId}
      ref={entry}
      hidden={hidden}
      data-settings-detail
      className="settings-detail-entry"
      data-compact={compact || undefined}
    >
      {!hideTrigger && (
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          className="settings-detail-trigger"
          data-settings-navigation
          aria-label={triggerLabel || title}
          aria-controls={panelId}
          onClick={() => entry.current && show(entry.current, true)}
        >
          <span>{triggerLabel || title}</span>
          <Icon name="chevron-right" />
        </Button>
      )}
      <section
        ref={panel}
        id={panelId}
        hidden={!open}
        className="settings-detail"
        data-settings-detail-panel
        aria-labelledby={`${panelId}-title`}
        tabIndex={-1}
      >
        <header className="settings-detail-header" data-settings-navigation>
          <Button
            ref={back}
            type="button"
            variant="ghost"
            className="settings-detail-back"
            data-settings-detail-back
            data-settings-navigation
            onClick={() => close()}
          >
            <Icon name="chevron-right" />
            {tr('返回设置')}
          </Button>
          <h1
            ref={heading}
            id={`${panelId}-title`}
            className="settings-page-title"
            tabIndex={-1}
            data-settings-detail-heading
          >
            {title}
          </h1>
        </header>
        {toolbar && <div className="settings-detail-toolbar">{toolbar}</div>}
        <div className="settings-detail-content">{children}</div>
        {footer && <div className="settings-detail-footer">{footer}</div>}
      </section>
    </section>
  );
}
