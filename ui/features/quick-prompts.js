import { getLocale } from '../shared/i18n.js';
/* [INPUT]: 独立常用语投影、临时编辑草稿、受保护的填入与保存回调。
 * [OUTPUT]: 不依赖建议生成状态的常用语视图，保留单击/双击规则和失败草稿。
 * [POS]: 复用既有预设编辑器；聊天身份和写入验证留在 codex。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createQuickPrompts } from './next/quick-prompts.js';
import { PROMPT_CLICK_DELAY_MS } from '../shared/constants.js';

export function createQuickPromptsView({
  read,
  reading,
  command,
  saveQuickPrompts,
  changed = () => {},
  includeQuickPrompts: _unused = false,
}) {
  let timer = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
  };
  const identity = () => {
    const value = read();
    return JSON.stringify([
      value.instanceId,
      value.viewToken,
      value.context?.sessionId || value.context?.paneKey,
      value.quickPromptToken,
      value.settings?.quickPrompts,
      value.settings?.quickPromptsEnabled,
    ]);
  };
  const editor = createQuickPrompts({
    read,
    reading,
    save: saveQuickPrompts,
    beforeEdit: cancel,
    rendered: (root) => {
      bindClicks(root);
      changed();
    },
  });
  function bindClicks(root) {
    root.querySelectorAll('[data-quick-prompt]').forEach((button) => {
      const choose = (detail) => {
        const index = Number(button.dataset.quickPrompt);
        const item = editor.state().items[index];
        if (
          !item?.prompt ||
          JSON.stringify(item) !== JSON.stringify(read().settings?.quickPrompts?.[index])
        )
          return;
        const mode =
          read().settings?.quickPromptClickMode || read().display?.promptClickMode || 'fill';
        command('quick-fill', {
          index,
          submit: mode === 'direct' || (mode === 'hybrid' && detail >= 2),
        });
      };
      button.addEventListener('click', (event) => {
        cancel();
        if (event.detail >= 2) {
          event.preventDefault();
          choose(event.detail);
          return;
        }
        const current = identity();
        timer = window.setTimeout(() => {
          timer = 0;
          if (button.isConnected && current === identity()) choose(1);
        }, PROMPT_CLICK_DELAY_MS);
      });
      button.addEventListener('dblclick', (event) => event.preventDefault());
    });
  }
  return {
    html: () => editor.html(),
    key: () =>
      JSON.stringify([
        getLocale(),
        identity(),
        read().settings?.quickPromptClickMode,
        read().display?.promptClickMode,
      ]),
    bind: (root) => {
      editor.bind(root);
      bindClicks(root);
    },
    clear: () => {
      cancel();
      editor.clear();
    },
    setDisabled: editor.setDisabled,
  };
}
