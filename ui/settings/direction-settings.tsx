/*
 * [INPUT]: 共用设置草稿、版本化保存队列和判断服务凭据状态。
 * [OUTPUT]: 三种方向来源、系统/自定义方向分组与默认文案恢复、确认删除及共用 Jev 密钥管理。
 * [POS]: Web 设置中的 Stepwise 方向配置，不在日常面板增加控制项。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { SettingsDrawer, DrawerSaveControls } from './settings-drawer';
import { useSettingsListMotion } from './settings-list-motion';
import { useState } from 'react';
import { Icon } from '../shared/icons/react';
import { Card } from './components/ui/card';
import { Field } from './settings-controls';
import { Input } from './components/ui/input';
import { IconButton } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { ModelApiKey, DeleteModelApiKey } from './model-credentials';
import { ConfirmationButton } from './settings-confirmation';
import type { SettingsEditor } from './use-settings-form';
import type { EditableSettings } from '../shared/contracts';

const labelClass = 'mb-2 block text-[14px] font-medium';
export function DirectionSettings({ editor }: { editor: SettingsEditor }) {
  const { form: draft, saved: baseline, change, schedule } = editor;
  const form = draft!,
    saved = baseline!;
  const listRef = useSettingsListMotion<HTMLElement>();
  const [adding, setAdding] = useState('');
  const library = form.directionLibrary;
  const builtIns = new Map(saved.builtInDirections.map((item) => [item.id, item]));
  const groups = [
    { label: '系统自带', items: library.filter((item) => builtIns.has(item.id)) },
    { label: '自定义', items: library.filter((item) => !builtIns.has(item.id)) },
  ];
  function options(available: typeof library) {
    return groups.map((group) => {
      const items = group.items.filter((item) => available.includes(item));
      return items.length ? (
        <optgroup key={group.label} label={group.label}>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </optgroup>
      ) : null;
    });
  }
  function slots(ids: string[]) {
    change('selectedDirections', ids);
    schedule();
  }
  function move(index: number, delta: number) {
    const ids = [...form.selectedDirections];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    slots(ids);
  }
  return (
    <Card ref={listRef} tabIndex={-1} id="settings-directions" aria-labelledby="direction-title">
      <h2 id="direction-title" className="mb-5 text-[15px] font-semibold">
        建议方向
      </h2>
      <Field id="direction-source" label="方向来源">
        <NativeSelect
          id="direction-source"
          value={form.directionSource}
          onChange={(e) =>
            change('directionSource', e.target.value as EditableSettings['directionSource'])
          }
        >
          <option value="auto">自动探索</option>
          <option value="manual">我来选择</option>
          <option value="smart">智能挑选（实验）</option>
        </NativeSelect>
      </Field>
      {form.directionSource !== 'manual' ? (
        <Field id="max-items" label="最多建议数量">
          <Input
            id="max-items"
            type="number"
            min="1"
            max="6"
            value={form.maxItems}
            onChange={(e) => change('maxItems', Number(e.target.value))}
          />
        </Field>
      ) : (
        <div data-settings-list="direction-slots" className="mt-3 space-y-2">
          {form.selectedDirections.map((id, index) => (
            <div key={id} data-settings-list-item={id} className="flex items-center gap-2">
              <label htmlFor={`direction-slot-${index}`} className="shrink-0 text-[14px]">
                {index + 1}
              </label>
              <NativeSelect
                id={`direction-slot-${index}`}
                aria-label={`方向位置 ${index + 1}`}
                value={id}
                onChange={(e) =>
                  slots(
                    form.selectedDirections.map((current, i) =>
                      i === index ? e.target.value : current,
                    ),
                  )
                }
              >
                {options(
                  library.filter((d) => d.id === id || !form.selectedDirections.includes(d.id)),
                )}
              </NativeSelect>
              <IconButton
                aria-label={`上移方向 ${index + 1}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <Icon name="arrow-up" />
              </IconButton>
              <IconButton
                aria-label={`下移方向 ${index + 1}`}
                disabled={index === form.selectedDirections.length - 1}
                onClick={() => move(index, 1)}
              >
                <Icon name="arrow-down" />
              </IconButton>
              <IconButton
                aria-label={`移除方向位置 ${index + 1}`}
                onClick={() => slots(form.selectedDirections.filter((_, i) => i !== index))}
              >
                <Icon name="trash" />
              </IconButton>
            </div>
          ))}
          <div data-settings-list-item="add" className="flex items-center gap-2">
            <NativeSelect
              aria-label="添加方向位置"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">选择一个方向…</option>
              {options(library.filter((d) => !form.selectedDirections.includes(d.id)))}
            </NativeSelect>
            <IconButton
              variant="outline"
              aria-label="加入"
              disabled={!adding || form.selectedDirections.length >= 6}
              onClick={() => {
                slots([...form.selectedDirections, adding]);
                setAdding('');
              }}
            >
              <Icon name="plus" />
            </IconButton>
          </div>
          {!form.selectedDirections.length && (
            <p className="text-[14px] text-muted-foreground">请选择至少一个方向后再生成。</p>
          )}
        </div>
      )}
      {form.directionSource !== 'auto' && (
        <section className="mt-5">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="mt-4">
              <h3 className="mb-2 text-[14px] font-medium">{group.label}</h3>
              <div data-settings-list="direction-library" className="settings-entry-list">
                {group.items.map((item) => {
                  const index = library.indexOf(item);
                  const original = builtIns.get(item.id);
                  const modified =
                    original &&
                    (original.name !== item.name || original.instruction !== item.instruction);
                  return (
                    <div key={item.id} data-settings-list-item={item.id} className="settings-entry">
                      <div className="settings-entry-heading">
                        {form.directionSource === 'smart' && (
                          <input
                            type="checkbox"
                            aria-label={`启用方向 ${item.name}`}
                            checked={item.enabled}
                            onChange={(e) => {
                              change(
                                'directionLibrary',
                                library.map((d) =>
                                  d.id === item.id ? { ...d, enabled: e.target.checked } : d,
                                ),
                              );
                              schedule();
                            }}
                          />
                        )}
                        <Input
                          className="settings-entry-name"
                          required
                          maxLength={40}
                          aria-label={`方向名称 ${index + 1}`}
                          value={item.name}
                          onChange={(e) =>
                            change(
                              'directionLibrary',
                              library.map((d) =>
                                d.id === item.id ? { ...d, name: e.target.value } : d,
                              ),
                            )
                          }
                        />
                        {modified && (
                          <>
                            <IconButton
                              aria-label={`恢复方向 ${item.name} 的系统默认`}
                              title="已修改，恢复系统默认"
                              onClick={() => {
                                change(
                                  'directionLibrary',
                                  library.map((d) =>
                                    d.id === item.id
                                      ? {
                                          ...d,
                                          name: original.name,
                                          instruction: original.instruction,
                                        }
                                      : d,
                                  ),
                                );
                                schedule();
                              }}
                            >
                              <Icon name="refresh" />
                            </IconButton>
                          </>
                        )}
                        <ConfirmationButton
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`删除方向 ${item.name}`}
                          revision={saved.configurationRevision}
                          disabled={editor.saving || editor.remoteChanged}
                          title={`删除方向“${item.name || '未命名'}”？`}
                          description="会删除名称和说明，并从已选方向中移除；不会删除已生成的建议。"
                          confirmLabel="确认删除"
                          onConfirm={() =>
                            editor.removeEntry('direction', item.id, saved.configurationRevision)
                          }
                        >
                          <Icon name="trash" />
                        </ConfirmationButton>
                      </div>
                      <textarea
                        required
                        maxLength={4000}
                        aria-label={`倾向说明 ${index + 1}`}
                        rows={2}
                        className="settings-entry-content"
                        value={item.instruction}
                        onChange={(e) =>
                          change(
                            'directionLibrary',
                            library.map((d) =>
                              d.id === item.id ? { ...d, instruction: e.target.value } : d,
                            ),
                          )
                        }
                      />
                    </div>
                  );
                })}
                {group.label === '自定义' && (
                  <IconButton
                    variant="outline"
                    data-settings-list-item="add"
                    aria-label="添加自定义方向"
                    disabled={library.length >= saved.directionLibraryLimit}
                    onClick={() =>
                      change('directionLibrary', [
                        ...library,
                        {
                          id: `custom-${crypto.randomUUID()}`,
                          name: '',
                          instruction: '',
                          enabled: true,
                        },
                      ])
                    }
                  >
                    <Icon name="plus" />
                  </IconButton>
                )}
              </div>
            </section>
          ))}
        </section>
      )}
      {form.directionSource === 'smart' && (
        <div className="mt-5 space-y-4 border-t border-border pt-5">
          <label className="flex gap-2 text-[14px] leading-relaxed">
            <input
              className="mt-1 self-start"
              type="checkbox"
              checked={form.jev.consent}
              onChange={(e) => {
                change('jev', { ...form.jev, consent: e.target.checked });
                schedule();
              }}
            />
            我同意将最近一问一答发送到下方 Jev
            判断服务。它使用独立密钥和额度；切回其他模式后不再请求。
          </label>
          <div>
            <label className={labelClass} htmlFor="jev-endpoint">
              Jev 请求地址
            </label>
            <Input
              id="jev-endpoint"
              type="url"
              required
              value={form.jev.endpoint}
              onChange={(e) =>
                change('jev', { ...form.jev, endpoint: e.target.value, consent: false })
              }
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="jev-model">
              Jev 模型
            </label>
            <Input
              id="jev-model"
              required
              value={form.jev.model}
              onChange={(e) => change('jev', { ...form.jev, model: e.target.value })}
            />
          </div>
          <ModelApiKey editor={editor} busy={editor.saving} kind="jev" />
          {saved.storedJevApiKey && (
            <SettingsDrawer
              id="settings-jev-advanced"
              title="Jev 高级设置"
              footer={<DrawerSaveControls editor={editor} />}
            >
              <DeleteModelApiKey editor={editor} busy={editor.saving} kind="jev" />
            </SettingsDrawer>
          )}
          {saved.directionSource === 'smart' && saved.jev.consent && !saved.jevKeyConfigured && (
            <p role="status" className="settings-hint">
              尚未连接：可保存密钥，或在后台环境设置 TYPESAFE_API_KEY。
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
