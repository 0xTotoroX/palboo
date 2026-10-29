import { tr, getLocale } from '../../shared/i18n.js';
/* [INPUT]: Shared feature icons, live mounts with header actions, per-surface layout and authenticated save callback.
 * [OUTPUT]: Flat/nested layout interpretation, icon tabs, local split/merge, focus, persistent title folding and resizing with checked saves; views stay mounted.
 * [POS]: Presentation-only composition; reuses the workbench gestures and styles.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { featureIcons, titles } from '../../shared/features';
import { iconSvg } from '../../shared/icons/index.js';
import { installSidebarCompact } from './sidebar-compact.js';
import { transferRows } from './compact-rows.js';
import { installArrangement } from './arrangement.js';
import { bindSeparator, elementScale } from './separator.js';
import { readWorkbenchScroll, writeWorkbenchScroll } from '../../shared/scroll.js';
import {
  layoutGroups,
  layoutMinimum,
  arrangeFeatureLayout,
  flattenVerticalLayout,
} from './layout-tree.js';

// Settings and the workspace must interpret an old two-feature layout identically.
/** @returns {import('../../shared/features').FeatureLayout} */
export function resolveFeatureLayout(saved, legacy, ids) {
  if (saved) return flattenVerticalLayout(structuredClone(saved));
  const first = legacy?.first || 'outline';
  const other = first === 'outline' ? 'next' : 'outline';
  const ratio = legacy?.mode === 'horizontal' ? legacy.horizontalRatio : legacy?.verticalRatio;
  return legacy?.group === 'split' && ids.includes(first) && ids.includes(other)
    ? {
        axis: legacy.mode,
        groups: [
          {
            ids: ids.filter((id) => id !== other),
            active: first,
            weight: ratio || 0.45,
          },
          { ids: [other], active: other, weight: 1 - (ratio || 0.45) },
        ],
      }
    : {
        axis: 'auto',
        groups: [
          {
            ids,
            active: ids.includes(legacy?.active) ? legacy.active : ids[0],
            weight: 1,
          },
        ],
      };
}

export function installFeatureLayout(root, { save, error }) {
  const panes = document.createElement('div');
  panes.className = 'csw-workbench-panes csw-feature-panes';
  root.append(panes);
  const parking = document.createElement('div');
  parking.hidden = true;
  root.append(parking);
  const parkedReading = new WeakMap();
  const compact = installSidebarCompact(panes);
  /** @type {import('../../shared/features').FeatureLayout} */
  let layout;
  let placement,
    items = [],
    shape = null,
    selected = '';
  const title = (id) => titles[id] || items.find((item) => item.id === id)?.title || id;
  const containers = new WeakMap();
  let dirty = false,
    saving = false,
    revision = 0;
  const cache = new Map();
  const inputs = new Map();
  const persisted = new Map();
  function rememberReading(item) {
    if (item.node.hidden || !item.node.isConnected) return;
    const nodes = [
      item.node,
      ...item.node.querySelectorAll('*'),
      ...(item.node.shadowRoot?.querySelectorAll('*') || []),
    ];
    parkedReading.set(
      item.node,
      nodes
        .filter((node) => node.clientHeight && node.scrollHeight > node.clientHeight)
        .map((node) => ({ node, top: readWorkbenchScroll(node), left: node.scrollLeft })),
    );
  }
  const isShown = (item) => item.active && (!layout?.visible || layout.visible.includes(item.id));
  function visible(node) {
    if (!node.groups) {
      const ids = node.ids.filter((id) => items.some((item) => item.id === id && isShown(item)));
      return ids.length ? { ...node, ids, original: node } : null;
    }
    const groups = node.groups.map(visible).filter(Boolean);
    return groups.length ? { ...node, groups, original: node } : null;
  }
  async function persist() {
    dirty = true;
    revision++;
    if (saving) return;
    saving = true;
    root.dataset.layoutSaving = 'true';
    let surface = placement;
    try {
      while (dirty) {
        const current = revision;
        surface = placement;
        const next = structuredClone(layout);
        await save(surface, next, structuredClone(persisted.get(surface) ?? null));
        persisted.set(surface, next);
        if (current === revision) dirty = false;
      }
    } catch (e) {
      dirty = false;
      cache.delete(surface);
      inputs.delete(surface);
      if (placement === surface) placement = null;
      error(e);
    } finally {
      saving = false;
      delete root.dataset.layoutSaving;
    }
  }
  const arrange = (value, id, action, width, height, target) => {
    const next = arrangeFeatureLayout(
      value,
      id,
      action,
      width,
      height,
      target,
      items.filter(isShown).map((item) => item.id),
    );
    if (next && action === 'activate') {
      const wasActive = layoutGroups(value).some((group) => group.active === id);
      compact.activate(next, id, wasActive);
    }
    return next && flattenVerticalLayout(next);
  };
  function splitFits(section, id, action) {
    const axis = ['left', 'right'].includes(action) ? 'horizontal' : 'vertical';
    const size = axis === 'horizontal' ? 'width' : 'height';
    const parent = section.parentElement;
    const scale = elementScale(parent)[axis === 'horizontal' ? 'x' : 'y'];
    let available = section.getBoundingClientRect()[size] / scale;
    const source = panes.querySelector(`[data-pane-tab="${id}"]`)?.closest('section[data-pane]');
    const group = layoutGroups(layout).find((g) => g.ids.includes(id));
    const siblings = [...parent.children].filter(
      (node) => !node.hidden && !node.matches('[role="separator"]'),
    );
    if (
      group?.ids.filter((entry) => items.some((item) => item.id === entry && isShown(item)))
        .length === 1 &&
      source?.parentElement === parent &&
      parent.dataset.axis === axis &&
      Math.abs(siblings.indexOf(source) - siblings.indexOf(section)) === 1
    )
      available += source.getBoundingClientRect()[size] / scale + 8;
    return available >= layoutMinimum({ ids: [id], active: id, weight: 1 })[size] * 2 + 8;
  }
  const arrangement = installArrangement(root, {
    read: () => layout,
    write: (next) => {
      layout = next;
      cache.set(placement, layout);
      render();
      void persist();
    },
    update: () => {
      for (const item of items) rememberReading(item);
      render();
    },
    enabled: (id) => items.some((item) => item.id === id && isShown(item) && !item.node.inert),
    arrange,
    deferActivation(id) {
      const section = panes.querySelector(`[data-pane-tab="${id}"]`)?.closest('[data-pane]');
      return (
        section instanceof HTMLElement &&
        section.dataset.compact === 'false' &&
        section.dataset.pane === id
      );
    },
    targetAt(event, id, { width, height }) {
      for (const section of /** @type {NodeListOf<HTMLElement>} */ (
        panes.querySelectorAll('section[data-pane]')
      )) {
        const box = section.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width,
          y = (event.clientY - box.top) / box.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) continue;
        const edge = Math.min(x, 1 - x, y, 1 - y);
        let action =
          edge >= 0.25
            ? 'merge'
            : edge === x
              ? 'left'
              : edge === 1 - x
                ? 'right'
                : edge === y
                  ? 'top'
                  : 'bottom';
        const target = section.dataset.pane;
        const source = panes.querySelector(`[data-pane-tab="${id}"]`)?.closest('[data-pane]');
        if (
          ['top', 'bottom'].includes(action) &&
          section.parentElement.dataset.sidebarCompact === 'true' &&
          source?.parentElement === section.parentElement &&
          source.querySelectorAll('[data-pane-tab]').length === 1
        )
          action = action === 'top' ? 'before' : 'after';
        if (!['merge', 'before', 'after'].includes(action) && !splitFits(section, id, action))
          continue;
        if (arrange(layout, id, action, width, height, target)) return { action, box, id: target };
      }
      return null;
    },
  });
  function createSection(group) {
    const section = document.createElement('section');
    section.className = 'csw-workbench-pane';
    const tabs = document.createElement('nav');
    tabs.className = 'csw-workbench-tabs';
    tabs.dataset.iconTabs = '';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', tr('工作台面板'));
    for (const id of group.ids) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.dataset.paneTab = id;
      tab.setAttribute('role', 'tab');
      tab.innerHTML = iconSvg(featureIcons[id] || 'catalog');
      tabs.append(tab);
    }
    const body = document.createElement('div');
    body.className = 'csw-feature-content';
    const head = document.createElement('div');
    head.className = 'csw-feature-pane-head';
    const actions = document.createElement('div');
    actions.className = 'csw-feature-header-actions';
    head.append(tabs, actions);
    section.append(head, body);
    // Move the mounted roots before removing their old containers: preserve drafts and scroll.
    for (const item of items) if (group.ids.includes(item.id)) body.append(item.node);
    return section;
  }
  function createSeparator(container, index) {
    const separator = document.createElement('div');
    separator.className = 'csw-workbench-split';
    separator.setAttribute('role', 'separator');
    separator.tabIndex = 0;
    separator.setAttribute('aria-label', tr('调整分栏比例'));
    bindSeparator(
      separator,
      () => (container.dataset.axis === 'horizontal' ? 'x' : 'y'),
      () => {
        const { groups } = containers.get(container);
        const axis = container.dataset.axis;
        const size = axis === 'horizontal' ? 'width' : 'height';
        const scale = elementScale(container)[axis === 'horizontal' ? 'x' : 'y'];
        compact.stop(true);
        return {
          surface: placement,
          layout,
          compact: container.dataset.sidebarCompact === 'true',
          header: Number(container.dataset.compactHeader) || 36,
          groups: groups.map((group) => group.original),
          heights: groups.map(
            (_, i) => container.children[i * 2].getBoundingClientRect().height / scale,
          ),
          first: container.children[(index - 1) * 2].getBoundingClientRect()[size] / scale,
          second: container.children[index * 2].getBoundingClientRect()[size] / scale,
          scale,
          previous: groups[index - 1].original,
          next: groups[index].original,
          minimumFirst: layoutMinimum(groups[index - 1])[size],
          minimumSecond: layoutMinimum(groups[index])[size],
          axis,
        };
      },
      (start, delta) => {
        if (
          start.axis !== container.dataset.axis ||
          start.surface !== placement ||
          start.layout !== layout
        )
          return;
        if (start.compact) {
          const heights = transferRows(start.heights, index, delta, start.header);
          const total = heights.reduce((sum, height) => sum + height, 0);
          const weight = start.groups.reduce((sum, group) => sum + group.weight, 0);
          start.groups.forEach((group, i) => {
            group.weight = (weight * heights[i]) / total;
            if (heights[i] <= start.header) group.collapsed = true;
            else delete group.collapsed;
          });
          render();
          return;
        }
        const total = start.first + start.second;
        if (total < start.minimumFirst + start.minimumSecond) return;
        const ratio =
          Math.max(start.minimumFirst, Math.min(total - start.minimumSecond, start.first + delta)) /
          total;
        const weight = start.previous.weight + start.next.weight;
        start.previous.weight = weight * ratio;
        start.next.weight = weight * (1 - ratio);
        render();
      },
      () => void persist(),
    );
    return separator;
  }
  function build(node, container) {
    const fragments = [];
    node.groups.forEach((group, index) => {
      if (index) fragments.push(createSeparator(container, index));
      if (group.groups) {
        const branch = document.createElement('div');
        branch.className = 'csw-feature-split';
        build(group, branch);
        fragments.push(branch);
      } else fragments.push(createSection(group));
    });
    container.replaceChildren(...fragments);
  }
  function updateSection(section, group, focused) {
    root.lang = getLocale();
    section.querySelector('[role=tablist]')?.setAttribute('aria-label', tr('工作台面板'));
    const active = group.ids.includes(group.active) ? group.active : group.ids[0];
    section.dataset.pane = active;
    section.setAttribute('aria-label', title(active));
    const body = section.querySelector('.csw-feature-content');
    for (const item of items.filter((entry) => group.ids.includes(entry.id))) {
      if (item.node.parentNode !== body) body.append(item.node);
      item.node.hidden = !item.active || item.id !== (focused || active);
      const actions = item.mount?.headerActions;
      if (actions) {
        const slot = section.querySelector('.csw-feature-header-actions');
        if (actions.parentNode !== slot) slot.append(actions);
        actions.hidden = item.node.hidden;
      }
    }
    for (const tab of section.querySelectorAll('button[data-pane-tab]')) {
      const name = title(tab.dataset.paneTab);
      tab.setAttribute('aria-label', name);
      tab.title = name;
      const current = tab.dataset.paneTab === (focused || active);
      tab.setAttribute('aria-selected', String(current));
      tab.tabIndex = current ? 0 : -1;
    }
  }
  function updateGrid(node, container, focused) {
    const previousRows = getComputedStyle(container).gridTemplateRows;
    containers.set(container, node);
    const included = (group) =>
      !focused ||
      (group.groups
        ? layoutGroups(group).some((g) => g.ids.includes(focused))
        : group.ids.includes(focused));
    const shown = node.groups.filter(included);
    const horizontalMinimum = layoutMinimum({ ...node, axis: 'horizontal', groups: shown }).width;
    const axis =
      node.axis !== 'vertical' && container.clientWidth >= horizontalMinimum
        ? 'horizontal'
        : 'vertical';
    container.dataset.axis = axis;
    const tracks = [];
    node.groups.forEach((group, index) => {
      const element = container.children[index * 2];
      element.hidden = !included(group);
      if (index) {
        const handle = container.children[index * 2 - 1];
        handle.hidden = !!focused;
        handle.setAttribute('aria-orientation', axis === 'horizontal' ? 'vertical' : 'horizontal');
        const previous = node.groups[index - 1];
        handle.setAttribute(
          'aria-valuenow',
          String(Math.round((previous.weight / (previous.weight + group.weight)) * 100)),
        );
      }
      if (!element.hidden) {
        if (tracks.length) tracks.push('8px');
        // Narrow windows can scroll without rewriting the saved geometry.
        const minimum = layoutMinimum(group)[axis === 'horizontal' ? 'width' : 'height'];
        tracks.push(`minmax(${shown.length === 1 ? 0 : minimum}px, ${group.weight}fr)`);
      }
    });
    container.style.gridTemplateColumns =
      axis === 'horizontal' ? tracks.join(' ') : 'minmax(0,1fr)';
    const compactEnabled =
      ['sidebar', 'overlay', 'desktop'].includes(placement) &&
      axis === 'vertical' &&
      !focused &&
      node.groups.every((group) => !group.groups);
    // Capture live content before shrinking rows; an intermediate minimum-sized
    // grid could clamp a scroller before the compaction controller remembers it.
    if (!compactEnabled)
      container.style.gridTemplateRows = axis === 'vertical' ? tracks.join(' ') : 'minmax(0,1fr)';
    node.groups.forEach((group, index) => {
      const element = container.children[index * 2];
      if (group.groups) updateGrid(group, element, focused);
      else updateSection(element, group, focused);
    });
    compact.apply(node, container, compactEnabled, previousRows);
  }
  function render() {
    if (!layout) return;
    for (const item of items) {
      const excluded = !item.active || (layout.visible && !layout.visible.includes(item.id));
      if (excluded && item.node.parentNode !== parking) {
        rememberReading(item);
        item.node.hidden = true;
        parking.append(item.node);
        if (item.mount?.headerActions) parking.append(item.mount.headerActions);
      }
    }
    const tree = visible(layout);
    if (!tree) {
      observer.disconnect();
      observer.observe(panes);
      panes.replaceChildren();
      shape = null;
      return;
    }
    const signature = (node) => (node.groups ? [node.axis, node.groups.map(signature)] : node.ids);
    const nextShape = JSON.stringify(signature(tree));
    if (shape !== nextShape) {
      for (const item of items) rememberReading(item);
      shape = nextShape;
      observer.disconnect();
      observer.observe(panes);
      build(tree, panes);
      // Icon wrapping and the model heading can change after the feature mounts.
      for (const head of panes.querySelectorAll('.csw-feature-pane-head')) observer.observe(head);
    }
    const focused = arrangement.focused;
    root.dataset.composition = focused ? 'focus' : layoutGroups(tree).length > 1 ? 'split' : 'tabs';
    updateGrid(tree, panes, focused);
    for (const item of items) {
      if (item.node.hidden || item.node.parentNode === parking) continue;
      const reading = parkedReading.get(item.node);
      if (reading) {
        for (const { node, top, left } of reading) {
          writeWorkbenchScroll(node, top);
          node.scrollLeft = left;
        }
        parkedReading.delete(item.node);
      }
    }
    arrangement.sync();
    compact.finishRender();
  }
  const observer = new ResizeObserver(render);
  observer.observe(panes);
  return {
    snapshot: () => layout && structuredClone(layout),
    update(nextItems, surface, saved, legacy, reveal, revealVersion = 0) {
      items = nextItems;
      const changedSurface = placement !== surface;
      const incoming = JSON.stringify([saved, legacy]);
      if (!dirty && !saving && inputs.get(surface) !== incoming)
        for (const item of items) rememberReading(item);
      if (
        !dirty &&
        !saving &&
        inputs.has(surface) &&
        inputs.get(surface) !== incoming &&
        (JSON.stringify(saved ?? null) !== JSON.stringify(persisted.get(surface) ?? null) ||
          (!saved &&
            JSON.stringify(JSON.parse(inputs.get(surface))[1]) !== JSON.stringify(legacy ?? null)))
      ) {
        cache.delete(surface);
        if (placement === surface) placement = null;
      }
      if (!dirty && !saving && inputs.get(surface) !== incoming) {
        inputs.set(surface, incoming);
        persisted.set(surface, structuredClone(saved ?? null));
      }
      if (placement !== surface) {
        arrangement.cancel();
        compact.stop();
        placement = surface;
        shape = null;
        if (changedSurface) selected = '';
        layout = cache.get(surface) || (saved && flattenVerticalLayout(structuredClone(saved)));
        if (!layout) {
          const ids = items.filter((item) => item.active).map((item) => item.id);
          layout = resolveFeatureLayout(null, legacy, ids);
        }
        if (arrangement.focused) arrangement.command(arrangement.focused, 'focus');
      }
      const known = new Set(layoutGroups(layout).flatMap((group) => group.ids));
      for (const item of items)
        if (item.active && !known.has(item.id)) {
          layoutGroups(layout)[0].ids.push(item.id);
          known.add(item.id);
        }
      const selection = `${reveal}:${revealVersion}`;
      let revealed = false;
      if (
        reveal &&
        selected &&
        selection !== selected &&
        layout.visible &&
        !layout.visible.includes(reveal) &&
        items.some((item) => item.id === reveal && item.active)
      ) {
        layout.visible.push(reveal);
        revealed = true;
      }
      if (
        reveal &&
        selection !== selected &&
        items.some((item) => item.id === reveal && item.active) &&
        (!layout.visible || layout.visible.includes(reveal))
      ) {
        const group = layoutGroups(layout).find((group) => group.ids.includes(reveal));
        if (group) {
          group.active = reveal;
          // The initial selected feature is a snapshot, not a new request to unfold it.
          if (selected) {
            delete group.collapsed;
            compact.activate(layout, reveal, false);
          }
        }
      }
      selected = selection;
      if (revealed) void persist();
      cache.set(surface, layout);
      if (
        arrangement.focused &&
        !items.some(
          (item) =>
            item.active &&
            item.id === arrangement.focused &&
            (!layout.visible || layout.visible.includes(item.id)),
        )
      )
        arrangement.command(arrangement.focused, 'focus');
      for (const item of items)
        if (!item.active) {
          item.node.hidden = true;
          if (item.mount?.headerActions) item.mount.headerActions.hidden = true;
        }
      render();
    },
    destroy() {
      observer.disconnect();
      arrangement.destroy();
      compact.destroy();
      panes.remove();
      parking.remove();
    },
  };
}
