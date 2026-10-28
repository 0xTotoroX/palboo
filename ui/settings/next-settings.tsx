import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Shared settings editor and appearance preferences.
 * [OUTPUT]: Next-step display, generation and direction settings; quick prompts have their own page.
 * [POS]: Settings presentation only; retains the original save queue.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { Card } from './components/ui/card';
import type { View } from './api';
import type { SettingsEditor } from './use-settings-form';
import { DirectionSettings } from './direction-settings';
import { PanelSettings } from './panel-settings';
export function NextSettings({
  editor,
  appearance,
}: {
  editor: SettingsEditor;
  appearance?: View['panelPreferences'];
}) {
  useLocale();
  if (!editor.form || !editor.saved) return null;
  return (
    <div data-settings-page="next">
      <Card id="settings-next-display" aria-labelledby="next-display-title">
        <h2 id="next-display-title">{tr('显示与操作')}</h2>
        <PanelSettings value={appearance} section="next" />
      </Card>
      <DirectionSettings editor={editor} />
    </div>
  );
}
