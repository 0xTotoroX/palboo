/* [INPUT]: Revision-checked appearance preferences and desktop capability.
 * [OUTPUT]: Next-launch visibility and inside/outside choice, saved independently of model drafts.
 * [POS]: Startup controls within the existing connection page; no immediate window movement.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import type { AppearanceSettings } from '../shared/contracts';
import { request } from './api';
import { Field, Feedback } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';

export function StartupSettings({
  value,
  live,
  outsideAvailable,
}: {
  value?: AppearanceSettings;
  live: boolean;
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
  const startup = prefs?.startup || { mode: 'restore', location: 'inside' };
  async function change(patch: Partial<typeof startup>) {
    if (!live || !prefs || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = { ...startup, ...patch };
      if (patch.mode === 'open' && !outsideAvailable) next.location = 'inside';
      const saved = await request<AppearanceSettings>('appearance', {
        expectedRevision: prefs.revision,
        startup: next,
      });
      setPrefs((current) => (!current || saved.revision >= current.revision ? saved : current));
    } catch (e) {
      setError((e as Error).message);
      try {
        const saved = await request<AppearanceSettings>('appearance');
        setPrefs((current) => (!current || saved.revision >= current.revision ? saved : current));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-settings-navigation onChange={(event) => event.stopPropagation()}>
      <Field id="startup-mode" label={tr('Palboo 启动时')} hint={tr('下次启动 Palboo 时生效。')}>
        <NativeSelect
          id="startup-mode"
          controlWidth="medium"
          value={startup.mode}
          disabled={!live || !prefs || busy}
          onChange={(event) => void change({ mode: event.target.value as typeof startup.mode })}
        >
          <option value="restore">{tr('沿用上次状态')}</option>
          <option value="closed">{tr('默认收起')}</option>
          <option value="open">{tr('默认打开')}</option>
        </NativeSelect>
      </Field>
      {startup.mode === 'open' && (
        <Field id="startup-location" label={tr('默认打开位置')}>
          <NativeSelect
            id="startup-location"
            controlWidth="medium"
            value={startup.location}
            disabled={!live || !prefs || busy}
            onChange={(event) =>
              void change({ location: event.target.value as typeof startup.location })
            }
          >
            <option value="inside">{tr('内 · 聊天内工作台')}</option>
            <option value="outside" disabled={!outsideAvailable}>
              {tr('外 · 桌面浮窗')}
            </option>
          </NativeSelect>
        </Field>
      )}
      <Feedback text={error} failed />
    </div>
  );
}
