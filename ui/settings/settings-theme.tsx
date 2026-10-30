import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Authenticated host appearance, shared icons, typography and revision-checked theme preferences.
 * [OUTPUT]: Icon-only theme entry with an accessible current choice and a compact animated menu with retained, inert closing options.
 * [POS]: Settings-only preference; revision-checked Palboo persistence, never writes Codex appearance.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons/react';
import type { AppearanceSettings, HostSettingsAppearance } from '../shared/contracts';
import type { Typography } from '../shared/typography';
import { useTypography } from './use-typography';
import { useHostAppearance } from './use-host-appearance';
import { request } from './api';
import { migrateBrowserBrandStorage } from '../shared/brand-storage.js';

type Theme = 'light' | 'dark';
type Preference = Theme | 'codex';
const storageKey = 'palboo-settings-theme';
const sourceKey = 'palboo-settings-style';
type Source = 'chatgpt' | 'palboo';
const sources = [
  ['chatgpt', '跟随 ChatGPT'],
  ['palboo', 'Palboo 原有'],
] as const;
const options = [
  ['codex', '自动'],
  ['light', '浅色'],
  ['dark', '深色'],
] as const;
const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

function readPreference(): Preference {
  try {
    migrateBrowserBrandStorage();
    const saved = localStorage.getItem(storageKey);
    return isTheme(saved) ? saved : 'codex';
  } catch {
    return 'codex';
  }
}

export function SettingsTheme({
  codexTheme,
  hostAppearance,
  typography,
  appearance,
  notify,
}: {
  codexTheme?: string | null;
  hostAppearance?: HostSettingsAppearance | null;
  typography?: Typography | null;
  appearance?: AppearanceSettings;
  notify?: (message: string, failed?: boolean) => void;
}) {
  useLocale();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const acceptedRevision = useRef(-1);
  const persisted = useRef(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const [preference, setPreference] = useState<Preference>(readPreference);
  const [source, setSource] = useState<Source>(() => {
    try {
      return localStorage.getItem(sourceKey) === 'palboo' ? 'palboo' : 'chatgpt';
    } catch {
      return 'chatgpt';
    }
  });
  useEffect(() => {
    const value = appearance?.settingsTheme;
    if (value && appearance.revision >= acceptedRevision.current) {
      persisted.current = true;
      acceptedRevision.current = appearance.revision;
      remember(value);
    }
    if (appearance && appearance.revision >= acceptedRevision.current) {
      acceptedRevision.current = appearance.revision;
      rememberSource(appearance.settingsStyle || 'chatgpt');
    }
  }, [appearance?.settingsTheme, appearance?.settingsStyle, appearance?.revision]);
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const lastCodexTheme = useRef<Theme | null>(null);
  const theme =
    preference === 'codex'
      ? isTheme(codexTheme)
        ? codexTheme
        : lastCodexTheme.current || systemTheme
      : preference;
  const hostTypography = useHostAppearance(hostAppearance, theme, source);
  useTypography(hostTypography || typography, hostTypography ? undefined : appearance?.typography);

  useLayoutEffect(() => {
    if (isTheme(codexTheme)) lastCodexTheme.current = codexTheme;
    document.documentElement.dataset.settingsTheme = theme;
    document.documentElement.dataset.settingsThemeMode = preference;
  }, [codexTheme, preference, theme]);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const syncSystem = () => setSystemTheme(media.matches ? 'dark' : 'light');
    const syncStorage = (event: StorageEvent) => {
      if (event.key === sourceKey || event.key === null) {
        if (!appearance) {
          try {
            setSource(localStorage.getItem(sourceKey) === 'palboo' ? 'palboo' : 'chatgpt');
          } catch {
            /* Keep the current preference. */
          }
        }
      }
      if (event.key !== storageKey && event.key !== null) return;
      if (persisted.current && !['codex', 'light', 'dark'].includes(event.newValue || '')) return;
      setPreference(readPreference());
    };
    syncSystem();
    media.addEventListener('change', syncSystem);
    window.addEventListener('storage', syncStorage);
    return () => {
      media.removeEventListener('change', syncSystem);
      window.removeEventListener('storage', syncStorage);
    };
  }, [!!appearance]);

  function remember(next: Preference) {
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Keep the current tab usable when browser storage is unavailable.
    }
  }

  function rememberSource(next: Source) {
    setSource(next);
    try {
      localStorage.setItem(sourceKey, next);
    } catch {
      /* Keep the current tab usable. */
    }
  }

  async function select(
    next: Preference | Source,
    kind: 'settingsTheme' | 'settingsStyle' = 'settingsTheme',
  ) {
    if (pending.current) return;
    if (kind === 'settingsTheme' && next === preference && persisted.current) return;
    if (kind === 'settingsStyle' && next === source && appearance?.settingsStyle === next) return;
    if (!appearance)
      return kind === 'settingsStyle'
        ? rememberSource(next as Source)
        : remember(next as Preference);
    pending.current = true;
    setSaving(true);
    try {
      const latest = await request<AppearanceSettings>('appearance');
      const saved = await request<AppearanceSettings>('appearance', {
        expectedRevision: latest.revision,
        [kind]: next,
      });
      persisted.current = true;
      acceptedRevision.current = saved.revision;
      remember(saved.settingsTheme || preference);
      rememberSource(saved.settingsStyle || source);
    } catch (error) {
      notify?.(error instanceof Error ? error.message : tr('主题保存失败，请重试。'), true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const label = tr(options.find(([value]) => value === preference)![1]);
  const symbol = (value: Preference) =>
    value === 'codex' ? 'theme-auto' : value === 'light' ? 'sun' : 'moon';
  return (
    <div
      className="settings-theme"
      ref={root}
      data-settings-navigation
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="settings-theme-trigger"
        aria-label={tr('设置页主题：{{label}}', { label: label })}
        title={`${tr(source === 'chatgpt' ? '跟随 ChatGPT' : 'Palboo 原有')} · ${label}`}
        disabled={saving}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        <Icon name={symbol(preference)} />
      </button>
      <div
        id={menuId}
        ref={menu}
        className="settings-theme-menu settings-menu-motion"
        role="group"
        aria-label={tr('设置页主题')}
        hidden={!open}
        inert={!open}
        aria-hidden={!open}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}
      >
        <div role="group" aria-label={tr('主题来源')}>
          {sources.map(([value, name]) => (
            <button
              key={value}
              type="button"
              aria-label={tr(name)}
              aria-pressed={source === value}
              disabled={saving}
              onClick={() => {
                void select(value, 'settingsStyle');
              }}
            >
              <span>{tr(name)}</span>
              <Icon name="check" className="settings-theme-check" />
            </button>
          ))}
        </div>
        <div className="settings-theme-divider" />
        {options.map(([value, name]) => (
          <button
            key={value}
            type="button"
            aria-label={tr(name)}
            aria-pressed={preference === value}
            disabled={saving}
            onClick={() => {
              void select(value);
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            <Icon name={symbol(value)} />
            <span>{tr(name)}</span>
            <Icon name="check" className="settings-theme-check" />
          </button>
        ))}
      </div>
    </div>
  );
}
