/* [INPUT]: Current feature membership and resolved layouts.
 * [OUTPUT]: Serializable presentation snapshots, semantic matching and shared recommendation labels/order across forms.
 * [POS]: Shared by the window menu and Web layout settings; never changes feature owners.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { layoutGroups } from './layout-tree.js';
import { tr } from '../../shared/i18n.js';

export const layoutPresetScopes = ['all', 'sidebar', 'overlay', 'desktop'];

export function presetScopeLabel(scope = 'all') {
  return (
    { all: tr('通用'), sidebar: tr('侧栏推荐'), overlay: tr('浮层推荐'), desktop: tr('桌面推荐') }[
      scope
    ] || tr('通用')
  );
}

/** @param {import('../../shared/features').LayoutPreset[]} presets
 * @param {string} placement */
export function sortedLayoutPresets(presets, placement) {
  const rank = (preset) =>
    preset.scope === placement ? 0 : !preset.scope || preset.scope === 'all' ? 1 : 2;
  return [...presets].sort((a, b) => rank(a) - rank(b));
}

/** @param {import('../../shared/features').LayoutPreset} preset */
export function layoutPresetLabel(preset) {
  return `${preset.name} · ${presetScopeLabel(preset.scope)}`;
}

/** @param {import('../../shared/features').FeatureState} state */
export function mainFeatureIds(state) {
  return state.features
    .filter((entry) => entry.open && !entry.closing && entry.placement === state.mainPlacement)
    .map((entry) => entry.id);
}

/** @param {import('../../shared/features').FeatureLayout} layout
 * @param {string[]} ids */
export function layoutSnapshot(layout, ids) {
  const next = structuredClone(layout);
  const groups = layoutGroups(next);
  const known = new Set(groups.flatMap((group) => group.ids));
  if (groups.length) groups[0].ids.push(...ids.filter((id) => !known.has(id)));
  next.visible = (next.visible || ids).filter((id) => ids.includes(id));
  return next;
}

/** @param {import('../../shared/features').FeatureLayout} layout */
function signature(layout) {
  const node = (value) =>
    value.groups
      ? { axis: value.axis, groups: value.groups.map(node), weight: value.weight }
      : {
          ids: value.ids,
          active: value.active,
          weight: value.weight,
          collapsed: !!value.collapsed,
        };
  return JSON.stringify({ ...node(layout), visible: [...(layout.visible || [])].sort() });
}

/** @param {import('../../shared/features').LayoutPreset} preset
 * @param {import('../../shared/features').FeatureLayout} layout
 * @param {string[]} ids */
export function matchesLayoutPreset(preset, layout, ids) {
  return signature(preset.layout) === signature(layoutSnapshot(layout, ids));
}
