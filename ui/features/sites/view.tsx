/* [INPUT]: Saved websites, configured reader flag and owner-guarded open callback.
 * [OUTPUT]: Searchable website/Obsidian launch list in every existing Palboo surface.
 * [POS]: Clicks navigate the host browser; no model invocation or note context injection.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useState } from 'react';
import { sitesStyles } from './styles';
import { Icon } from '../../shared/icons/react';
import { tr } from '../../shared/i18n.js';
import { useLocale } from '../../shared/use-locale';
import type { Reading } from '../../shared/features';
import type { SiteState } from '../../shared/web-library';
export function SitesView({
  state,
  disabled = false,
  reading,
  open,
}: {
  state: SiteState | null;
  disabled?: boolean;
  reading?: Reading;
  open: (id: string) => Promise<unknown>;
}) {
  useLocale();
  const [search, setSearch] = useState(reading?.siteSearch || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const entries = [
    { id: 'obsidian', name: 'Obsidian', url: '', available: state?.configured },
    ...(state?.sites || []).map((site) => ({ ...site, available: true })),
  ];
  async function launch(id: string) {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await open(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="sites-view">
      <style>{sitesStyles}</style>
      {(entries.length > 6 || !!search) && (
        <input
          type="search"
          aria-label={tr('搜索网站')}
          placeholder={tr('搜索网站')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (reading) reading.siteSearch = e.target.value;
          }}
        />
      )}
      {!state && <p role="status">{tr('正在读取网站…')}</p>}
      {error && <p role="alert">{error}</p>}
      <ul>
        {entries
          .filter((site) =>
            `${site.name} ${site.url}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          )
          .map((site) => (
            <li key={site.id}>
              <button
                disabled={disabled || !!busy || !site.available}
                onClick={() => void launch(site.id)}
                title={site.url || tr('本地笔记')}
                aria-busy={busy === site.id}
              >
                <Icon name={site.id === 'obsidian' ? 'reader-note' : 'feature-sites'} />
                <span className="sites-name">{site.name}</span>
              </button>
            </li>
          ))}
      </ul>
      {state && !state.configured && <p role="status">{tr('在网站设置中选择 Obsidian 笔记库')}</p>}
    </div>
  );
}
