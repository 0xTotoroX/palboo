/* [INPUT]: Appearance and startup preferences, app mode and update APIs.
 * [OUTPUT]: Language, startup and app updates in one place; development options are disclosed on demand.
 * [POS]: System settings presentation; reuses the existing independent save and update flows.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { AppModeSettings } from './app-mode-settings';
import { Card } from './components/ui/card';
import { LanguageSettings } from './language-settings';
import { StartupSettings } from './startup-settings';
import type { View } from './api';
import type { SettingsEditor } from './use-settings-form';

export function GeneralSettings({
  live,
  view,
  editor,
}: {
  live: boolean;
  view: View | null;
  editor: SettingsEditor;
}) {
  useLocale();
  return (
    <>
      <Card id="settings-startup">
        <h2>{tr('语言与启动')}</h2>
        <LanguageSettings value={view?.panelPreferences} />
        <StartupSettings
          value={view?.panelPreferences}
          live={live}
          outsideAvailable={editor.saved?.popoutSupported === true}
        />
      </Card>
      <AppModeSettings live={live} editor={editor} />
    </>
  );
}
