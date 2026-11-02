/* [INPUT]: Real composer enhancer, a local textarea and deterministic example replies.
 * [OUTPUT]: Product optimize/cancel/restore control, preserving manually edited drafts.
 * [POS]: Shared settings/website demo target and transport; never discovers a host or calls a model.
 * [PROTOCOL]: Keep settings/AGENTS.md and both consumers' browser checks in sync. */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { installPromptEnhancer } from '../codex/prompt-enhancement.js';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';

export function PromptPreview({
  tourStep,
  active = true,
  draft,
  onDraftChange,
}: {
  tourStep?: number;
  active?: boolean;
  draft?: string;
  onDraftChange?: (draft: string) => void;
}) {
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current && draft === undefined)
      editor.current!.value = tr('帮我把这个作品集方案安排一下');
  }, [locale, draft]);
  // 网站组合演示可共用草稿；设置页省略这些属性，继续持有自己的预览输入。
  useLayoutEffect(() => {
    if (draft !== undefined && editor.current && editor.current.value !== draft)
      editor.current.value = draft;
  }, [draft, locale]);
  useEffect(() => {
    if (!active) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const controller = installPromptEnhancer({
      getTarget: () => ({
        id: 'preview-prompt',
        root: root.current,
        scope: root.current,
        composer: editor.current,
      }),
      request: async (_path, data) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            timers.delete(timer);
            resolve({
              prompt:
                ('text' in data ? String(data.text) : '') === tr('帮我把这个作品集方案安排一下')
                  ? tr(
                      '请把这个个人作品集方案整理成两天内可完成的步骤，列出每一步的交付内容与检查方法。',
                    )
                  : `${'text' in data ? String(data.text) : ''}\n\n${tr('请按目标、步骤和检查方法组织回答。')}`,
            });
          }, 280);
          timers.add(timer);
        }),
    });
    return () => {
      controller.destroy();
      timers.forEach(clearTimeout);
    };
  }, [locale, active]);
  useEffect(() => {
    if (!active || tourStep === undefined || edited.current) return;
    const button = root.current
      ?.querySelector('[data-palboo-prompt]')
      ?.shadowRoot?.querySelector('button');
    if (button?.getAttribute('aria-label') === tr(tourStep === 1 ? '优化提示词' : '恢复原提示词'))
      button.click();
  }, [tourStep, locale, active]);
  return (
    <div ref={root} className="demo-composer demo-prompt" data-codex-composer-root>
      <textarea
        ref={editor}
        aria-label={tr('提示词优化演示')}
        defaultValue={tr('帮我把这个作品集方案安排一下')}
        onInput={(event) => {
          if (event.nativeEvent.isTrusted) edited.current = true;
          onDraftChange?.(event.currentTarget.value);
          if (!event.nativeEvent.isTrusted && tourStep === 1)
            event.currentTarget.scrollTop = event.currentTarget.scrollHeight;
        }}
        rows={3}
      />
    </div>
  );
}
