/* [INPUT]: Website-only light/dark preference.
 * [OUTPUT]: One-click theme toggle; colors update without remounting demos.
 * [POS]: Local website utility; never reads or changes App or host preferences.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useLayoutEffect, useState } from 'react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { Icon } from '../shared/icons/react';

type Theme = 'light' | 'dark';
const preferenceKey = 'palboo-site-theme';
const normalize = (value: string | null): Theme => (value === 'dark' ? 'dark' : 'light');

export function SiteTheme() {
  useLocale();
  const [preference, setPreference] = useState<Theme>(() => {
    try {
      return normalize(localStorage.getItem(preferenceKey));
    } catch {
      return 'light';
    }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.siteTheme = preference;
    document.documentElement.style.colorScheme = preference;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', preference === 'dark' ? '#19191b' : '#fdfcf9');
  }, [preference]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null)
        setPreference(normalize(event.newValue));
    };
    addEventListener('storage', sync);
    return () => removeEventListener('storage', sync);
  }, []);
  const label = tr(preference === 'dark' ? '切换为浅色' : '切换为深色');
  return (
    <button
      type="button"
      className="site-theme"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = preference === 'dark' ? 'light' : 'dark';
        setPreference(next);
        try {
          localStorage.setItem(preferenceKey, next);
        } catch {
          /* Keep this visit usable when browser storage is unavailable. */
        }
      }}
    >
      <Icon name={preference === 'dark' ? 'moon' : 'sun'} />
    </button>
  );
}
