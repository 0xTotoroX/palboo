import { tr } from '../../shared/i18n.js';
/* [INPUT]: Projected quick prompts, transient reading state and revision-checked settings save.
 * [OUTPUT]: Content-first standalone phrases or compact names, independent long-text disclosure, optional-name editing and retained failure drafts.
 * [POS]: Shared quick-prompt editor; adapters own transport and settings own persistence.
 * [PROTOCOL]: Keep next/AGENTS.md in sync. */
import { escapeAttr, escapeHtml, hashText } from '../../shared/text.js';
import { iconSvg } from '../../shared/icons/index.js';
import { quickPromptName } from '../../shared/quick-prompts.js';

let nextViewId = 0;

export function createQuickPrompts({
  read,
  reading,
  save,
  beforeEdit,
  rendered,
  expanded = false,
}) {
  let root,
    sizes,
    busy = false,
    disabled = false,
    error = '';
  const viewId = ++nextViewId;
  const itemKey = (item) => hashText(JSON.stringify(item));
  const state = () => {
    const settings = read().settings || {};
    const saved = reading.quickPromptSaved;
    return saved && saved.revision >= settings.configurationRevision
      ? saved
      : { items: settings.quickPrompts || [], revision: settings.configurationRevision };
  };
  const iconButton = (action, icon, label, extra = '') =>
    `<button type="button" class="csw-quick-action" data-quick-action="${action}" aria-label="${label}" ${extra}>${iconSvg(icon)}</button>`;
  function editorHtml(draft) {
    if (!draft) return '';
    const cancel = `<button type="button" data-quick-action="cancel">${tr('取消')}</button>`;
    if (draft.remove)
      return `<div class="csw-quick-editor" role="group" aria-label="${tr('确认删除快捷指令')}"><p>${escapeHtml(tr('删除“{{name}}”？', { name: quickPromptName(draft) }))}</p><div class="csw-quick-editor-actions">${cancel}<button type="button" data-quick-action="confirm-delete">${tr('确认删除')}</button></div></div>`;
    return `<form class="csw-quick-editor" aria-label="${draft.index === null ? tr('添加快捷指令') : tr('编辑快捷指令')}"><label>${tr('指令内容')}<textarea name="prompt" aria-label="${tr('快捷指令内容')}" maxlength="4000" rows="4" required>${escapeHtml(draft.prompt)}</textarea></label><label>${tr('短名称（选填）')}<input name="label" aria-label="${tr('快捷指令名称')}" maxlength="20" placeholder="${tr('留空时使用内容开头')}" value="${escapeAttr(draft.label)}"></label><div class="csw-quick-editor-actions">${cancel}<button type="submit">${tr('保存')}</button></div></form>`;
  }
  function html() {
    const { items } = state();
    const editing = reading.quickPromptEditing;
    const namesOnly = !expanded || !!read().settings?.quickPromptLabelOnly;
    const validKeys = new Set(items.map(itemKey));
    reading.quickPromptExpanded = (reading.quickPromptExpanded || []).filter((key) =>
      validKeys.has(key),
    );
    const tags = items
      .map((item, index) => {
        const name = quickPromptName(item);
        const remove = editing
          ? iconButton('delete:' + index, 'close', tr('删除快捷指令 ') + escapeAttr(name))
          : '';
        const description = editing
          ? tr('aria-description="点击编辑快捷指令"')
          : item.prompt.trim() !== name
            ? `aria-description="${escapeAttr(item.prompt)}"`
            : '';
        const open = reading.quickPromptExpanded.includes(itemKey(item));
        const bodyId = `quick-phrase-${viewId}-${index}`;
        const caption =
          item.label?.trim() && item.label.trim() !== item.prompt.trim()
            ? `<span class="csw-quick-caption" hidden>${escapeHtml(item.label)}</span>`
            : '';
        const content = namesOnly
          ? escapeHtml(name)
          : `${caption}<span id="${bodyId}" class="csw-quick-text">${escapeHtml(item.prompt)}</span>`;
        const disclosure = namesOnly
          ? ''
          : `<button type="button" class="csw-quick-disclosure" data-quick-expand="${index}" aria-controls="${bodyId}" aria-expanded="${open}" hidden>${open ? tr('收起内容') : tr('展开全文')}</button>`;
        return `<div class="csw-quick-tag" data-open="${open}"><button type="button" class="csw-quick-prompt" data-quick-prompt="${index}" aria-label="${escapeAttr(name)}" ${description}>${content}</button>${disclosure}${remove}</div>`;
      })
      .join('');
    const actions = save
      ? `<div class="csw-quick-actions">${iconButton('edit', 'pencil', editing ? tr('完成编辑快捷指令') : tr('编辑快捷指令'), `aria-pressed="${!!editing}"`)}${iconButton('add', 'plus', tr('添加快捷指令'))}</div>`
      : '';
    const feedback = error || (busy ? tr('正在保存…') : '');
    return `<div class="csw-quick-area" data-expanded="${expanded}" data-names-only="${namesOnly}"><div class="csw-quick-prompts" aria-label="${tr('常用提示词')}" data-editing="${!!editing}">${tags}${actions}</div>${editorHtml(reading.quickPromptDraft)}<div class="csw-quick-feedback" role="status" ${feedback ? '' : 'hidden'}>${escapeHtml(feedback)}</div></div>`;
  }
  function repaint(focus) {
    if (!root?.isConnected) return;
    const holder = document.createElement('div');
    holder.innerHTML = html();
    const next = holder.firstElementChild;
    root.replaceWith(next);
    bind(next);
    rendered(next);
    if (focus) next.querySelector(focus)?.focus();
  }
  function begin(index = null, remove = false) {
    if (busy || disabled) return;
    // Keep an unfinished editor until the user saves or cancels it.
    if (reading.quickPromptDraft) {
      root.querySelector('textarea, [data-quick-action="cancel"]')?.focus();
      return;
    }
    const { items, revision } = state();
    if (index === null && items.length >= 8) return;
    beforeEdit();
    reading.quickPromptDraft = {
      index,
      remove,
      label: index === null ? '' : items[index].label || '',
      prompt: index === null ? '' : items[index].prompt,
      revision,
      items: structuredClone(items),
    };
    error = '';
    repaint(remove ? '[data-quick-action="cancel"]' : 'textarea');
  }
  function cancel() {
    if (busy || disabled) return;
    delete reading.quickPromptDraft;
    error = '';
    repaint('[data-quick-action="' + (reading.quickPromptEditing ? 'edit' : 'add') + '"]');
  }
  async function submit() {
    const draft = reading.quickPromptDraft;
    if (!draft || busy || disabled || !save) return;
    if (!draft.remove && !draft.prompt.trim()) return;
    const items = structuredClone(draft.items);
    if (draft.remove) items.splice(draft.index, 1);
    else if (draft.index === null)
      items.push({ label: draft.label.trim(), prompt: draft.prompt.trim() });
    else items[draft.index] = { label: draft.label.trim(), prompt: draft.prompt.trim() };
    busy = true;
    error = '';
    repaint();
    try {
      const result = await save(items, draft.revision);
      if (
        !result ||
        !Array.isArray(result.quickPrompts) ||
        !Number.isFinite(result.configurationRevision)
      )
        throw Error(tr('未收到保存确认，请重试'));
      reading.quickPromptSaved = {
        items: result.quickPrompts,
        revision: result.configurationRevision,
      };
      delete reading.quickPromptDraft;
    } catch (e) {
      error = e.message || tr('保存失败，请重试');
    } finally {
      busy = false;
      repaint(error ? 'textarea, [data-quick-action="cancel"]' : '[data-quick-action="add"]');
    }
  }
  function setDisabled(value) {
    disabled = value;
    if (!root) return;
    root.querySelectorAll('button,input,textarea').forEach((n) => {
      n.disabled =
        n.dataset.quickExpand === undefined &&
        (busy || disabled || (n.dataset.quickAction === 'add' && state().items.length >= 8));
    });
  }
  function syncDisclosure() {
    if (!root?.clientWidth) return;
    root.querySelectorAll('[data-quick-expand]').forEach((button) => {
      const tag = button.parentElement;
      const text = tag.querySelector('.csw-quick-text');
      const overflow = text.scrollHeight > parseFloat(getComputedStyle(text).lineHeight) * 3 + 1;
      button.hidden = !overflow;
      const caption = tag.querySelector('.csw-quick-caption');
      if (caption) caption.hidden = !overflow;
    });
  }
  function bind(node) {
    sizes?.disconnect();
    root = node.matches('.csw-quick-area') ? node : node.querySelector('.csw-quick-area');
    if (!root) return;
    setDisabled(disabled);
    syncDisclosure();
    sizes = new ResizeObserver(syncDisclosure);
    sizes.observe(root);
    root.querySelectorAll('[data-quick-expand]').forEach((button) =>
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        beforeEdit();
        const key = itemKey(state().items[Number(button.dataset.quickExpand)]);
        const open = !reading.quickPromptExpanded.includes(key);
        reading.quickPromptExpanded = reading.quickPromptExpanded.filter((value) => value !== key);
        if (open) reading.quickPromptExpanded.push(key);
        button.parentElement.dataset.open = String(open);
        button.setAttribute('aria-expanded', String(open));
        button.textContent = open ? tr('收起内容') : tr('展开全文');
        syncDisclosure();
      }),
    );
    root.querySelectorAll('[data-quick-prompt]').forEach((button) =>
      button.addEventListener('click', (event) => {
        if (busy || disabled || reading.quickPromptEditing || reading.quickPromptDraft) {
          event.stopImmediatePropagation();
          if (reading.quickPromptEditing) begin(Number(button.dataset.quickPrompt));
        }
      }),
    );
    root.querySelectorAll('[data-quick-action]').forEach((button) =>
      button.addEventListener('click', () => {
        if (busy || disabled) return;
        const action = button.dataset.quickAction;
        if (action === 'add') begin();
        else if (action.startsWith('delete:')) begin(Number(action.split(':')[1]), true);
        else if (action === 'cancel') cancel();
        else if (action === 'confirm-delete') void submit();
        else if (action === 'edit') {
          if (reading.quickPromptDraft) {
            root.querySelector('textarea, [data-quick-action="cancel"]')?.focus();
            return;
          }
          beforeEdit();
          reading.quickPromptEditing = !reading.quickPromptEditing;
          error = '';
          repaint('[data-quick-action="edit"]');
        }
      }),
    );
    root.querySelectorAll('input,textarea').forEach((input) =>
      input.addEventListener('input', () => {
        if (reading.quickPromptDraft) reading.quickPromptDraft[input.name] = input.value;
      }),
    );
    root.querySelector('form')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229))
        event.preventDefault();
    });
    root.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void submit();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.isComposing || busy || disabled) return;
      if (reading.quickPromptDraft) {
        event.stopPropagation();
        cancel();
      } else if (reading.quickPromptEditing) {
        event.stopPropagation();
        reading.quickPromptEditing = false;
        repaint('[data-quick-action="edit"]');
      }
    });
  }
  return {
    html,
    bind,
    setDisabled,
    state,
    clear: () => {
      sizes?.disconnect();
      root = null;
    },
  };
}
