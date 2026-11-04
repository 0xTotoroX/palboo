/* [INPUT]: Untrusted YAML frontmatter and optional tag-search adapter.
 * [OUTPUT]: Structured property list and tags; invalid or unsafe YAML remains visible as source.
 * [POS]: Read-only Markdown metadata renderer; never changes note contents or executes custom types.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useMemo } from 'react';
import { parseDocument } from 'yaml';
import { SearchText } from './search';
import { tr } from '../shared/i18n.js';

export function parseProperties(source: string): Record<string, unknown> | null {
  try {
    const document = parseDocument(source, { schema: 'core' });
    if (document.errors.length || document.warnings.length) return null;
    const value = document.toJS({ maxAliasCount: 0 });
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function display(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return '—';
  if (Array.isArray(value)) return value.map(display).join(', ');
  return JSON.stringify(value) ?? '';
}
export function NoteProperties({
  source,
  onTag,
  query = '',
}: {
  source: string;
  onTag?: (tag: string) => void;
  query?: string;
}) {
  const properties = useMemo(() => parseProperties(source), [source]);
  return (
    <details className="reader-properties" open>
      <summary>{tr('属性')}</summary>
      {properties ? (
        <dl>
          {Object.entries(properties).map(([key, value]) => (
            <div key={key}>
              <dt>
                <SearchText text={key} query={query} />
              </dt>
              <dd>
                {key.toLocaleLowerCase() === 'tags' ? (
                  (Array.isArray(value) ? value : [value]).map((tag, index) => {
                    const label = display(tag).replace(/^#/, '');
                    return onTag ? (
                      <button key={index} className="reader-tag" onClick={() => onTag(label)}>
                        <SearchText text={`#${label}`} query={query} />
                      </button>
                    ) : (
                      <span key={index} className="reader-tag">
                        <SearchText text={`#${label}`} query={query} />
                      </span>
                    );
                  })
                ) : (
                  <span>
                    <SearchText text={display(value)} query={query} />
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <>
          <p role="status">{tr('属性无法解析，显示原文')}</p>
          <pre>{source}</pre>
        </>
      )}
    </details>
  );
}
