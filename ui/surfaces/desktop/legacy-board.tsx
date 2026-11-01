/* [INPUT]: Local authenticated HTTP/font transport and reusable Board view.
 * [OUTPUT]: Standalone task window entry. [POS]: Board desktop/browser bootstrap.
 * [PROTOCOL]: Keep desktop/AGENTS.md in sync. */
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { request, useCompanion } from '../../settings/api';
import { setLocale, tr } from '../../shared/i18n.js';
import { useTypography } from '../../settings/use-typography';
import { surfaceTypography, resolveTypography } from '../../shared/typography';
import { useHostFonts } from '../../settings/use-host-fonts';
import { useLocale } from '../../shared/use-locale';
import { Board } from '../../features/board/app';
import '../../shared/tokens.css';
import '../../features/board/styles.css';
function DesktopBoard() {
  const { view } = useCompanion();
  const locale = useLocale();
  const preferences = surfaceTypography(
    'desktop',
    view?.panelPreferences.surfaceTypography,
    view?.panelPreferences.typography,
  );
  const typography = useTypography(view?.panelTypography, preferences);
  useHostFonts(resolveTypography(typography, preferences).fontFamily);
  useEffect(() => {
    document.documentElement.style.setProperty('--board-font-size', 'var(--buddy-type-size)');
    return () => {
      document.documentElement.style.removeProperty('--board-font-size');
    };
  }, []);
  useEffect(() => {
    if (view?.panelPreferences)
      setLocale(view.panelPreferences.language || 'system', view.systemLanguage);
  }, [view?.panelPreferences.language, view?.systemLanguage]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = tr('Palboo · 任务看板');
  }, [locale]);
  return <Board request={request} />;
}
createRoot(document.getElementById('root')!).render(<DesktopBoard />);
