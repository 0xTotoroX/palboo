import { tr, getLocale } from '../../shared/i18n.js';
/* [INPUT]: Shared feature icons, live mounts with header actions, per-surface layout and authenticated save callback.
 * [OUTPUT]: Flat/nested layout interpretation, icon tabs, local split/merge, focus, persistent title folding and resizing with checked saves; views stay mounted.
 * [POS]: Presentation-only composition; reuses the workbench gestures and styles.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { featureIcons, titles } from '../../shared/features';
import { iconSvg } from '../../shared/icons/index.js';
import { compactColumnWidth, installSidebarCompact } from './sidebar-compact.js';
import { transferRows } from './compact-rows.js';
import { installArrangement } from './arrangement.js';
import { bindSeparator, elementScale } from './separator.js';
import { readWorkbenchScroll, writeWorkbenchScroll } from '../../shared/scroll.js';
import { layoutSignature } from './layout-presets.js';
import {
  layoutGroups,
  layoutMinimum,
  arrangeFeatureLayout,
  flattenVerticalLayout,
} from './layout-tree.js';

const mergeOverdrag = 48;

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

export function installFeatureLayout(root, { save, error, inlineMenu = false }) {
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
  const undoLayouts = new Map();
  let shownMergeHint = false;
  let menuAnchor;
  /** @param {Element} [container] */
  function positionMenu(container = panes) {
    if (!inlineMenu) return;
    const children = [...container.children].filter(
      (child) => !child.matches('[hidden], [role="separator"]'),
    );
    const horizontal = container.getAttribute('data-axis') === 'horizontal';
    const topRight = horizontal ? children.at(-1) : children[0];
    if (topRight?.classList.contains('csw-feature-split')) {
      positionMenu(topRight);
      return;
    }
    const header = topRight?.querySelector('.csw-feature-pane-head');
    if (header !== menuAnchor) {
      menuAnchor?.removeAttribute('data-menu-anchor');
      menuAnchor = header;
      menuAnchor?.setAttribute('data-menu-anchor', '');
    }
    root.toggleAttribute('data-inline-menu', !!header);
    if (!header) return;
    const box = root.getBoundingClientRect();
    const scale = elementScale(root);
    const pane = topRight.getBoundingClientRect();
    const row = header.getBoundingClientRect();
    const menuTop =
      row.height && !(horizontal && topRight.matches('[data-compact="true"]'))
        ? (row.top - box.top + row.height / 2) / scale.y - 14
        : (pane.top - box.top) / scale.y + 4;
    root.style.setProperty('--csw-menu-top', `${Math.max(0, menuTop)}px`);
    root.style.setProperty('--csw-menu-right', `${(box.right - pane.right) / scale.x + 8}px`);
  }
  function highlightMergedTabs(ids) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const id of ids) {
      panes
        .querySelector(`[data-pane-tab="${id}"]`)
        ?.animate(
          [
            { backgroundColor: 'color-mix(in srgb, var(--csw-accent) 24%, transparent)' },
            { backgroundColor: 'transparent' },
          ],
          { duration: 360, easing: 'ease-out' },
        );
    }
  }
  function rememberLayout(previous, next, surface = placement) {
    if (previous && next && layoutSignature(previous) !== layoutSignature(next))
      undoLayouts.set(surface, previous);
  }
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
      undoLayouts.delete(surface);
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
    write: (next, id, action, target) => {
      const merged =
        ['merge', 'tab-before', 'tab-after'].includes(action) &&
        !layoutGroups(layout).some((group) => group.ids.includes(id) && group.ids.includes(target));
      rememberLayout(layout, next);
      layout = next;
      cache.set(placement, layout);
      render();
      if (merged) highlightMergedTabs([id]);
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
        const rowEdge = Math.min(6, box.height / 4);
        const fromTop = event.clientY - box.top;
        if (
          section.dataset.compact === 'true' &&
          section.parentElement.dataset.axis === 'vertical' &&
          source?.parentElement === section.parentElement &&
          source.querySelectorAll('[data-pane-tab]').length === 1 &&
          (fromTop <= rowEdge || box.height - fromTop <= rowEdge)
        ) {
          const action = fromTop <= rowEdge ? 'before' : 'after';
          if (arrange(layout, id, action, width, height, target))
            return { action, box, id: target };
        }
        const tab = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('[data-pane-tab]');
        if (tab instanceof HTMLElement && section.contains(tab)) {
          if (tab.dataset.paneTab === id) return null;
          const rect = tab.getBoundingClientRect();
          const vertical =
            tab.closest('[role="tablist"]').getAttribute('aria-orientation') === 'vertical';
          const offset = vertical
            ? (event.clientY - rect.top) / rect.height
            : (event.clientX - rect.left) / rect.width;
          const after = offset >= 0.5;
          const action = after ? 'tab-after' : 'tab-before';
          if (
            (source === section || offset < 1 / 3 || offset > 2 / 3) &&
            arrange(layout, id, action, width, height, tab.dataset.paneTab)
          ) {
            const marker = vertical
              ? new DOMRect(rect.left, (after ? rect.bottom : rect.top) - 1, rect.width, 2)
              : new DOMRect((after ? rect.right : rect.left) - 1, rect.top, 2, rect.height);
            return { action, box: marker, id: tab.dataset.paneTab };
          }
        }
        const tabs = section.querySelector('[role="tablist"]').getBoundingClientRect();
        if (
          source !== section &&
          event.clientX >= tabs.left &&
          event.clientX <= tabs.right &&
          event.clientY >= tabs.top &&
          event.clientY <= tabs.bottom &&
          arrange(layout, id, 'merge', width, height, target)
        )
          return { action: 'merge', box, id: target };
        if (
          ['top', 'bottom'].includes(action) &&
          section.parentElement.dataset.axis === 'vertical' &&
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
    function previewMerge(start, delta, room) {
      if (!start.previous.ids || !start.next.ids || !delta || Math.abs(delta) < room) return;
      if (Math.abs(delta) >= room + mergeOverdrag) {
        start.merge = delta < 0 ? -1 : 1;
        separator.dataset.mergePreview = tr('合并为标签');
        separator.dataset.mergeSide = start.merge < 0 ? 'previous' : 'next';
      } else if (!shownMergeHint) {
        start.hinted = true;
        separator.dataset.mergePreview = tr('继续拖动可合并');
      }
    }
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
          before: structuredClone(layout),
          compact: container.dataset.sidebarCompact === 'true',
          header: Number(container.dataset.compactHeader) || 36,
          groups: groups.map((group) => group.original),
          geometry: groups.map(({ original: { weight, collapsed } }) => ({ weight, collapsed })),
          branchMinimums: groups.map((group) => (group.groups ? layoutMinimum(group)[size] : 0)),
          sizes: groups.map(
            (_, i) => container.children[i * 2].getBoundingClientRect()[size] / scale,
          ),
          first: container.children[(index - 1) * 2].getBoundingClientRect()[size] / scale,
          second: container.children[index * 2].getBoundingClientRect()[size] / scale,
          scale,
          previous: groups[index - 1].original,
          next: groups[index].original,
          minimumFirst: layoutMinimum(groups[index - 1])[size],
          minimumSecond: layoutMinimum(groups[index])[size],
          axis,
          merge: 0,
          hinted: false,
        };
      },
      (start, delta, pointer) => {
        delete separator.dataset.mergePreview;
        delete separator.dataset.mergeSide;
        start.merge = 0;
        if (
          start.axis !== container.dataset.axis ||
          start.surface !== placement ||
          start.layout !== layout
        )
          return;
        if (start.compact) {
          if (pointer) {
            const adjacent = delta < 0 ? index - 1 : index;
            const floor = start.branchMinimums[adjacent] || start.header;
            previewMerge(start, delta, Math.max(0, start.sizes[adjacent] - floor));
          }
          const sizes = transferRows(
            start.sizes,
            index,
            delta,
            start.header,
            start.branchMinimums,
            start.axis === 'vertical',
          );
          const changed = sizes[index] !== start.sizes[index];
          const total = sizes.reduce((sum, size) => sum + size, 0);
          const weight = start.geometry.reduce((sum, group) => sum + group.weight, 0);
          start.groups.forEach((group, i) => {
            group.weight = changed ? (weight * sizes[i]) / total : start.geometry[i].weight;
            const resized = i === index || i === index - 1;
            const collapsed =
              changed && resized && !start.branchMinimums[i]
                ? sizes[i] <= start.header
                : start.geometry[i].collapsed;
            if (collapsed) group.collapsed = true;
            else delete group.collapsed;
          });
          render();
          return;
        }
        const total = start.first + start.second;
        if (total < start.minimumFirst + start.minimumSecond) return;
        const width = start.first + delta;
        if (pointer && start.axis === 'horizontal')
          previewMerge(
            start,
            delta,
            delta < 0 ? start.first - start.minimumFirst : start.second - start.minimumSecond,
          );
        const ratio =
          Math.max(start.minimumFirst, Math.min(total - start.minimumSecond, width)) / total;
        const weight = start.previous.weight + start.next.weight;
        start.previous.weight = weight * ratio;
        start.next.weight = weight * (1 - ratio);
        render();
      },
      (start, dropped) => {
        let mergedIds = [];
        delete separator.dataset.mergePreview;
        delete separator.dataset.mergeSide;
        if (start?.hinted) shownMergeHint = true;
        if (start && (start.surface !== placement || start.layout !== layout)) return;
        if (dropped && start.merge && start.axis === container.dataset.axis) {
          const [source, target] =
            start.merge < 0 ? [start.previous, start.next] : [start.next, start.previous];
          const visibleIds = items.filter(isShown).map((item) => item.id);
          const targetId =
            target.ids.includes(target.active) && visibleIds.includes(target.active)
              ? target.active
              : target.ids.find((id) => visibleIds.includes(id));
          const sourceIds = source.ids.filter((id) => visibleIds.includes(id));
          if (targetId && sourceIds.length) {
            // Discard temporary size transfers before merging compact neighbors.
            let next = start.compact ? start.before : layout;
            for (const id of sourceIds)
              next = arrangeFeatureLayout(next, id, 'merge', 0, 0, targetId, visibleIds);
            layoutGroups(next).find((group) => group.ids.includes(targetId)).active = targetId;
            layout = flattenVerticalLayout(next);
            cache.set(placement, layout);
            mergedIds = sourceIds;
          }
        } else if (dropped && start.compact && start.axis === 'horizontal') {
          compact.settle();
        }
        render();
        if (mergedIds.length) highlightMergedTabs(mergedIds);
        if (start) rememberLayout(start.before, layout);
        void persist();
      },
      (start) => {
        if (start.surface !== placement || start.layout !== layout) return;
        delete separator.dataset.mergePreview;
        delete separator.dataset.mergeSide;
        layout = start.before;
        cache.set(placement, layout);
        render();
      },
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
    const tabs = section.querySelector('[role=tablist]');
    tabs.setAttribute('aria-label', tr('工作台面板'));
    tabs.setAttribute(
      'aria-orientation',
      panes.dataset.tabPosition === 'left' ? 'vertical' : 'horizontal',
    );
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
    containers.set(container, node);
    const included = (group) =>
      !focused ||
      (group.groups
        ? layoutGroups(group).some((g) => g.ids.includes(focused))
        : group.ids.includes(focused));
    const shown = node.groups.filter(included);
    const horizontalMinimum =
      Math.max(0, shown.length - 1) * 8 +
      shown.reduce(
        (sum, group) =>
          sum +
          (!group.groups && group.collapsed ? compactColumnWidth : layoutMinimum(group).width),
        0,
      );
    const axis =
      node.axis !== 'vertical' && container.clientWidth >= horizontalMinimum
        ? 'horizontal'
        : 'vertical';
    container.dataset.axis = axis;
    const computed = getComputedStyle(container);
    const previous =
      axis === 'horizontal' ? computed.gridTemplateColumns : computed.gridTemplateRows;
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
    const compactEnabled =
      ['sidebar', 'overlay', 'desktop'].includes(placement) &&
      (axis === 'vertical' || node.groups.length > 1) &&
      panes.dataset.tabPosition !== 'left' &&
      !focused &&
      node.groups.some((group) => !group.groups);
    // Capture live content before shrinking rows; an intermediate minimum-sized
    // grid could clamp a scroller before the compaction controller remembers it.
    if (!compactEnabled || axis === 'vertical')
      container.style.gridTemplateColumns =
        axis === 'horizontal' ? tracks.join(' ') : 'minmax(0,1fr)';
    if (!compactEnabled || axis === 'horizontal')
      container.style.gridTemplateRows = axis === 'vertical' ? tracks.join(' ') : 'minmax(0,1fr)';
    node.groups.forEach((group, index) => {
      const element = container.children[index * 2];
      if (group.groups) updateGrid(group, element, focused);
      else updateSection(element, group, focused);
    });
    compact.apply(node, container, compactEnabled, previous);
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
      positionMenu();
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
    const merged = layoutGroups(tree).length === 1;
    root.dataset.composition = focused ? 'focus' : merged ? 'tabs' : 'split';
    panes.dataset.tabPosition = merged && layout.tabPosition === 'left' ? 'left' : 'top';
    updateGrid(tree, panes, focused);
    positionMenu();
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
  function includeNewItems() {
    const groups = layoutGroups(layout);
    const known = new Set(groups.flatMap((group) => group.ids));
    for (const item of items) if (item.active && !known.has(item.id)) groups[0].ids.push(item.id);
  }
  return {
    snapshot: () => layout && structuredClone(layout),
    canUndo: () => !saving && undoLayouts.has(placement),
    async undo() {
      const previous = undoLayouts.get(placement);
      if (!previous || saving) return;
      undoLayouts.delete(placement);
      if (arrangement.focused) arrangement.command(arrangement.focused, 'focus');
      layout = structuredClone(previous);
      // A feature may have opened since the edit being undone.
      includeNewItems();
      cache.set(placement, layout);
      render();
      await persist();
    },
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
        const ids = items.filter((item) => item.active).map((item) => item.id);
        rememberLayout(cache.get(surface), resolveFeatureLayout(saved, legacy, ids), surface);
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
      includeNewItems();
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
      root.removeAttribute('data-inline-menu');
    },
  };
}
