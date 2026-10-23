/*
 * [INPUT]: 共用设置草稿、版本化保存队列和判断服务凭据状态。
 * [OUTPUT]: 生成时机、方向来源、有序位置与条件显示的 Jev 配置；选择小面板和方向库抽屉分离。
 * [POS]: Web 设置中的 Stepwise 方向配置，不在日常面板增加控制项。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { useSettingsListMotion } from './settings-list-motion';
import { Icon } from '../shared/icons/react';
import { Card } from './components/ui/card';
import { Field } from './settings-controls';
import { Input } from './components/ui/input';
import { IconButton } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { ModelApiKey, DeleteModelApiKey } from './model-credentials';
import { DirectionLibrary } from './direction-library';
import { DirectionPicker } from './direction-picker';
import type { SettingsEditor } from './use-settings-form';
import type { EditableSettings } from '../shared/contracts';

export function DirectionSettings({ editor }: { editor: SettingsEditor }) {
  const { form: draft, saved: baseline, change, schedule } = editor;
  const form = draft!,
    saved = baseline!;
  const listRef = useSettingsListMotion<HTMLElement>();
  const library = form.directionLibrary;
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
        <div className="settings-section-heading direction-section-heading">
          <h2 id="direction-title">建议生成</h2>
          <DirectionLibrary editor={editor} />
        </div>
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
          <div className="settings-field direction-selection">
            <span id="selected-directions-label" className="direction-selection-label">
              已选方向
            </span>
            <div
              role="group"
              aria-labelledby="selected-directions-label"
              data-settings-list="direction-slots"
              className="direction-slots"
            >
              {form.selectedDirections.map((id, index) => (
                <div key={id} data-settings-list-item={id} className="direction-slot">
                  <span className="direction-slot-number">{index + 1}</span>
                  <span className="direction-slot-name" id={`direction-slot-${index}`}>
                    {library.find((item) => item.id === id)?.name || '未命名方向'}
                  </span>
                  <div className="direction-slot-actions">
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
                </div>
              ))}
              <div data-settings-list-item="add">
                <DirectionPicker
                  library={library}
                  builtIns={saved.builtInDirections}
                  selected={form.selectedDirections}
                  onSelect={(id) => slots([...form.selectedDirections, id])}
                />
              </div>
              {!form.selectedDirections.length && (
                <p className="text-[14px] text-muted-foreground">请选择至少一个方向后再生成。</p>
              )}
            </div>
          </div>
        )}
      </Card>
      {form.directionSource === 'smart' && (
        <Card id="settings-jev-advanced" aria-labelledby="jev-service-title">
          <h2 id="jev-service-title">智能挑选服务</h2>
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
            {saved.directionSource === 'smart' && saved.jev.consent && !saved.jevKeyConfigured && (
              <p role="status" className="settings-hint">
                尚未连接：可保存密钥，或在后台环境设置 TYPESAFE_API_KEY。
              </p>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
