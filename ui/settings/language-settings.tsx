/* [INPUT]: Revision-checked appearance preferences and shared localization.
 * [OUTPUT]: Language choice shared by settings and every App surface.
 * [POS]: Presentation preference; never changes drafts, glossary entries or Agent configuration.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import type { AppearanceSettings } from '../shared/contracts';
import { setLocale, tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { request } from './api';
import { Field, Feedback } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';

export function LanguageSettings({ value }: { value?: AppearanceSettings }) {
  useLocale();
  const [preference, setPreference] = useState(value?.language || 'system');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const acceptedRevision = useRef(-1);
  useEffect(() => {
    if (value && value.revision >= acceptedRevision.current) {
      acceptedRevision.current = value.revision;
      setPreference(value.language || 'system');
    }
  }, [value]);
  async function change(language: string) {
    if (busy || !value) return;
    setBusy(true);
    setError('');
    try {
      const latest = await request<AppearanceSettings>('appearance');
      const saved = await request<AppearanceSettings>('appearance', {
        expectedRevision: latest.revision,
        language,
      });
      acceptedRevision.current = saved.revision;
      setPreference(saved.language || 'system');
      setLocale(saved.language);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr('语言保存失败，请重试。'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-section">
      <Field id="interface-language" label={tr('语言')}>
        <NativeSelect
          id="interface-language"
          controlWidth="medium"
          value={preference}
          disabled={busy || !value}
          onChange={(event) => void change(event.target.value)}
        >
          <option value="system">{tr('跟随系统')}</option>
          <option value="zh-CN" lang="zh-CN">
            简体中文
          </option>
          <option value="en" lang="en">
            English
          </option>
        </NativeSelect>
      </Field>
      <Feedback text={error} failed />
    </div>
  );
}
