import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Existing appearance preferences and revision-checked settings API.
 * [OUTPUT]: Persisted single-click, double-click and context-menu actions for the eyes launcher.
 * [POS]: Shared web/plugin settings control; no navigation on preference change.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useState } from 'react';
import { request } from './api';
import { Field, Feedback } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';
import type { AppearanceSettings } from '../shared/contracts';
export function LauncherSettings({
  value,
  outsideAvailable,
}: {
  value?: AppearanceSettings;
  outsideAvailable: boolean;
}) {
  useLocale();
  const [prefs, setPrefs] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (value)
      setPrefs((current) => (!current || value.revision >= current.revision ? value : current));
  }, [value]);
  async function change(key: string, action: string) {
    if (!prefs || busy) return;
    setBusy(true);
    setError('');
    try {
      setPrefs(
        await request<AppearanceSettings>('appearance', {
          expectedRevision: prefs.revision,
          [key]: action,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      try {
        setPrefs(await request<AppearanceSettings>('appearance'));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-section">
      {(
        [
          ['launcherAction', 'launcher-click-action', '眼睛单击', 'inside'],
          ['launcherDoubleAction', 'launcher-double-action', '眼睛双击', 'toggle'],
          ['launcherContextAction', 'launcher-context-action', '眼睛右键', 'settings'],
        ] as const
      ).map(([key, id, label, fallback]) => (
        <Field key={key} id={id} label={tr(label)}>
          <NativeSelect
            id={id}
            controlWidth="medium"
            aria-label={tr(label)}
            disabled={!prefs || busy}
            value={prefs?.[key] ?? fallback}
            onChange={(e) => void change(key, e.target.value)}
          >
            <option value="inside">{tr('内 · 聊天内工作台')}</option>
            <option value="outside" disabled={!outsideAvailable}>
              {tr('外 · 桌面浮窗')}
            </option>
            {key !== 'launcherAction' && (
              <option value="toggle" disabled={!outsideAvailable}>
                {tr('聊天与桌面之间切换')}
              </option>
            )}
            <option value="settings">{tr('设置')}</option>
          </NativeSelect>
        </Field>
      ))}
      <Feedback text={error} failed />
    </div>
  );
}
