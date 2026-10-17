/* [INPUT]: Projected quick prompts, transient reading state and revision-checked settings save.
 * [OUTPUT]: Underlined shortcuts with inline add/edit, confirmed removal and retained failure drafts.
 * [POS]: Next-step content only; adapters own transport and settings own persistence.
 * [PROTOCOL]: Keep next/AGENTS.md in sync. */
import { escapeAttr, escapeHtml } from '../../shared/text.js';
import { iconSvg } from '../../shared/icons/index.js';

export function createQuickPrompts({ read, reading, save, beforeEdit, rendered }) {
  let root,
    busy = false,
    disabled = false,
    error = '';
  const state = () => {
    const settings = read().settings || {};
    const saved = reading.quickPromptSaved;
    return saved && saved.revision >= settings.configurationRevision
      ? saved
      : { items: settings.quickPrompts || [], revision: settings.configurationRevision };
  };
  const iconButton = (action, icon, label, extra = '') =>
    `<button type="button" class="csw-quick-action" data-quick-action="${action}" aria-label="${label}" title="${label}" ${extra}>${iconSvg(icon)}</button>`;
  function editorHtml(draft) {
    if (!draft) return '';
    const cancel = '<button type="button" data-quick-action="cancel">取消</button>';
    if (draft.remove)
      return `<div class="csw-quick-editor" role="group" aria-label="确认删除快捷指令"><p>删除“${escapeHtml(draft.label)}”？</p><div class="csw-quick-editor-actions">${cancel}<button type="button" data-quick-action="confirm-delete">确认删除</button></div></div>`;
    return `<form class="csw-quick-editor" aria-label="${draft.index === null ? '添加' : '编辑'}快捷指令"><label>名称<input name="label" aria-label="快捷指令名称" maxlength="20" required value="${escapeAttr(draft.label)}"></label><label>指令内容<textarea name="prompt" aria-label="快捷指令内容" maxlength="4000" rows="3" required>${escapeHtml(draft.prompt)}</textarea></label><div class="csw-quick-editor-actions">${cancel}<button type="submit">保存</button></div></form>`;
  }
  function html() {
    const { items } = state();
    const editing = reading.quickPromptEditing;
    const tags = items
      .map((item, index) => {
        const remove = editing
          ? iconButton('delete:' + index, 'close', '删除快捷指令 ' + escapeAttr(item.label))
          : '';
        return `<div class="csw-quick-tag"><button type="button" class="csw-quick-prompt" data-quick-prompt="${index}" ${editing ? 'aria-description="点击编辑快捷指令"' : ''}>${escapeHtml(item.label)}</button>${remove}</div>`;
      })
      .join('');
    const actions = save
      ? `<div class="csw-quick-actions">${iconButton('edit', 'pencil', editing ? '完成编辑快捷指令' : '编辑快捷指令', `aria-pressed="${!!editing}"`)}${iconButton('add', 'plus', '添加快捷指令')}</div>`
      : '';
    const feedback = error || (busy ? '正在保存…' : '');
    return `<div class="csw-quick-area"><div class="csw-quick-prompts" aria-label="常用提示词" data-editing="${!!editing}">${tags}${actions}</div>${editorHtml(reading.quickPromptDraft)}<div class="csw-quick-feedback" role="status" ${feedback ? '' : 'hidden'}>${escapeHtml(feedback)}</div></div>`;
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
      root.querySelector('input, [data-quick-action="cancel"]')?.focus();
      return;
    }
    const { items, revision } = state();
    if (index === null && items.length >= 8) return;
    beforeEdit();
    reading.quickPromptDraft = {
      index,
      remove,
      label: index === null ? '' : items[index].label,
      prompt: index === null ? '' : items[index].prompt,
      revision,
      items: structuredClone(items),
    };
    error = '';
    repaint(remove ? '[data-quick-action="cancel"]' : 'input');
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
    if (!draft.remove && (!draft.label.trim() || !draft.prompt.trim())) return;
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
        throw Error('未收到保存确认，请重试');
      reading.quickPromptSaved = {
        items: result.quickPrompts,
        revision: result.configurationRevision,
      };
      delete reading.quickPromptDraft;
    } catch (e) {
      error = e.message || '保存失败，请重试';
    } finally {
      busy = false;
      repaint(error ? 'input, [data-quick-action="cancel"]' : '[data-quick-action="add"]');
    }
  }
  function setDisabled(value) {
    disabled = value;
    if (!root) return;
    root.querySelectorAll('button,input,textarea').forEach((n) => {
      n.disabled =
        busy || disabled || (n.dataset.quickAction === 'add' && state().items.length >= 8);
    });
  }
  function bind(node) {
    root = node.matches('.csw-quick-area') ? node : node.querySelector('.csw-quick-area');
    if (!root) return;
    setDisabled(disabled);
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
            root.querySelector('input, [data-quick-action="cancel"]')?.focus();
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
      root = null;
    },
  };
}
