/* [INPUT]: Current host eligibility, theme and restricted website launcher callbacks.
 * [OUTPUT]: One rail icon and an on-demand popover using the real SitesView.
 * [POS]: Navigation only; no note bodies, preferences, timers or extra feature owner.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createRoot } from 'react-dom/client';
import { SitesView } from '../../features/sites/view';
import { iconSvg } from '../../shared/icons/index.js';
import { tr, subscribeLocale } from '../../shared/i18n.js';
import type { SiteState } from '../../shared/web-library';

export type SitesLauncherOptions = {
  enabled: boolean;
  theme?: string;
  colors?: Record<string, string>;
  request: (id?: string, signal?: AbortSignal) => Promise<SiteState | unknown>;
  settings: () => void;
};
export function createSitesLauncher(anchor: HTMLElement, options: () => SitesLauncherOptions) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'palboo-sites-launcher';
  button.innerHTML = iconSvg('feature-sites');
  button.setAttribute('aria-haspopup', 'dialog');
  const popover = document.createElement('div');
  popover.setAttribute('popover', 'auto');
  popover.setAttribute('role', 'dialog');
  popover.className = 'palboo-sites-popover';
  const style = document.createElement('style');
  style.textContent = `
    .palboo-sites-launcher[hidden] {display:none;}
    .palboo-sites-launcher svg {width:18px;height:18px;}
    .palboo-sites-popover {position:fixed;inset:auto;margin:0;padding:8px;box-sizing:border-box;width:248px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:auto;border:1px solid var(--csw-divider,#8884);border-radius:10px;background:var(--sites-paper,#fff);color:var(--sites-ink,#222);font:14px/1.45 system-ui;}
    .palboo-sites-popover button {width:100%;height:auto;min-height:34px;border-radius:6px;}
    .palboo-sites-popover button:focus-visible {outline:1px solid currentColor;outline-offset:-2px;}
    .palboo-sites-popover .sites-view {gap:8px;}
    .palboo-sites-popover .sites-view button {justify-content:flex-start;padding:7px 8px;font:inherit;}
    .palboo-sites-popover .sites-view input {font:inherit;}
    .palboo-sites-popover [role=alert] {padding:8px;margin:0;overflow-wrap:anywhere;}
    .palboo-sites-settings {display:flex;align-items:center;gap:10px;font:inherit;color:var(--csw-muted);padding:7px 8px;margin-top:4px;}
    .palboo-sites-settings svg {width:18px;height:18px;}
  `;
  const content = document.createElement('div');
  popover.append(content);
  anchor.after(button, popover, style);
  let root: ReturnType<typeof createRoot> | null = null;
  let controller: AbortController | null = null;
  let destroyed = false;
  const events = new AbortController();
  function place() {
    const box = button.getBoundingClientRect();
    const size = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(box.right + 8, innerWidth - size.width - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(box.top, innerHeight - size.height - 8))}px`;
  }
  function close(focus = false) {
    controller?.abort();
    controller = null;
    if (popover.matches(':popover-open')) popover.hidePopover();
    button.setAttribute('aria-expanded', 'false');
    root?.unmount();
    root = null;
    if (focus) button.focus();
  }
  async function show() {
    if (destroyed || !options().enabled) return;
    close();
    const request = new AbortController();
    controller = request;
    root = createRoot(content);
    root.render(<SitesView state={null} open={async () => {}} />);
    popover.showPopover();
    button.setAttribute('aria-expanded', 'true');
    place();
    try {
      const state = (await options().request(undefined, request.signal)) as SiteState;
      if (request.signal.aborted || destroyed) return;
      root?.render(
        <>
          <SitesView
            state={state}
            open={async (id) => {
              await options().request(id, request.signal);
              if (!request.signal.aborted && !destroyed) close(true);
            }}
          />
          {!state.configured && (
            <button
              className="palboo-sites-settings"
              onClick={() => {
                close();
                options().settings();
              }}
            >
              {tr('选择笔记文件夹')}
            </button>
          )}
        </>,
      );
    } catch (e) {
      if (!request.signal.aborted && !destroyed)
        root?.render(
          <>
            <p role="alert">{String((e as Error).message)}</p>
            <button onClick={() => void show()}>{tr('重试')}</button>
          </>,
        );
    }
  }
  function update() {
    const value = options();
    button.hidden = !value.enabled;
    button.title = tr('阅读与网站');
    button.setAttribute('aria-label', tr('阅读与网站'));
    popover.setAttribute('aria-label', tr('阅读与网站'));
    const colors = value.colors || {};
    popover.style.setProperty(
      '--sites-paper',
      colors['surface-opaque'] || (value.theme === 'dark' ? '#252525' : '#fff'),
    );
    popover.style.setProperty(
      '--sites-ink',
      colors.text || (value.theme === 'dark' ? '#eee' : '#222'),
    );
    popover.style.setProperty(
      '--csw-muted',
      colors.muted || (value.theme === 'dark' ? '#aaa' : '#666'),
    );
    popover.style.setProperty(
      '--csw-hover',
      colors.hover || (value.theme === 'dark' ? '#ffffff12' : '#00000009'),
    );
    popover.style.setProperty('--csw-divider', colors.divider || '#8884');
    if (!value.enabled) close();
    else if (popover.matches(':popover-open')) place();
  }
  button.addEventListener(
    'click',
    (e) => {
      e.stopPropagation();
      if (popover.matches(':popover-open')) close();
      else void show();
    },
    { signal: events.signal },
  );
  popover.addEventListener(
    'toggle',
    () => {
      if (!popover.matches(':popover-open')) close();
    },
    { signal: events.signal },
  );
  popover.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    },
    { signal: events.signal },
  );
  window.addEventListener('resize', () => close(), { signal: events.signal });
  const observer = new ResizeObserver(place);
  observer.observe(content);
  const unsubscribe = subscribeLocale(update);
  update();
  return {
    update,
    destroy() {
      destroyed = true;
      close();
      events.abort();
      observer.disconnect();
      unsubscribe();
      button.remove();
      popover.remove();
      style.remove();
    },
  };
}
