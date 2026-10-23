/* [INPUT]: URL anchors, saved page preference (legacy mode ignored), shared icons and the Dev source widget.
 * [OUTPUT]: Shared sidebar/compact grouped disclosure with inert closing content, keyboard navigation, legacy/search/invalid-field routing and reading restoration without remounting forms.
 * [POS]: Presentation state only; never changes backend configuration or remounts forms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons/react';
import {
  closeSettingsDrawers,
  revealSettingsDrawer,
  revealSettingsDetail,
} from './settings-drawer';
export const pageTitles = {
  performance: '性能与开关',
  features: '常用开关',
  next: '下一步',
  terminology: '术语释义',
  board: '任务看板',
  bots: 'Grok Bot',
  'model-control': '模型切换',
  model: '模型服务',
  surfaces: '布局与位置',
  appearance: '外观与字体',
  connection: '启动与连接',
  'codex-host': 'CodexHost',
  dev: '开发来源',
};
export type SettingsPage = keyof typeof pageTitles;
export const pageGroups: { title: string; pages: SettingsPage[] }[] = [
  { title: '界面', pages: ['features', 'surfaces', 'appearance'] },
  {
    title: '功能',
    pages: ['next', 'terminology', 'board', 'model-control', 'bots'],
  },
  { title: '系统', pages: ['model', 'connection', 'performance', 'codex-host', 'dev'] },
];
export const pageGroup = (page: SettingsPage) =>
  pageGroups.find((group) => group.pages.includes(page))!;
const aliases: Record<string, SettingsPage> = {
  'settings-simple': 'features',
  'settings-overview': 'features',
  'settings-outline': 'features',
  'settings-model-control': 'model-control',
  'model-organization': 'model-control',
  'settings-next': 'next',
  'settings-grokbot': 'bots',
  'settings-board': 'board',
  'settings-tasks': 'board',
  'settings-directions': 'next',
  'settings-direction-library': 'next',
  'settings-next-display': 'next',
  'settings-prompts': 'next',
  'settings-quick-prompts': 'next',
  'settings-terminology': 'terminology',
  'settings-library': 'terminology',
  'settings-jev-advanced': 'next',
  'settings-model': 'model',
  'settings-limits': 'model',
  'settings-capsule': 'surfaces',
  'settings-fonts': 'appearance',
  'settings-startup': 'connection',
  'settings-codex-host': 'codex-host',
  'settings-dev': 'dev',
};
function targetPage(field: string): SettingsPage | undefined {
  if (aliases[field]) return aliases[field];
  if (
    /^(provider|protocol|base-url|api-key(?:-env)?|model|max-input|max-output|context-scope|timeout)$/.test(
      field,
    )
  )
    return 'model';
  if (/^(font-|theme-|launcher-click-action)/.test(field)) return 'appearance';
  if (
    /^(edge-|placement-|main-|dock-width|sidebar-|window-pinning|settings-window|settings-sidebar)/.test(
      field,
    )
  )
    return 'surfaces';
  if (/^(generation-mode|direction-|jev-|suggestion-)/.test(field)) return 'next';
  return undefined;
}
const legacyTargets: Record<string, string> = {
  'settings-prompts': 'settings-quick-prompts',
  'settings-board': 'settings-tasks',
  'settings-dev': 'settings-dev-content',
};
const storage = (kind: 'localStorage' | 'sessionStorage', key: string) => {
  try {
    return window[kind].getItem(key) || '';
  } catch {
    return '';
  }
};
function remember(kind: 'localStorage' | 'sessionStorage', key: string, value: string) {
  try {
    window[kind].setItem(key, value);
  } catch {}
}
function savedPage(): SettingsPage {
  const value =
    storage('sessionStorage', 'buddy-settings-page') ||
    storage('sessionStorage', 'buddy-settings-detail-page');
  return value in pageTitles ? (value as SettingsPage) : aliases['settings-' + value] || 'features';
}
function fromHash() {
  const [section, field = ''] = location.hash.slice(1).split('/');
  let decoded = field;
  try {
    decoded = decodeURIComponent(field);
  } catch {}
  const fieldPage = targetPage(decoded);
  if (fieldPage) return { page: fieldPage };
  const page =
    aliases[section] ||
    (section.replace(/^settings-/, '') in pageTitles
      ? (section.replace(/^settings-/, '') as SettingsPage)
      : null);
  return page ? { page } : null;
}
let revealedField = 0;
export function revealSettingsField(target: HTMLElement) {
  revealSettingsDetail(target);
  if (!target.id) target.id = `buddy-settings-invalid-${++revealedField}`;
  const owner = target.closest<HTMLElement>('[data-settings-page]')?.dataset.settingsPage;
  if (owner && owner in pageTitles && target.closest('[hidden]')) {
    document.dispatchEvent(
      new CustomEvent('buddy-settings-reveal', { detail: { page: owner, id: target.id } }),
    );
  } else {
    const concealed = !!target.closest('dialog:not([open])');
    revealSettingsDrawer(target).focus({ preventScroll: true });
    if (concealed) requestAnimationFrame(() => reportInvalidField(target));
  }
}
function reportInvalidField(target: HTMLElement) {
  if (
    (target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement) &&
    target.matches(':invalid')
  )
    target.reportValidity();
}
export function useSettingsPage(ready: boolean) {
  const [selection, setSelection] = useState(() => ({
    ...(fromHash() || { page: savedPage() }),
    hash: location.hash,
  }));
  const { page, hash } = selection;
  const [dev, setDev] = useState(false);
  const positions = useRef(new Map<string, number>());
  const current = useRef(selection);
  function select(next: { page: SettingsPage }, hash: string) {
    closeSettingsDrawers();
    positions.current.set(current.current.page, window.scrollY);
    setSelection({ page: next.page, hash });
  }
  function navigate(next: SettingsPage, hash: string) {
    if (location.hash !== hash) history.pushState({ buddySettings: { page: next } }, '', hash);
    select({ page: next }, hash);
  }
  useEffect(() => {
    const change = () => {
      const next = fromHash() || history.state?.buddySettings;
      if (next) select(next, location.hash);
    };
    const reveal = (event: Event) => {
      const { page, id } = (event as CustomEvent<{ page: SettingsPage; id: string }>).detail;
      navigate(page, `#settings-${page}/${encodeURIComponent(id)}`);
    };
    document.addEventListener('buddy-settings-reveal', reveal);
    window.addEventListener('hashchange', change);
    window.addEventListener('popstate', change);
    return () => {
      document.removeEventListener('buddy-settings-reveal', reveal);
      window.removeEventListener('hashchange', change);
      window.removeEventListener('popstate', change);
    };
  }, []);
  useLayoutEffect(() => {
    current.current = selection;
    if (history.state?.buddySettings?.page !== page)
      history.replaceState({ ...history.state, buddySettings: { page } }, '', location.href);
    remember('sessionStorage', 'buddy-settings-page', page);
    window.scrollTo({
      top: positions.current.get(page) || 0,
      behavior: 'instant',
    });
    if (!ready) return;
    const [section, encodedField] = hash.slice(1).split('/');
    let field = encodedField;
    try {
      field = decodeURIComponent(encodedField || '');
    } catch {
      /* Preserve malformed legacy fragments. */
    }
    const target =
      field ||
      legacyTargets[section] ||
      (aliases[section] === page && !(section.replace(/^settings-/, '') in pageTitles)
        ? section
        : '');
    if (!target) return;
    const focusTarget = () => {
      let node = document.getElementById(target);
      if (!node) return false;
      const owner = node.closest<HTMLElement>('[data-settings-page]')?.dataset.settingsPage;
      if (owner && owner in pageTitles && owner !== page) {
        navigate(owner as SettingsPage, `#settings-${owner}/${encodeURIComponent(target)}`);
        return true;
      }
      revealSettingsDetail(node);
      if (node.closest('[hidden]')) return false;
      node = revealSettingsDrawer(node);
      for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (!node.hasAttribute('tabindex') && !node.matches('input,select,button,a'))
        node.tabIndex = -1;
      node.focus({ preventScroll: true });
      node.scrollIntoView({ behavior: 'instant', block: 'center' });
      reportInvalidField(node);
      return true;
    };
    // Detail navigation may synchronously reveal a mounted React field. Run after
    // this commit so its state can settle before focus, including initial deep links.
    let disposed = false;
    const attempt = () => {
      if (!disposed && focusTarget()) observer.disconnect();
    };
    const observer = new MutationObserver(attempt);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
    queueMicrotask(attempt);
    const timer = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [selection, ready]);
  useLayoutEffect(() => {
    let attachedHost: HTMLElement | null = null;
    const attach = () => {
      const host = document.getElementById('buddy-dev-sources'),
        slot = document.getElementById('settings-dev-content');
      if (host && slot) {
        attachedHost = host;
        if (host.parentNode !== slot) {
          slot.append(host);
          const details = host.shadowRoot?.querySelector('details');
          if (details) details.open = true;
        }
        setDev(true);
      }
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      // React may already have detached the slot during a hot reload. Keep the actual node.
      if (attachedHost) document.body.prepend(attachedHost);
    };
  }, []);

  return { page, dev, navigate };
}
export function SettingsOutline({
  page,
  dev = false,
  navigate,
}: {
  page: SettingsPage;
  dev?: boolean;
  navigate: (page: SettingsPage, hash: string) => void;
}) {
  const group = pageGroup(page);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const links = useRef<HTMLDivElement>(null);
  const focusedLink = useRef<HTMLElement | null>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    // Closing links stay painted for the fade but stop accepting focus or input immediately.
    if (links.current) links.current.inert = !open && matchMedia('(max-width: 640px)').matches;
    if (open)
      links.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({
        preventScroll: true,
      });
  }, [open]);
  useEffect(() => setOpen(false), [page]);
  useEffect(() => {
    // Keep this threshold aligned with settings-layout.css.
    const narrow = matchMedia('(max-width: 640px)');
    const resize = () => {
      // CSS can hide the focused link before the media-query event reaches React.
      const hiddenFocus =
        document.activeElement === document.body &&
        focusedLink.current &&
        !focusedLink.current.getClientRects().length;
      if (links.current) links.current.inert = narrow.matches;
      if (root.current?.contains(document.activeElement) || hiddenFocus) {
        const target = narrow.matches
          ? trigger.current
          : links.current?.querySelector<HTMLElement>('[aria-current="page"]');
        target?.focus({ preventScroll: true });
      }
      setOpen(false);
    };
    narrow.addEventListener('change', resize);
    return () => narrow.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <nav
      ref={root}
      aria-label="设置分类"
      className="settings-nav"
      data-open={open}
      data-settings-navigation
      onFocusCapture={(event) => (focusedLink.current = event.target)}
      onBlurCapture={(event) => {
        if (event.relatedTarget || event.target.getClientRects().length) focusedLink.current = null;
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="settings-nav-trigger"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="settings-nav-parent">{group.title}</span>
        <span className="settings-nav-slash" aria-hidden="true">
          /
        </span>
        <span className="settings-nav-current">{pageTitles[page]}</span>
        <Icon name="chevron-down" />
      </button>
      <div
        id={menuId}
        ref={links}
        className="settings-category-links"
        onKeyDown={(event) => {
          if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll('a'));
          const index = items.indexOf(document.activeElement as HTMLAnchorElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus({ preventScroll: true });
          items[next]?.scrollIntoView({ block: 'nearest' });
        }}
      >
        {pageGroups.map((item) => (
          <section
            key={item.title}
            className="settings-nav-group"
            data-active={item === group}
            aria-label={item.title}
          >
            <h2>{item.title}</h2>
            <div className="settings-nav-children">
              {item.pages
                .filter((id) => id !== 'dev' || dev || page === 'dev')
                .map((id) => (
                  <a
                    key={id}
                    href={`#settings-${id}`}
                    aria-current={page === id ? 'page' : undefined}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      if (open) close();
                      navigate(id, event.currentTarget.hash);
                    }}
                  >
                    <span>{pageTitles[id]}</span>
                  </a>
                ))}
            </div>
          </section>
        ))}
      </div>
    </nav>
  );
}
