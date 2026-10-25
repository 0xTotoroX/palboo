/* [INPUT]: Website-only appearance preference and operating-system color scheme.
 * [OUTPUT]: Light/dark/system picker; resolved colors update without remounting demos.
 * [POS]: Local website utility; never reads or changes App or host preferences.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useLayoutEffect, useState } from 'react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { Icon } from '../shared/icons/react';

type Theme = 'system' | 'light' | 'dark';
const preferenceKey = 'palboo-site-theme';
const normalize = (value: string | null): Theme =>
  value === 'light' || value === 'dark' ? value : 'system';

export function SiteTheme() {
  useLocale();
  const [preference, setPreference] = useState<Theme>(() => {
    try {
      return normalize(localStorage.getItem(preferenceKey));
    } catch {
      return 'system';
    }
  });
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      document.documentElement.dataset.siteTheme = theme;
      document.documentElement.style.colorScheme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'dark' ? '#19191b' : '#fdfcf9');
    };
    apply();
    if (preference !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null)
        setPreference(normalize(event.newValue));
    };
    addEventListener('storage', sync);
    return () => removeEventListener('storage', sync);
  }, []);
  const label = tr(preference === 'system' ? '跟随系统' : preference === 'dark' ? '深色' : '浅色');
  return (
    <label className="site-theme" title={`${tr('主题')} · ${label}`}>
      <Icon
        name={preference === 'system' ? 'theme-auto' : preference === 'dark' ? 'moon' : 'sun'}
      />
      <select
        aria-label={tr('主题')}
        value={preference}
        onChange={(event) => {
          const next = normalize(event.target.value);
          setPreference(next);
          try {
            localStorage.setItem(preferenceKey, next);
          } catch {
            /* Keep this visit usable when browser storage is unavailable. */
          }
        }}
      >
        <option value="light">{tr('浅色')}</option>
        <option value="dark">{tr('深色')}</option>
        <option value="system">{tr('跟随系统')}</option>
      </select>
    </label>
  );
}
