/* [INPUT]: Literal code, language and optional diagram controls/content.
 * [OUTPUT]: Shared code toolbar with source copying and transient feedback.
 * [POS]: Transport-free reader/site component; copying never changes the source.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';

export function CodeFrame({
  language,
  source,
  actions,
  children,
}: {
  language: string;
  source: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="reader-code-block">
      <div className="reader-code-bar">
        <span className="reader-code-lang">{language}</span>
        <div className="reader-code-actions">
          {actions}
          <button
            type="button"
            className="reader-copy-code"
            data-copied={copied || undefined}
            aria-label={tr('复制代码')}
            title={tr('复制代码')}
            onClick={async () => {
              if (timer.current) clearTimeout(timer.current);
              try {
                await navigator.clipboard.writeText(source);
                setCopied(true);
                setStatus(tr('已复制'));
                timer.current = setTimeout(() => {
                  setCopied(false);
                  setStatus('');
                }, 2000);
              } catch {
                setCopied(false);
                setStatus(tr('复制失败，请手动选择代码'));
              }
            }}
          >
            <Icon name={copied ? 'check' : 'reader-copy'} />
            <span role="status">{status || tr('复制代码')}</span>
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
