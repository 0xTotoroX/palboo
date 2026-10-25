/* [INPUT]: Local authenticated HTTP transport and reusable Board view.
 * [OUTPUT]: Standalone task window entry. [POS]: Board desktop/browser bootstrap.
 * [PROTOCOL]: Keep desktop/AGENTS.md in sync. */
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { request, useCompanion } from '../../settings/api';
import { setLocale, tr } from '../../shared/i18n.js';
import { useLocale } from '../../shared/use-locale';
import { Board } from '../../features/board/app';
import '../../shared/tokens.css';
import '../../features/board/styles.css';
function DesktopBoard() {
  const { view } = useCompanion();
  const locale = useLocale();
  useEffect(() => {
    if (view?.panelPreferences) setLocale(view.panelPreferences.language || 'system');
  }, [view?.panelPreferences.language]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = tr('Palboo · 任务看板');
  }, [locale]);
  return <Board request={request} />;
}
createRoot(document.getElementById('root')!).render(<DesktopBoard />);
