/* [INPUT]: 设置页独立强调色与原外观保存队列。
 * [OUTPUT]: 跟随宿主、Palboo 橙和本机自定义颜色；保留未保存和失败草稿。
 * [POS]: 外观与字体中的设置页点缀选项，不改业务窗口或宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useState } from 'react';
import type { SettingsAccent } from '../shared/contracts';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { Field, Feedback } from './settings-controls';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';

export const defaultSettingsAccent: SettingsAccent = { source: 'chatgpt', color: '#ff5a00' };

export function AccentSettings({
  value = defaultSettingsAccent,
  save,
}: {
  value?: SettingsAccent;
  save: (value: SettingsAccent) => Promise<unknown>;
}) {
  useLocale();
  const [color, setColor] = useState(value.color);
  const [error, setError] = useState('');
  useEffect(() => {
    setColor(value.color);
    setError('');
  }, [value.color]);
  const valid = /^#[0-9a-f]{6}$/i.test(color);
  async function commit() {
    if (!valid) {
      setError(tr('请输入六位十六进制颜色，如 #FF5A00'));
      return;
    }
    setError('');
    if (color.toLowerCase() !== value.color) await save({ ...value, color: color.toLowerCase() });
  }
  const leave = (event: React.FocusEvent<HTMLInputElement>) => {
    if (
      event.relatedTarget instanceof Element &&
      event.relatedTarget.closest(
        '.settings-accent-editor,#settings-accent-source,[data-settings-navigation]',
      )
    )
      return;
    void commit();
  };
  return (
    <section
      className="settings-section settings-surface-group"
      id="settings-accent"
      data-settings-page="appearance"
    >
      <h2>{tr('设置页强调色')}</h2>
      <Field id="settings-accent-source" label={tr('颜色来源')}>
        <NativeSelect
          id="settings-accent-source"
          controlWidth="medium"
          value={value.source}
          onChange={(event) =>
            void save({ ...value, source: event.target.value as SettingsAccent['source'] })
          }
        >
          <option value="chatgpt">{tr('跟随 ChatGPT')}</option>
          <option value="palboo">{tr('Palboo 橙')}</option>
          <option value="custom">{tr('自定义')}</option>
        </NativeSelect>
      </Field>
      <div
        hidden={value.source !== 'custom'}
        data-settings-search-ignore={value.source !== 'custom' || undefined}
      >
        <Field id="settings-accent-color" label={tr('颜色')}>
          <div className="settings-accent-editor">
            <Input
              type="color"
              aria-label={tr('选择强调色')}
              value={valid ? color : value.color}
              onChange={(event) => {
                setColor(event.target.value);
                setError('');
              }}
              onBlur={leave}
            />
            <Input
              id="settings-accent-color"
              value={color}
              maxLength={7}
              spellCheck={false}
              aria-invalid={!!error}
              onChange={(event) => {
                setColor(event.target.value);
                setError('');
              }}
              onBlur={leave}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
        </Field>
        <Feedback text={error} failed />
      </div>
    </section>
  );
}
