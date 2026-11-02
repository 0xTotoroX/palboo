/* [INPUT]: Local revisioned website/vault grants and existing settings controls/preview.
 * [OUTPUT]: Optional feature toggle, explicit vault/attachment configuration and website CRUD/order/search.
 * [POS]: Settings only; user drafts survive failures, previews never navigate or read notes.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Field, FeatureSwitch, Feedback } from './settings-controls';
import { Button, IconButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { SettingsSortableList } from './settings-sortable-list';
import { useConfirmation } from './settings-confirmation';
import { FeaturePreviewContent } from './feature-preview';
import { PreviewFrame } from './preview-frame';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import type { Site, WebLibrary } from '../shared/web-library';
import { Icon } from '../shared/icons/react';
import './web-library-settings.css';
function configuration(value: unknown): WebLibrary {
  const data = value as WebLibrary | null;
  if (
    !data ||
    !Number.isSafeInteger(data.revision) ||
    typeof data.enabled !== 'boolean' ||
    (data.vault !== null && typeof data.vault !== 'string') ||
    !Array.isArray(data.attachments) ||
    !data.attachments.every((path) => typeof path === 'string') ||
    !Array.isArray(data.sites) ||
    !data.sites.every(
      (site) =>
        site &&
        typeof site.id === 'string' &&
        typeof site.name === 'string' &&
        typeof site.url === 'string',
    ) ||
    (data.vaults !== undefined &&
      (!Array.isArray(data.vaults) || !data.vaults.every((path) => typeof path === 'string')))
  )
    throw new Error(tr('网站设置暂不可用，请更新或重新连接 Palboo。'));
  return data;
}
const grants = (value: WebLibrary) => JSON.stringify([value.vault, value.attachments]);
export function WebLibrarySettings({
  live,
  active,
  enablementTarget,
}: {
  live: boolean;
  active: boolean;
  enablementTarget: HTMLElement | null;
}) {
  useLocale();
  const [state, setState] = useState<WebLibrary | null>(null);
  const [vault, setVault] = useState('');
  const [attachments, setAttachments] = useState('');
  const [site, setSite] = useState<Site>({ id: '', name: '', url: '' });
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const rootDraft = useRef<{ revision: number; grants: string } | null>(null);
  const confirmation = useConfirmation(state?.revision, busy);
  function receive(value: unknown) {
    const next = configuration(value);
    const draft = rootDraft.current;
    if (!draft) {
      setVault(next.vault || '');
      setAttachments(next.attachments.join('\n'));
    } else if (draft.grants === grants(next)) {
      draft.revision = next.revision;
    }
    setState((previous) => ({ ...previous, ...next }));
    return next;
  }
  function editRoot(edit: () => void) {
    if (state && !rootDraft.current)
      rootDraft.current = { revision: state.revision, grants: grants(state) };
    edit();
  }
  useEffect(() => {
    if (!live || (!active && !enablementTarget)) return;
    const controller = new AbortController();
    void request<WebLibrary>('web-library', undefined, controller.signal)
      .then((value) => {
        if (controller.signal.aborted || flight.current) return;
        receive(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [live, active, enablementTarget]);
  async function save(patch: Partial<WebLibrary>) {
    if (!state || flight.current) return false;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const roots = 'vault' in patch || 'attachments' in patch;
      const next = configuration(
        await request<WebLibrary>('web-library', {
          ...patch,
          expectedRevision: roots
            ? (rootDraft.current?.revision ?? state.revision)
            : state.revision,
        }),
      );
      if (roots) rootDraft.current = null;
      receive(next);
      if (next.presentationError) setError(next.presentationError);
      return true;
    } catch (e) {
      setError((e as Error).message);
      try {
        receive(await request<WebLibrary>('web-library'));
      } catch {}
      return false;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function open(id: string) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await request('web-library/open', { id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const disabled = !live || !state || busy;
  return (
    <>
      <FeatureSwitch
        portalTarget={enablementTarget}
        name={tr('网站')}
        checked={state?.enabled || false}
        disabled={disabled}
        onChange={(enabled) => void save({ enabled })}
      />
      <section
        data-settings-page="sites"
        id="settings-sites"
        hidden={!active}
        className="web-library-settings"
      >
        <PreviewFrame title={tr('网站')}>
          <FeaturePreviewContent
            id="sites"
            sites={state}
            mode="current"
            form={null}
            view={null}
            tasks={null}
          />
        </PreviewFrame>
        <section className="settings-section">
          <h2>{tr('本地 Obsidian')}</h2>
          {!!state?.vaults?.length && (
            <Field label={tr('已发现的笔记库')} id="reader-vault-choice">
              <NativeSelect
                id="reader-vault-choice"
                value={state.vaults.includes(vault) ? vault : ''}
                onChange={(e) => editRoot(() => setVault(e.target.value))}
                disabled={disabled}
              >
                <option value="">{tr('选择笔记库')}</option>
                {state.vaults.map((path) => (
                  <option key={path} value={path}>
                    {path.split('/').at(-1)} · {path}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label={tr('笔记库路径')} id="reader-vault">
            <Input
              id="reader-vault"
              value={vault}
              onChange={(e) => editRoot(() => setVault(e.target.value))}
              disabled={disabled}
              placeholder={tr('笔记库的完整目录路径')}
            />
          </Field>
          <Field
            label={tr('额外附件目录')}
            id="reader-attachments"
            hint={tr('仅在图片位于笔记库外时添加，每行一个目录。')}
          >
            <textarea
              id="reader-attachments"
              value={attachments}
              onChange={(e) => editRoot(() => setAttachments(e.target.value))}
              disabled={disabled}
              rows={2}
            />
          </Field>
          <p className="settings-hint">
            {tr('仅本机访问，不修改笔记。切换授权目录后，需要重新打开阅读器。')}
          </p>
          <div className="settings-actions">
            {rootDraft.current && state && rootDraft.current.revision !== state.revision && (
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  rootDraft.current = null;
                  receive(state);
                  setError('');
                }}
              >
                {tr('重新读取已保存目录')}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={disabled || !state?.vault}
              onClick={() => void open('obsidian')}
            >
              {tr('打开阅读器')}
            </Button>
            <Button
              disabled={disabled}
              onClick={() =>
                void save({
                  vault: vault.trim(),
                  attachments: attachments
                    .split('\n')
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            >
              {tr('保存')}
            </Button>
          </div>
        </section>
        <section className="settings-section" data-settings-search-ignore>
          <h2>{tr('自定义网站')}</h2>
          <div className="settings-actions web-library-presets">
            {[
              { name: 'Cubox', url: 'https://cubox.pro/web/unread' },
              { name: tr('幕布'), url: 'https://mubu.com/app' },
            ].map((preset) => (
              <Button
                key={preset.url}
                variant="outline"
                disabled={disabled}
                onClick={() => setSite({ id: '', ...preset })}
              >
                {preset.name}
              </Button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!state) return;
              const next = { ...site, id: site.id || crypto.randomUUID() };
              void save({
                sites: site.id
                  ? state.sites.map((s) => (s.id === site.id ? next : s))
                  : [...state.sites, next],
              }).then((ok) => {
                if (ok) setSite({ id: '', name: '', url: '' });
              });
            }}
          >
            <Field label={tr('名称')} id="website-name">
              <Input
                id="website-name"
                value={site.name}
                maxLength={120}
                required
                disabled={disabled}
                onChange={(e) => setSite({ ...site, name: e.target.value })}
              />
            </Field>
            <Field label={tr('网址')} id="website-url">
              <Input
                id="website-url"
                type="url"
                value={site.url}
                required
                disabled={disabled}
                placeholder="https://"
                onChange={(e) => setSite({ ...site, url: e.target.value })}
              />
            </Field>
            <div className="settings-actions">
              {site.id && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSite({ id: '', name: '', url: '' })}
                >
                  {tr('取消')}
                </Button>
              )}
              <Button type="submit" disabled={disabled}>
                {site.id ? tr('保存') : tr('添加网站')}
              </Button>
            </div>
          </form>
          <Input
            type="search"
            aria-label={tr('搜索网站')}
            placeholder={tr('搜索网站')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <SettingsSortableList
            ids={state?.sites.map((s) => s.id) || []}
            disabled={disabled || !!filter}
            onReorder={(ids) =>
              void save({ sites: ids.map((id) => state!.sites.find((s) => s.id === id)!) })
            }
          >
            {(row) => (
              <div className="web-library-list">
                {state?.sites
                  .filter((s) => `${s.name} ${s.url}`.toLowerCase().includes(filter.toLowerCase()))
                  .map((item) => (
                    <div {...row(item.id)} key={item.id} className="web-library-row">
                      <button
                        className="web-library-open"
                        disabled={disabled}
                        title={item.url}
                        onClick={() => void open(item.id)}
                      >
                        <span>{item.name}</span>
                        <small>{item.url}</small>
                      </button>
                      <IconButton
                        aria-label={tr('编辑{{name}}', { name: item.name })}
                        disabled={disabled}
                        variant="ghost"
                        onClick={() => setSite({ ...item })}
                      >
                        <Icon name="pencil" />
                      </IconButton>
                      <IconButton
                        aria-label={tr('删除{{name}}', { name: item.name })}
                        disabled={disabled}
                        variant="ghost"
                        onClick={() =>
                          confirmation.confirm({
                            title: tr('删除网站'),
                            description: item.name,
                            action: () =>
                              save({ sites: state.sites.filter((s) => s.id !== item.id) }),
                          })
                        }
                      >
                        <Icon name="trash" />
                      </IconButton>
                    </div>
                  ))}
              </div>
            )}
          </SettingsSortableList>
        </section>
        <Feedback text={error} failed />
      </section>
      {confirmation.confirmation}
    </>
  );
}
