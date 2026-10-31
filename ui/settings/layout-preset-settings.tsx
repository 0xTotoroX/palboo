/* [INPUT]: Current feature state, resolved layout and the settings write queue.
 * [OUTPUT]: Current preset selection, compact management entry and shared presets with retained name/scope drafts.
 * [POS]: Main layout settings and its existing drawer; never changes business feature switches.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useState } from 'react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import {
  titles,
  featureIcons,
  type FeatureLayout,
  type FeatureState,
  type LayoutPresetScope,
} from '../shared/features';
import {
  layoutSnapshot,
  mainFeatureIds,
  matchesLayoutPreset,
  layoutPresetScopes,
  presetScopeLabel,
  layoutPresetLabel,
  sortedLayoutPresets,
} from '../surfaces/workspace/layout-presets.js';
import { SettingsDrawer } from './settings-drawer';
import { Field } from './settings-controls';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Icon } from '../shared/icons/react';
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
  const [scope, setScope] = useState<LayoutPresetScope | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { name: string; scope: LayoutPresetScope; revision: number }>
  >({});
  const ids = mainFeatureIds(state);
  const current = layoutSnapshot(layout, ids);
  const placement = state.mainPlacement || 'sidebar';
  const presets = sortedLayoutPresets(state.layoutPresets || [], placement);
  const active = presets.find((preset) => matchesLayoutPreset(preset, layout, ids));
  const revision = state.layoutPresetsRevision || 0;
  const chosen = presets.find((preset) => preset.id === selected) || active || presets[0];
  const confirmation = useConfirmation(revision, busy);
  const context = {
    placement: state.mainPlacement || 'sidebar',
    expectedRevision: revision,
    expectedLayout: state.layouts?.[state.mainPlacement || 'sidebar'] ?? null,
  };
  async function save() {
    if (
      await change({
        op: 'main-preset-save',
        ...context,
        layout: current,
        name: name.trim(),
        scope: scope || placement,
      })
    ) {
      setName('');
      setScope(null);
    }
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
  function edit(value: Partial<{ name: string; scope: LayoutPresetScope }>) {
    if (!chosen) return;
    setDrafts((previous) => ({
      ...previous,
      [chosen.id]: {
        ...(previous[chosen.id] || { name: chosen.name, scope: chosen.scope || 'all', revision }),
        ...value,
      },
    }));
  }
  const draft = chosen && drafts[chosen.id];
  const changed =
    draft && (draft.name.trim() !== chosen.name || draft.scope !== (chosen.scope || 'all'));
  return (
    <div className="settings-layout-presets">
      <Field id="current-layout-preset" label={tr('当前预设')}>
        <NativeSelect
          id="current-layout-preset"
          value={active?.id || ''}
          disabled={busy || !ids.length || !presets.length}
          onChange={(event) =>
            void change({ op: 'main-preset-apply', ...context, id: event.target.value })
          }
        >
          <option value="" disabled>
            {tr('自定义布局')}
          </option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {layoutPresetLabel(preset)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <SettingsDrawer
        id="layout-presets"
        title={tr('布局预设')}
        triggerLabel={tr('管理布局预设')}
        compact
      >
        <section className="settings-subsection layout-preset-section">
          <h3>{tr('保存新预设')}</h3>
          <fieldset className="layout-preset-membership">
            <legend>{tr('包含的功能')}</legend>
            <div className="layout-preset-features">
              {ids.map((id) => (
                <label key={id} className="layout-preset-feature">
                  <input
                    type="checkbox"
                    checked={current.visible!.includes(id)}
                    disabled={
                      busy || (current.visible!.length === 1 && current.visible!.includes(id))
                    }
                    onChange={(event) => show(id, event.target.checked)}
                  />
                  <Icon name={featureIcons[id]} />
                  <span>{titles[id]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field id="new-layout-preset-name" label={tr('预设名称')}>
            <Input
              id="new-layout-preset-name"
              value={name}
              maxLength={40}
              disabled={busy || !ids.length}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field id="new-layout-preset-scope" label={tr('适用形式')}>
            <NativeSelect
              id="new-layout-preset-scope"
              value={scope || placement}
              disabled={busy}
              onChange={(event) => setScope(event.target.value as LayoutPresetScope)}
            >
              {layoutPresetScopes.map((value) => (
                <option key={value} value={value}>
                  {presetScopeLabel(value)}
                </option>
              ))}
            </NativeSelect>
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
        <section className="settings-subsection layout-preset-section">
          <h3>{tr('已保存的预设')}</h3>
          {!chosen ? (
            <p className="settings-hint">{tr('暂无布局预设')}</p>
          ) : (
            <>
              <Field id="saved-layout-preset" label={tr('选择预设')}>
                <NativeSelect
                  id="saved-layout-preset"
                  value={chosen.id}
                  disabled={busy}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {layoutPresetLabel(preset)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="layout-preset-rename" label={tr('名称')}>
                <Input
                  id="layout-preset-rename"
                  value={drafts[chosen.id]?.name ?? chosen.name}
                  maxLength={40}
                  disabled={busy}
                  onChange={(event) => edit({ name: event.target.value })}
                />
              </Field>
              <Field id="layout-preset-scope" label={tr('适用形式')}>
                <NativeSelect
                  id="layout-preset-scope"
                  value={draft?.scope ?? chosen.scope ?? 'all'}
                  disabled={busy}
                  onChange={(event) => edit({ scope: event.target.value as LayoutPresetScope })}
                >
                  {layoutPresetScopes.map((value) => (
                    <option key={value} value={value}>
                      {presetScopeLabel(value)}
                    </option>
                  ))}
                </NativeSelect>
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
                  disabled={busy || !drafts[chosen.id]?.name.trim() || !changed}
                  onClick={async () => {
                    const draft = drafts[chosen.id];
                    if (
                      draft &&
                      (await change({
                        op: 'main-preset-update',
                        id: chosen.id,
                        expectedRevision: draft.revision,
                        name: draft.name.trim(),
                        scope: draft.scope,
                      }))
                    )
                      setDrafts((previous) => {
                        const next = { ...previous };
                        delete next[chosen.id];
                        return next;
                      });
                  }}
                >
                  {tr('保存更改')}
                </Button>
                <Button
                  type="button"
                  disabled={busy || matchesLayoutPreset(chosen, layout, ids)}
                  onClick={() =>
                    void change({ op: 'main-preset-apply', ...context, id: chosen.id })
                  }
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
                          scope: chosen.scope || 'all',
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
    </div>
  );
}
