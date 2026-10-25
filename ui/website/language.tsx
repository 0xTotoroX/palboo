/* [INPUT]: Shared locale and independent website preference.
 * [OUTPUT]: Accessible language control; preserves demos, focus and scroll position.
 * [POS]: Website utility, without a navigation bar. */
import { useEffect } from 'react';
import { useLocale } from '../shared/use-locale';
import { setLocale, tr } from '../shared/i18n.js';
export function SiteLanguage() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === 'en'
        ? 'Palboo — Give your conversations another dimension.'
        : 'Palboo — 让对话，多一维度';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', tr('Palboo，你的 Codex 桌面搭档。'));
  }, [locale]);
  return (
    <button
      type="button"
      className="site-language"
      lang={locale === 'en' ? 'zh-CN' : 'en'}
      aria-label={locale === 'en' ? '切换为简体中文' : 'Switch to English'}
      onClick={() => {
        const next = locale === 'en' ? 'zh-CN' : 'en';
        setLocale(next);
        try {
          localStorage.setItem('palboo-site-language', next);
        } catch {
          /* Keep the current visit usable. */
        }
        const url = new URL(location.href);
        url.searchParams.set('lang', next);
        history.replaceState(history.state, '', url);
      }}
    >
      {locale === 'en' ? '简体中文' : 'English'}
    </button>
  );
}
