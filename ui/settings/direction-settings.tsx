/*
 * [INPUT]: 共用设置草稿、版本化保存队列和判断服务凭据状态。
 * [OUTPUT]: 生成时机、方向来源及有序位置；方向目录和 Jev 配置通过独立抽屉管理。
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
import { DirectionLibrary } from './direction-library';
import type { SettingsEditor } from './use-settings-form';
import type { EditableSettings } from '../shared/contracts';

export function DirectionSettings({ editor }: { editor: SettingsEditor }) {
  const { form: draft, saved: baseline, change, schedule } = editor;
  const form = draft!,
    saved = baseline!;
  const listRef = useSettingsListMotion<HTMLElement>();
  const [adding, setAdding] = useState('');
  const library = form.directionLibrary;
  const builtIns = new Map(saved.builtInDirections.map((item) => [item.id, item]));
  const groups = [
    { label: '内置方向', items: library.filter((item) => builtIns.has(item.id)) },
    { label: '我的方向', items: library.filter((item) => !builtIns.has(item.id)) },
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
    <>
      <Card ref={listRef} tabIndex={-1} id="settings-directions" aria-labelledby="direction-title">
        <h2 id="direction-title">建议生成</h2>
        <Field id="generation-mode" label="生成方式">
          <NativeSelect
            id="generation-mode"
            value={form.generationMode}
            onChange={(event) => change('generationMode', event.target.value as 'auto' | 'manual')}
          >
            <option value="manual">手动刷新</option>
            <option value="auto">自动生成</option>
          </NativeSelect>
        </Field>
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
      </Card>
      <div className="next-settings-menu">
        <DirectionLibrary editor={editor} />
        {form.directionSource === 'smart' && (
          <SettingsDrawer
            id="settings-jev-advanced"
            title="智能挑选服务"
            footer={<DrawerSaveControls editor={editor} />}
          >
            <div className="space-y-5">
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
              <Field id="jev-endpoint" label="Jev 请求地址">
                <Input
                  id="jev-endpoint"
                  type="url"
                  required
                  value={form.jev.endpoint}
                  onChange={(e) =>
                    change('jev', { ...form.jev, endpoint: e.target.value, consent: false })
                  }
                />
              </Field>
              <Field id="jev-model" label="Jev 模型">
                <Input
                  id="jev-model"
                  required
                  value={form.jev.model}
                  onChange={(e) => change('jev', { ...form.jev, model: e.target.value })}
                />
              </Field>
              <ModelApiKey editor={editor} busy={editor.saving} kind="jev" />
              {saved.storedJevApiKey && (
                <DeleteModelApiKey editor={editor} busy={editor.saving} kind="jev" />
              )}
              {saved.directionSource === 'smart' &&
                saved.jev.consent &&
                !saved.jevKeyConfigured && (
                  <p role="status" className="settings-hint">
                    尚未连接：可保存密钥，或在后台环境设置 TYPESAFE_API_KEY。
                  </p>
                )}
            </div>
          </SettingsDrawer>
        )}
      </div>
    </>
  );
}
