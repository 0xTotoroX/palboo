/* [INPUT]: Current feature membership and resolved layouts.
 * [OUTPUT]: Serializable presentation snapshots, semantic matching and shared recommendation labels/order across forms.
 * [POS]: Shared by the window menu and Web layout settings; never changes feature owners.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { layoutGroups } from './layout-tree.js';
import { tr } from '../../shared/i18n.js';

const readingFeatures = new Set(['outline', 'terms', 'sites']);

export function builtinLayoutPresets() {
  return [
    {
      id: 'tabs-top',
      label: tr('全部标签在顶部'),
      menuLabel: tr('顶部标签'),
      icon: 'layout-tabs-top',
    },
    {
      id: 'tabs-left',
      label: tr('全部标签在左侧'),
      menuLabel: tr('左侧标签'),
      icon: 'layout-tabs-left',
    },
    { id: 'two-column', label: tr('双栏工作台'), menuLabel: tr('双栏'), icon: 'layout-two-column' },
  ];
}

export function builtinLayoutAvailable(id, ids) {
  return id === 'two-column'
    ? ids.some((entry) => readingFeatures.has(entry)) &&
        ids.some((entry) => !readingFeatures.has(entry))
    : ids.length > 0;
}

/** @param {import('../../shared/features').FeatureLayout} layout
 * @returns {import('../../shared/features').FeatureLayout} */
export function builtinLayout(id, layout, ids, activeFeature) {
  const groups = layoutGroups(layout);
  const ordered = [...new Set([...groups.flatMap((group) => group.ids), ...ids])];
  const visible = ordered.filter((entry) => ids.includes(entry));
  const candidates = groups.map((group) => group.active);
  if (groups.length > 1) candidates.unshift(activeFeature);
  if (id === 'two-column') {
    const column = (reading, weight) => {
      const members = ordered.filter((entry) => readingFeatures.has(entry) === reading);
      const available = members.filter((entry) => ids.includes(entry));
      return {
        ids: members,
        active: candidates.find((entry) => available.includes(entry)) || available[0],
        weight,
      };
    };
    return { axis: 'horizontal', groups: [column(true, 0.45), column(false, 0.55)] };
  }
  const active = candidates.find((entry) => visible.includes(entry)) || visible[0];
  return {
    axis: 'auto',
    groups: [{ ids: ordered, active, weight: 1 }],
    ...(id === 'tabs-left' ? { tabPosition: 'left' } : {}),
  };
}

/** @param {import('../../shared/features').FeatureLayout} layout */
export function matchingBuiltinLayout(layout, ids) {
  if (
    layout.groups.length === 2 &&
    builtinLayoutAvailable('two-column', ids) &&
    layoutSignature(layout) === layoutSignature(builtinLayout('two-column', layout, ids))
  )
    return 'two-column';
  const group = layout.groups[0];
  if (
    !ids.length ||
    layout.groups.length !== 1 ||
    !('ids' in group) ||
    group.collapsed ||
    !ids.every((id) => group.ids.includes(id) && (!layout.visible || layout.visible.includes(id)))
  )
    return '';
  return layout.tabPosition === 'left' ? 'tabs-left' : 'tabs-top';
}

export function presetGroup(placement) {
  return placement === 'overlay' || placement === 'desktop' ? 'overlay' : 'sidebar';
}

/** @param {import('../../shared/features').LayoutPreset[]} presets
 * @param {string} placement */
export function layoutPresetsForPlacement(presets, placement) {
  return presets.filter((preset) => presetGroup(preset.scope) === presetGroup(placement));
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
export function layoutSignature(layout) {
  const node = (value) =>
    value.groups
      ? { axis: value.axis, groups: value.groups.map(node), weight: value.weight }
      : {
          ids: value.ids,
          weight: value.weight,
          collapsed: !!value.collapsed,
        };
  return JSON.stringify({
    ...node(layout),
    visible: [...(layout.visible || [])].sort(),
    tabPosition: layout.tabPosition,
  });
}

/** @param {import('../../shared/features').LayoutPreset} preset
 * @param {import('../../shared/features').FeatureLayout} layout
 * @param {string[]} ids */
export function matchesLayoutPreset(preset, layout, ids) {
  return layoutSignature(preset.layout) === layoutSignature(layoutSnapshot(layout, ids));
}
