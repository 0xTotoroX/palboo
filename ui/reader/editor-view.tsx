/* [INPUT]: Editor draft, save state and explicit edit callbacks.
 * [OUTPUT]: Shared Markdown editor controls, keyboard save and conflict feedback.
 * [POS]: Transport-free reader view; the website supplies only an in-memory adapter.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useRef, useState } from 'react';
import { tr } from '../shared/i18n.js';
export type NoteEditorState = {
  text: string;
  status: string;
  failure: string;
  conflict: boolean;
  change: (text: string) => void;
  compose: (composing: boolean) => void;
  finish: () => Promise<boolean>;
  flush: () => Promise<boolean>;
  reload: () => Promise<void>;
};
export function NoteEditor({ editor }: { editor: NoteEditorState }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [copyError, setCopyError] = useState('');
  return (
    <section className="reader-editor">
      <div className="reader-edit-actions">
        <span role="status" aria-live="polite">
          {editor.status}
        </span>
        <button onClick={() => void editor.finish()}>{tr('完成编辑')}</button>
      </div>
      {editor.failure && (
        <div className="reader-save-error" role="alert">
          <p>{editor.failure}</p>
          <div>
            {!editor.conflict && (
              <button onClick={() => void editor.flush()}>{tr('重试保存')}</button>
            )}
            <button
              onClick={() =>
                void navigator.clipboard.writeText(editor.text).catch(() => {
                  input.current?.focus();
                  input.current?.select();
                  setCopyError(tr('请复制已选中的草稿'));
                })
              }
            >
              {tr('复制草稿')}
            </button>
            {editor.conflict && (
              <button onClick={() => void editor.reload()}>{tr('重新读取')}</button>
            )}
          </div>
          {copyError && <p role="status">{copyError}</p>}
        </div>
      )}
      <textarea
        ref={input}
        aria-label={tr('编辑 Markdown')}
        value={editor.text}
        autoFocus
        spellCheck={false}
        onChange={(event) => editor.change(event.target.value)}
        onCompositionStart={() => editor.compose(true)}
        onCompositionEnd={() => editor.compose(false)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void editor.flush();
          }
        }}
      />
    </section>
  );
}
