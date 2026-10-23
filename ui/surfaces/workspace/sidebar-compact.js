/* [INPUT]: Existing mounted panes, vertical leaf groups, saved collapse flags and shared reading helpers.
 * [OUTPUT]: Independent title-row folding including all-closed, restored reading and interruptible grid motion.
 * [POS]: Workspace presentation; does not store bodies or create owners.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { compactRows } from './compact-rows.js';
import { readWorkbenchScroll, writeWorkbenchScroll } from '../../shared/scroll.js';

export function installSidebarCompact(panes) {
  const held = new Map();
  const animations = new Map();
  const targets = new WeakMap();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let animateNext = false;
  let keyboard = false;
  const pointerInput = () => {
    keyboard = false;
  };
  const keyInput = () => {
    keyboard = true;
  };
  panes.addEventListener('pointerdown', pointerInput, true);
  panes.addEventListener('keydown', keyInput, true);
  function readings(root) {
    const result = [];
    function walk(element) {
      if (element.scrollTop || element.scrollLeft)
        result.push({
          element,
          top: readWorkbenchScroll(element),
          left: element.scrollLeft,
          identity: element.closest('[data-reading-key]')?.dataset.readingKey,
        });
      for (const child of element.children) walk(child);
      if (element.shadowRoot) for (const child of element.shadowRoot.children) walk(child);
    }
    walk(root);
    return result;
  }
  function collapse(section, closed) {
    const body = section.querySelector('.csw-feature-content');
    if (!body) return;
    if (closed && !held.has(body)) {
      held.set(body, readings(body));
      // Keep the actual content viewport alive behind the clipped header.
      body.style.flex = `0 0 ${Math.max(84, body.offsetHeight)}px`;
    }
    section.dataset.compact = String(closed);
    body.inert = closed;
    body.setAttribute('aria-hidden', String(closed));
    for (const tab of section.querySelectorAll('[data-pane-tab]'))
      tab.setAttribute('aria-expanded', String(!closed));
    if (!closed && held.has(body)) {
      body.style.removeProperty('flex');
      const entries = held.get(body);
      held.delete(body);
      for (const { element, top, left, identity } of entries) {
        if (
          element.isConnected &&
          element.closest('[data-reading-key]')?.dataset.readingKey === identity
        ) {
          writeWorkbenchScroll(element, top);
          element.scrollLeft = left;
        }
      }
    }
  }
  function stop(freeze = false) {
    for (const [container, animation] of animations) {
      const current = freeze
        ? getComputedStyle(container).gridTemplateRows
        : targets.get(container);
      animation.cancel();
      if (current) container.style.gridTemplateRows = current;
    }
    animations.clear();
  }
  const onReduced = () => stop();
  reduced.addEventListener('change', onReduced);
  return {
    finishRender() {
      animateNext = false;
      for (const body of held.keys())
        if (!panes.contains(body)) collapse(body.parentElement, false);
    },
    stop,
    apply(node, container, enabled, previous) {
      const eligible = enabled && node.groups.every((group) => !group.groups);
      container.dataset.sidebarCompact = String(eligible);
      const sections = [...container.children].filter((el) => el.matches('section[data-pane]'));
      if (!eligible) {
        animations.get(container)?.cancel();
        animations.delete(container);
        targets.delete(container);
        for (const section of sections) {
          collapse(section, false);
          delete section.dataset.compact;
          for (const tab of section.querySelectorAll('[data-pane-tab]'))
            tab.removeAttribute('aria-expanded');
        }
        return null;
      }
      const header = Math.max(
        36,
        ...sections.map((section) => section.querySelector('.csw-feature-pane-head').offsetHeight),
      );
      container.dataset.compactHeader = String(header);
      const style = getComputedStyle(container);
      const height =
        container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const rows = compactRows(
        node.groups.map((group) => group.weight),
        height,
        header,
        8,
        node.groups.map((group) => group.collapsed === true),
      );
      rows.forEach((row, i) => collapse(sections[i], row.collapsed));
      const tracks = rows
        .flatMap((row, i) => (i ? ['8px', `${row.height}px`] : [`${row.height}px`]))
        .join(' ');
      const existing = animations.get(container);
      container.style.gridTemplateRows = tracks;
      if (targets.get(container) !== tracks) {
        existing?.cancel();
        animations.delete(container);
        targets.set(container, tracks);
        if (
          animateNext &&
          !reduced.matches &&
          previous !== 'none' &&
          previous.split(' ').length === tracks.split(' ').length
        ) {
          const animation = container.animate(
            [{ gridTemplateRows: previous }, { gridTemplateRows: tracks }],
            { duration: 200, easing: 'cubic-bezier(.22,1,.36,1)' },
          );
          animations.set(container, animation);
          animation.finished
            .then(() => {
              if (animations.get(container) === animation) animations.delete(container);
            })
            .catch(() => {});
        }
      }
      return tracks;
    },
    activate(layout, id, wasActive) {
      const section = [...panes.querySelectorAll('section[data-pane]')].find((el) =>
        el.querySelector(`[data-pane-tab="${id}"]`),
      );
      if (!section?.hasAttribute('data-compact')) return;
      const closed = section.dataset.compact === 'true';
      if (!closed && !wasActive) return;
      function visit(node) {
        const index = node.groups.findIndex((group) => !group.groups && group.ids.includes(id));
        if (index >= 0 && node.groups.every((group) => !group.groups)) {
          if (!closed) {
            node.groups[index].collapsed = true;
            return;
          }
          delete node.groups[index].collapsed;
          const total = node.groups.reduce((sum, group) => sum + group.weight, 0);
          node.groups.forEach((group, i) => {
            group.weight = total * (i === index ? 0.9 : 0.1 / (node.groups.length - 1));
          });
        } else for (const group of node.groups) if (group.groups) visit(group);
      }
      visit(layout);
      animateNext = !keyboard;
    },
    destroy() {
      stop();
      reduced.removeEventListener('change', onReduced);
      panes.removeEventListener('pointerdown', pointerInput, true);
      panes.removeEventListener('keydown', keyInput, true);
      for (const body of held.keys()) collapse(body.parentElement, false);
      held.clear();
    },
  };
}
