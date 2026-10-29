/* [INPUT]: Current feature state, resolved layout and the settings write queue.
 * [OUTPUT]: Named layout management and current presentation membership with retained edit drafts.
 * [POS]: Existing layout settings drawer; never changes business feature switches.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useState } from 'react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { titles, type FeatureLayout, type FeatureState } from '../shared/features';
import {
  layoutSnapshot,
  mainFeatureIds,
  matchesLayoutPreset,
} from '../surfaces/workspace/layout-presets.js';
import { SettingsDrawer } from './settings-drawer';
import { Field, Toggle } from './settings-controls';
import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { useConfirmation } from './settings-confirmation';

export function LayoutPresetSettings({
  state,
  layout,
  busy,
  change,
}: {
  state: FeatureState;
  layout: FeatureLayout;
  busy: boolean;
  change: (input: object) => Promise<boolean>;
}) {
  useLocale();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { name: string; revision: number }>>({});
  const ids = mainFeatureIds(state);
  const current = layoutSnapshot(layout, ids);
  const presets = state.layoutPresets || [];
  const revision = state.layoutPresetsRevision || 0;
  const chosen = presets.find((preset) => preset.id === selected) || presets[0];
  const confirmation = useConfirmation(revision, busy);
  const context = {
    placement: state.mainPlacement || 'sidebar',
    expectedRevision: revision,
    expectedLayout: state.layouts?.[state.mainPlacement || 'sidebar'] ?? null,
  };
  async function save() {
    if (await change({ op: 'main-preset-save', ...context, layout: current, name: name.trim() }))
      setName('');
  }
  function show(id: string, value: boolean) {
    const visible = value
      ? [...current.visible!, id]
      : current.visible!.filter((entry) => entry !== id);
    void change({
      op: 'main-layout',
      placement: context.placement,
      expectedLayout: context.expectedLayout,
      layout: { ...current, visible },
    });
  }
  return (
    <SettingsDrawer id="layout-presets" title={tr('布局预设')}>
      <section className="settings-subsection">
        <h3>{tr('当前布局')}</h3>
        <div className="settings-feature-grid">
          {ids.map((id) => (
            <Toggle
              key={id}
              label={titles[id]}
              checked={current.visible!.includes(id)}
              disabled={busy || (current.visible!.length === 1 && current.visible!.includes(id))}
              onChange={(value) => show(id, value)}
            />
          ))}
        </div>
        <Field id="new-layout-preset-name" label={tr('预设名称')}>
          <input
            id="new-layout-preset-name"
            value={name}
            maxLength={40}
            disabled={busy || !ids.length}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="settings-actions">
          <Button
            type="button"
            disabled={busy || !name.trim() || !current.visible?.length}
            onClick={() => void save()}
          >
            {tr('保存当前布局')}
          </Button>
        </div>
      </section>
      <section className="settings-subsection">
        <h3>{tr('已保存的预设')}</h3>
        {!chosen ? (
          <p className="settings-hint">{tr('暂无布局预设')}</p>
        ) : (
          <>
            <Field id="saved-layout-preset" label={tr('布局预设')}>
              <NativeSelect
                id="saved-layout-preset"
                value={chosen.id}
                disabled={busy}
                onChange={(event) => setSelected(event.target.value)}
              >
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="layout-preset-rename" label={tr('名称')}>
              <input
                id="layout-preset-rename"
                value={drafts[chosen.id]?.name ?? chosen.name}
                maxLength={40}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((previous) => ({
                    ...previous,
                    [chosen.id]: {
                      name: value,
                      revision: previous[chosen.id]?.revision ?? revision,
                    },
                  }));
                }}
              />
            </Field>
            <div className="settings-actions">
              {drafts[chosen.id] && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setDrafts((previous) => {
                      const next = { ...previous };
                      delete next[chosen.id];
                      return next;
                    })
                  }
                >
                  {tr('取消')}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy ||
                  !drafts[chosen.id]?.name.trim() ||
                  drafts[chosen.id]?.name.trim() === chosen.name
                }
                onClick={async () => {
                  const draft = drafts[chosen.id];
                  if (
                    draft &&
                    (await change({
                      op: 'main-preset-rename',
                      id: chosen.id,
                      expectedRevision: draft.revision,
                      name: draft.name.trim(),
                    }))
                  )
                    setDrafts((previous) => {
                      const next = { ...previous };
                      delete next[chosen.id];
                      return next;
                    });
                }}
              >
                {tr('重命名')}
              </Button>
              <Button
                type="button"
                disabled={busy || matchesLayoutPreset(chosen, layout, ids)}
                onClick={() => void change({ op: 'main-preset-apply', ...context, id: chosen.id })}
              >
                {tr('使用此预设')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !current.visible?.length}
                onClick={() =>
                  confirmation.confirm({
                    title: tr('更新布局预设'),
                    description: tr('用当前布局覆盖“{{name}}”？', { name: chosen.name }),
                    confirmLabel: tr('更新'),
                    action: () =>
                      change({
                        op: 'main-preset-save',
                        ...context,
                        id: chosen.id,
                        name: chosen.name,
                        layout: current,
                      }),
                  })
                }
              >
                {tr('用当前布局更新')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  confirmation.confirm({
                    title: tr('删除布局预设'),
                    description: tr('删除“{{name}}”？当前布局会保留。', { name: chosen.name }),
                    confirmLabel: tr('删除'),
                    action: () =>
                      change({
                        op: 'main-preset-delete',
                        id: chosen.id,
                        expectedRevision: revision,
                      }),
                  })
                }
              >
                {tr('删除')}
              </Button>
            </div>
          </>
        )}
      </section>
      {confirmation.confirmation}
    </SettingsDrawer>
  );
}
