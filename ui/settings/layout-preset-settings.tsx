/* [INPUT]: Current feature state, resolved layout and the settings write queue.
 * [OUTPUT]: Separate selection/management slots for the main layout group, with retained preset name/scope drafts.
 * [POS]: Main layout settings and its existing drawer; never changes business feature switches.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { titles, featureIcons, type FeatureLayout, type FeatureState } from '../shared/features';
import {
  layoutSnapshot,
  mainFeatureIds,
  matchesLayoutPreset,
  layoutPresetsForPlacement,
  presetGroup,
  builtinLayout,
  builtinLayoutAvailable,
  builtinLayoutPresets,
  matchingBuiltinLayout,
} from '../surfaces/workspace/layout-presets.js';
import { SettingsDrawer } from './settings-drawer';
import { Field } from './settings-controls';
import { Button, IconButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { Icon } from '../shared/icons/react';
import { NativeSelect } from './components/ui/native-select';
import { useConfirmation } from './settings-confirmation';

export function LayoutPresetSettings({
  state,
  layout,
  busy,
  change,
  renderControls,
}: {
  state: FeatureState;
  layout: FeatureLayout;
  busy: boolean;
  change: (input: object) => Promise<boolean>;
  renderControls: (controls: { selector: ReactNode; manager: ReactNode }) => ReactNode;
}) {
  useLocale();
  const [names, setNames] = useState({ sidebar: '', overlay: '' });
  const [view, setView] = useState<
    { kind: 'new'; group: 'sidebar' | 'overlay' } | { kind: 'edit'; id: string } | null
  >(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastView = useRef(view);
  const [drafts, setDrafts] = useState<Record<string, { name: string; revision: number }>>({});
  const ids = mainFeatureIds(state);
  const current = layoutSnapshot(layout, ids);
  const placement = state.mainPlacement || 'sidebar';
  const group = presetGroup(placement);
  const name = names[group];
  const setName = (value: string) => setNames((previous) => ({ ...previous, [group]: value }));
  const presets = layoutPresetsForPlacement(state.layoutPresets || [], placement);
  const active = presets.find((preset) => matchesLayoutPreset(preset, layout, ids));
  const builtins = builtinLayoutPresets();
  const revision = state.layoutPresetsRevision || 0;
  const chosen =
    view?.kind === 'edit' ? presets.find((preset) => preset.id === view.id) : undefined;
  const creating = view?.kind === 'new' && view.group === group;
  const editing = Boolean(chosen) || creating;
  useLayoutEffect(() => {
    const previous = lastView.current;
    lastView.current = view;
    if (editing) backButton.current?.focus();
    else if (previous) {
      const target = previous.kind === 'edit' && editButtons.current.get(previous.id);
      (target || newButton.current)?.focus();
    }
  }, [view, editing]);
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
      })
    ) {
      setName('');
      setView(null);
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
  function edit(name: string) {
    if (!chosen) return;
    setDrafts((previous) => ({
      ...previous,
      [chosen.id]: {
        ...(previous[chosen.id] || { revision }),
        name,
      },
    }));
  }
  const draft = chosen && drafts[chosen.id];
  const changed = draft && draft.name.trim() !== chosen.name;
  return renderControls({
    selector: (
      <Field id="current-layout-preset" label={tr('当前预设')}>
        <NativeSelect
          id="current-layout-preset"
          value={active?.id || matchingBuiltinLayout(layout, ids)}
          disabled={busy || !ids.length}
          onChange={(event) => {
            const id = event.target.value;
            if (builtins.some((preset) => preset.id === id))
              void change({
                op: 'main-layout',
                placement: context.placement,
                expectedLayout: context.expectedLayout,
                layout: builtinLayout(id, layout, ids, state.activeFeature),
              });
            else void change({ op: 'main-preset-apply', ...context, id });
          }}
        >
          <option value="" disabled>
            {tr('自定义布局')}
          </option>
          <optgroup label={tr('内置预设')}>
            {builtins.map(({ id, label }) => (
              <option key={id} value={id} disabled={!builtinLayoutAvailable(id, ids)}>
                {label}
              </option>
            ))}
          </optgroup>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
    ),
    manager: (
      <SettingsDrawer
        id="layout-presets"
        title={tr('布局预设')}
        triggerLabel={tr('管理布局预设')}
        compact
      >
        {editing ? (
          <div className="layout-preset-navigation">
            <Button
              ref={backButton}
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setView(null)}
            >
              <Icon name="back" />
              {tr('返回')}
            </Button>
            <h3>{tr(chosen ? '编辑预设' : '保存新预设')}</h3>
          </div>
        ) : (
          <>
            <div className="layout-preset-list-actions">
              <Button
                ref={newButton}
                variant="outline"
                size="sm"
                disabled={busy || !ids.length}
                onClick={() => setView({ kind: 'new', group })}
              >
                <Icon name="plus" />
                {tr('保存新预设')}
              </Button>
            </div>
            {presets.length ? (
              <ul className="layout-preset-list">
                {presets.map((preset) => {
                  const current = preset.id === active?.id;
                  return (
                    <li key={preset.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="layout-preset-apply"
                        aria-current={current || undefined}
                        aria-disabled={current || undefined}
                        title={tr('使用此预设')}
                        disabled={busy}
                        onClick={() => {
                          if (!current)
                            void change({ op: 'main-preset-apply', ...context, id: preset.id });
                        }}
                      >
                        <span>{preset.name}</span>
                        {current && <Icon name="check" />}
                      </Button>
                      <IconButton
                        ref={(node) => {
                          if (node) editButtons.current.set(preset.id, node);
                          else editButtons.current.delete(preset.id);
                        }}
                        aria-label={tr('编辑{{name}}', { name: preset.name })}
                        title={tr('编辑')}
                        disabled={busy}
                        onClick={() => setView({ kind: 'edit', id: preset.id })}
                      >
                        <Icon name="pencil" />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="settings-hint">{tr('暂无布局预设')}</p>
            )}
          </>
        )}
        {creating && (
          <section className="layout-preset-form">
            <Field id="new-layout-preset-name" label={tr('预设名称')}>
              <Input
                id="new-layout-preset-name"
                value={name}
                maxLength={40}
                disabled={busy || !ids.length}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
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
        )}
        {chosen && (
          <section className="layout-preset-form">
            <Field id="layout-preset-rename" label={tr('名称')}>
              <Input
                id="layout-preset-rename"
                value={drafts[chosen.id]?.name ?? chosen.name}
                maxLength={40}
                disabled={busy}
                onChange={(event) => edit(event.target.value)}
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
            </div>
            <div className="settings-actions layout-preset-secondary">
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
                    action: async () => {
                      const deleted = await change({
                        op: 'main-preset-delete',
                        id: chosen.id,
                        expectedRevision: revision,
                      });
                      if (deleted) setView(null);
                      return deleted;
                    },
                  })
                }
              >
                {tr('删除')}
              </Button>
            </div>
          </section>
        )}
        {confirmation.confirmation}
      </SettingsDrawer>
    ),
  });
}
