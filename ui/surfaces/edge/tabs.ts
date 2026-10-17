/* [INPUT]: Available feature IDs, persisted edge tabs and guarded feature requests.
 * [OUTPUT]: Reorderable tabs with serialized saves, keyboard movement and cold-start selection.
 * [POS]: Edge navigation only; never edits feature content or remounts views.
 * [PROTOCOL]: Keep edge/AGENTS.md in sync. */
import { titles, type EdgeTabs, type FeatureState, type Request } from '../../shared/features';
export function createEdgeTabs(
  nav: HTMLElement,
  request: Request,
  changed: () => void,
  error: (message: string) => void,
) {
  let value: EdgeTabs = { order: [], selected: '' },
    confirmed = structuredClone(value);
  let ids: string[] = [],
    revision = 0,
    dirty = false,
    saving = false,
    dragged = '',
    suppressClick = 0;
  const visible = () => [
    ...value.order.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !value.order.includes(id)),
  ];
  const selected = () => (ids.includes(value.selected) ? value.selected : visible()[0] || '');
  async function persist() {
    dirty = true;
    if (saving) return;
    saving = true;
    nav.dataset.layoutSaving = 'true';
    error('');
    try {
      while (dirty) {
        dirty = false;
        const next = structuredClone(value);
        const result = await request<FeatureState>({
          op: 'edge-tabs',
          tabs: next,
          expected: confirmed,
        });
        if (!result.edgeTabs || !Number.isFinite(result.edgeTabsRevision))
          throw Error('未收到标签保存确认');
        confirmed = result.edgeTabs;
        revision = result.edgeTabsRevision!;
      }
    } catch (e) {
      dirty = false;
      value = structuredClone(confirmed);
      error(`标签未保存：${e instanceof Error ? e.message : String(e)}`);
      render();
      changed();
    } finally {
      saving = false;
      delete nav.dataset.layoutSaving;
    }
  }
  function commit() {
    render();
    changed();
    void persist();
  }
  function select(id: string) {
    if (!ids.includes(id) || value.selected === id) return;
    value.selected = id;
    commit();
  }
  function reorder(id: string, target: string, after: boolean) {
    if (id === target || !ids.includes(id) || !ids.includes(target)) return;
    const order = [...value.order, ...ids.filter((item) => !value.order.includes(item))].filter(
      (item) => item !== id,
    );
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
    // Reordering must not implicitly activate another feature.
    value = { order, selected: selected() };
    commit();
    nav.querySelector<HTMLButtonElement>(`[data-edge-tab="${id}"]`)?.focus();
  }
  function clearDrag() {
    dragged = '';
    nav.querySelectorAll<HTMLElement>('[data-drop]').forEach((node) => delete node.dataset.drop);
    delete nav.dataset.dragging;
  }
  function render() {
    const order = visible(),
      current = selected(),
      key = order.join(':') + '|' + current;
    if (nav.dataset.key === key) return;
    const focused = nav.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.edgeTab
      : undefined;
    nav.dataset.key = key;
    nav.replaceChildren();
    for (const id of order) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = titles[id as keyof typeof titles];
      button.dataset.edgeTab = id;
      button.setAttribute('aria-pressed', String(id === current));
      button.title = '拖动调整顺序，或按 Alt + 左右方向键';
      button.draggable = true;
      button.onclick = () => {
        if (performance.now() >= suppressClick) select(id);
      };
      button.onkeydown = (event) => {
        if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const target = order[order.indexOf(id) + direction];
        if (target) reorder(id, target, direction > 0);
      };
      button.ondragstart = (event) => {
        dragged = id;
        nav.dataset.dragging = 'true';
        event.dataTransfer!.effectAllowed = 'move';
        event.dataTransfer!.setData('application/x-buddy-edge-tab', id);
      };
      button.ondragover = (event) => {
        if (!dragged || dragged === id) return;
        event.preventDefault();
        event.dataTransfer!.dropEffect = 'move';
        const box = button.getBoundingClientRect();
        button.dataset.drop = event.clientX > box.left + box.width / 2 ? 'after' : 'before';
      };
      button.ondragleave = () => delete button.dataset.drop;
      button.ondrop = (event) => {
        if (!dragged) return;
        event.preventDefault();
        const source = dragged,
          after = button.dataset.drop === 'after';
        clearDrag();
        suppressClick = performance.now() + 250;
        reorder(source, id, after);
      };
      button.ondragend = () => {
        clearDrag();
        suppressClick = performance.now() + 250;
      };
      nav.append(button);
    }
    if (focused)
      nav
        .querySelector<HTMLButtonElement>(`[data-edge-tab="${focused}"]`)
        ?.focus({ preventScroll: true });
  }
  return {
    selected,
    select,
    update(available: string[], state: FeatureState) {
      ids = available;
      if (!saving && !dirty && (state.edgeTabsRevision ?? 0) >= revision) {
        value = structuredClone(state.edgeTabs ?? { order: [], selected: '' });
        confirmed = structuredClone(value);
        revision = state.edgeTabsRevision ?? 0;
      }
      if (!dragged) render();
    },
  };
}
