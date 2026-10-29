import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Shared settings editor and legacy click-mode preference.
 * [OUTPUT]: Content-first phrase editing with optional names, global name-only display and execution mode using the original save queue.
 * [POS]: Functional settings only; shared model configuration lives in model-settings.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { usePromptKeys, useSettingsListMotion } from './settings-list-motion';
import { IconButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import type { View } from './api';
import type { SettingsEditor } from './use-settings-form';
import { Icon } from '../shared/icons/react';
import { ConfirmationButton } from './settings-confirmation';
import { Field, Toggle } from './settings-controls';
import { quickPromptName } from '../shared/quick-prompts.js';
import { NativeSelect } from './components/ui/native-select';
export function QuickPromptSettings({
  editor,
  appearance,
}: {
  editor: SettingsEditor;
  appearance?: View['panelPreferences'];
}) {
  useLocale();
  const { form, saved, change } = editor;
  const listRef = useSettingsListMotion();
  const { keys: promptKeys, trackRemoval } = usePromptKeys(
    form?.quickPrompts ?? [],
    saved?.configurationRevision,
  );
  if (!form || !saved) return null;
  return (
    <div data-settings-page="prompts">
      <Toggle
        id="quick-prompt-label-only"
        label={tr('仅显示名称')}
        checked={form.quickPromptLabelOnly ?? false}
        onChange={(value) => change('quickPromptLabelOnly', value)}
      />
      <Field id="quick-prompt-click" label={tr('指令执行模式')}>
        <NativeSelect
          id="quick-prompt-click"
          controlWidth="medium"
          value={form.quickPromptClickMode ?? appearance?.ui.promptClickMode ?? 'fill'}
          onChange={(e) =>
            change('quickPromptClickMode', e.target.value as 'fill' | 'direct' | 'hybrid')
          }
        >
          <option value="fill">{tr('仅填入')}</option>
          <option value="direct">{tr('直接发送')}</option>
          <option value="hybrid">{tr('单击填入 · 双击发送')}</option>
        </NativeSelect>
      </Field>
      <Card tabIndex={-1} id="settings-quick-prompts" aria-labelledby="quick-prompts-title">
        <h2 id="quick-prompts-title">{tr('常用提示词')}</h2>
        <div ref={listRef} data-settings-list="quick-prompts" className="settings-entry-list">
          {form.quickPrompts.map((item, index) => (
            <div
              key={promptKeys[index]}
              data-settings-list-item={promptKeys[index]}
              className="settings-entry settings-prompt-entry"
            >
              <textarea
                aria-label={tr('常用提示词 {{value1}} 内容', { value1: index + 1 })}
                value={item.prompt}
                maxLength={4000}
                required
                rows={2}
                placeholder={tr('指令内容')}
                className="settings-entry-content"
                onChange={(e) =>
                  change(
                    'quickPrompts',
                    form.quickPrompts.map((p, i) =>
                      i === index ? { ...p, prompt: e.target.value } : p,
                    ),
                  )
                }
              />
              <Input
                className="settings-entry-name"
                aria-label={tr('常用提示词 {{value1}} 名称', { value1: index + 1 })}
                value={item.label}
                maxLength={20}
                placeholder={tr('短名称（选填）')}
                onChange={(e) =>
                  change(
                    'quickPrompts',
                    form.quickPrompts.map((p, i) =>
                      i === index ? { ...p, label: e.target.value } : p,
                    ),
                  )
                }
              />
              <ConfirmationButton
                type="button"
                variant="ghost"
                size="icon"
                aria-label={tr('删除常用提示词 {{value1}}', { value1: index + 1 })}
                revision={saved.configurationRevision}
                disabled={editor.saving || editor.remoteChanged}
                title={tr('删除提示词“{{value1}}”？', {
                  value1: quickPromptName(item) || tr('未命名'),
                })}
                description={tr('会删除这条常用提示词的名称与内容，其他提示词保持不变。')}
                confirmLabel={tr('确认删除')}
                onConfirm={() =>
                  trackRemoval(index, () =>
                    editor.removeEntry('prompt', index, saved.configurationRevision),
                  )
                }
              >
                <Icon name="trash" />
              </ConfirmationButton>
            </div>
          ))}
          <IconButton
            variant="outline"
            data-settings-list-item="add"
            aria-label={tr('添加提示词')}
            disabled={form.quickPrompts.length >= 8}
            onClick={() =>
              change('quickPrompts', [...form.quickPrompts, { label: '', prompt: '' }])
            }
          >
            <Icon name="plus" />
          </IconButton>
        </div>
      </Card>
    </div>
  );
}
