/* [INPUT]: Untrusted YAML frontmatter and optional tag-search adapter.
 * [OUTPUT]: Compact Obsidian-style property list and tags; invalid YAML stays visible as source.
 * [POS]: Read-only Markdown metadata renderer; never changes note contents or executes custom types.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useMemo } from 'react';
import { parseDocument } from 'yaml';
import { SearchText } from './search';
import { Icon } from '../shared/icons/react';
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
function display(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map((item) => display(item, depth + 1)).join(', ');
  if (typeof value === 'object' && depth < 2) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${display(v, depth + 1)}`)
      .join(' · ');
  }
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
  const entries = properties ? Object.entries(properties) : [];
  return (
    <details className="reader-properties" open>
      <summary>
        <Icon name="chevron-right" />
        <span>{tr('属性')}</span>
        {entries.length > 0 && <span className="reader-meta-count">{entries.length}</span>}
      </summary>
      {properties ? (
        <dl>
          {entries.map(([key, value]) => {
            const lower = key.toLocaleLowerCase();
            const isTag = lower === 'tags' || lower === 'tag';
            const isAlias = lower === 'aliases' || lower === 'alias';
            return (
              <div key={key}>
                <dt>
                  <SearchText text={key} query={query} />
                </dt>
                <dd>
                  {isTag ? (
                    (Array.isArray(value) ? value : value == null ? [] : [value]).map(
                      (tag, index) => {
                        const label = display(tag).replace(/^#/, '');
                        return onTag ? (
                          <button
                            key={index}
                            type="button"
                            className="reader-tag"
                            onClick={() => onTag(label)}
                          >
                            <SearchText text={`#${label}`} query={query} />
                          </button>
                        ) : (
                          <span key={index} className="reader-tag">
                            <SearchText text={`#${label}`} query={query} />
                          </span>
                        );
                      },
                    )
                  ) : isAlias ? (
                    (Array.isArray(value) ? value : value == null ? [] : [value]).map(
                      (alias, index) => (
                        <span key={index} className="reader-chip">
                          <SearchText text={display(alias)} query={query} />
                        </span>
                      ),
                    )
                  ) : typeof value === 'boolean' ? (
                    <span className="reader-prop-bool" data-checked={value || undefined}>
                      <span className="reader-prop-check" aria-hidden="true">
                        {value ? '✓' : ''}
                      </span>
                      <SearchText text={String(value)} query={query} />
                    </span>
                  ) : (
                    <span>
                      <SearchText text={display(value)} query={query} />
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
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
