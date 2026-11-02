/* [INPUT]: Local draft, optional editor refs and preview-only input callbacks.
 * [OUTPUT]: Shared editable chat composer with a local send result and keyboard access.
 * [POS]: Settings/website presentation; never submits a host command or model request.
 * [PROTOCOL]: Keep settings/AGENTS.md and shared preview styles in sync. */
import { useEffect, useRef, useState, type Ref, type FormEvent } from 'react';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';

export function PreviewComposer({
  value,
  defaultValue,
  onValueChange,
  onInput,
  label = tr('聊天输入框'),
  editorRef,
  containerRef,
  className = '',
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onInput?: (event: FormEvent<HTMLTextAreaElement>) => void;
  label?: string;
  editorRef?: Ref<HTMLTextAreaElement>;
  containerRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  useLocale();
  const editor = useRef<HTMLTextAreaElement>(null);
  const [hasText, setHasText] = useState(!!(value ?? defaultValue)?.trim());
  const [sent, setSent] = useState('');
  useEffect(() => setHasText(!!editor.current?.value.trim()), [value, defaultValue]);
  function send() {
    const node = editor.current;
    if (!node?.value.trim()) return;
    setSent(node.value);
    if (onValueChange) onValueChange('');
    else {
      node.value = '';
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setHasText(false);
    node.focus({ preventScroll: true });
  }
  return (
    <div className="preview-composer-stack">
      {sent && (
        <p className="preview-sent-message" role="status">
          {sent}
        </p>
      )}
      <div ref={containerRef} className={`preview-composer ${className}`} data-codex-composer-root>
        <textarea
          ref={(node) => {
            editor.current = node;
            if (typeof editorRef === 'function') editorRef(node);
            else if (editorRef) editorRef.current = node;
          }}
          value={value}
          defaultValue={defaultValue}
          onChange={(event) => onValueChange?.(event.target.value)}
          onInput={(event) => {
            setHasText(!!event.currentTarget.value.trim());
            onInput?.(event);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
          aria-label={label}
          placeholder={tr('询问任何问题')}
          rows={2}
        />
        <button
          className="preview-composer-send"
          type="button"
          disabled={!hasText}
          aria-label={tr('发送消息')}
          title={tr('发送消息')}
          onClick={send}
        >
          <Icon name="arrow-up" />
        </button>
      </div>
    </div>
  );
}
