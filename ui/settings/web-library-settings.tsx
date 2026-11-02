/* [INPUT]: Local revisioned website/vault grants and existing settings controls/preview.
 * [OUTPUT]: Folder-first settings, retained attachment/site drawers and a read-only snapshot for workspace previews.
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
import { SettingsDrawer, closeSettingsDrawers, revealSettingsDrawer } from './settings-drawer';
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
  previewActive = false,
  onSnapshot,
  enablementTarget,
}: {
  live: boolean;
  active: boolean;
  previewActive?: boolean;
  onSnapshot?: (state: WebLibrary | null) => void;
  enablementTarget: HTMLElement | null;
}) {
  useLocale();
  const [state, setState] = useState<WebLibrary | null>(null);
  useEffect(() => onSnapshot?.(state), [state, onSnapshot]);
  const [vault, setVault] = useState('');
  const [attachments, setAttachments] = useState('');
  const [site, setSite] = useState<Site>({ id: '', name: '', url: '' });
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const siteName = useRef<HTMLInputElement>(null);
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
    if (!live || (!active && !previewActive && !enablementTarget)) return;
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
  }, [live, active, previewActive, enablementTarget]);
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
  async function chooseFolder() {
    if (disabled || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ path: string | null }>('web-library/choose-directory', {});
      if (result.path) editRoot(() => setVault(result.path!));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function saveFolders() {
    return save({
      vault: vault.trim(),
      attachments: attachments
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    });
  }
  const rootActions = (
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
      <Button disabled={disabled || !rootDraft.current} onClick={() => void saveFolders()}>
        {tr('保存')}
      </Button>
    </div>
  );
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
        <section className="settings-section reader-configuration">
          <div className="web-library-heading">
            <h2>{tr('本地笔记')}</h2>
            <Button
              variant="outline"
              disabled={disabled || !state?.vault}
              onClick={() => void open('obsidian')}
            >
              {tr('打开阅读器')}
            </Button>
          </div>
          <label htmlFor="reader-vault" className="reader-folder-label">
            {tr('笔记文件夹')}
          </label>
          <div className="reader-folder-choice">
            {!!state?.vaults?.length && (
              <NativeSelect
                id="reader-vault-choice"
                aria-label={tr('已发现的笔记库')}
                value={state.vaults.includes(vault) ? vault : ''}
                onChange={(e) => editRoot(() => setVault(e.target.value))}
                disabled={disabled}
              >
                <option value="">{vault ? tr('自定义文件夹') : tr('选择笔记库')}</option>
                {state.vaults.map((path) => (
                  <option key={path} value={path}>
                    {path.split('/').at(-1)}
                    {state.vaults!.filter(
                      (other) => other.split('/').at(-1) === path.split('/').at(-1),
                    ).length > 1
                      ? ` · ${path}`
                      : ''}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Button variant="outline" disabled={disabled} onClick={() => void chooseFolder()}>
              <Icon name="reader-folder" />
              {tr('选择文件夹')}
            </Button>
          </div>
          <Input
            id="reader-vault"
            value={vault}
            onChange={(e) => editRoot(() => setVault(e.target.value))}
            disabled={disabled}
            placeholder={tr('选择文件夹，或粘贴完整路径')}
          />
          <p className="settings-hint">
            {tr('仅本机访问。编辑 Markdown 后自动保存到原文件，表格仅供预览。')}
          </p>
          <div className="reader-folder-footer">
            <SettingsDrawer
              title={tr('额外附件目录')}
              hidden={!active}
              compact
              footer={
                <>
                  <Feedback text={error} failed />
                  {rootActions}
                </>
              }
            >
              <Field
                label={tr('目录路径')}
                id="reader-attachments"
                hint={tr('仅在图片位于笔记库外时添加，每行一个目录。')}
              >
                <textarea
                  id="reader-attachments"
                  value={attachments}
                  onChange={(e) => editRoot(() => setAttachments(e.target.value))}
                  disabled={disabled}
                  rows={5}
                />
              </Field>
            </SettingsDrawer>
            {rootActions}
          </div>
        </section>
        <section className="settings-section" data-settings-search-ignore>
          <div className="web-library-heading">
            <h2>{tr('自定义网站')}</h2>
            <SettingsDrawer
              title={site.id ? tr('编辑网站') : tr('添加网站')}
              hidden={!active}
              compact
            >
              <div className="web-library-presets" hidden={!!site.id}>
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
                    if (ok) {
                      closeSettingsDrawers();
                      setSite({ id: '', name: '', url: '' });
                    }
                  });
                }}
              >
                <Field label={tr('名称')} id="website-name">
                  <Input
                    id="website-name"
                    ref={siteName}
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
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      closeSettingsDrawers();
                      setSite({ id: '', name: '', url: '' });
                    }}
                  >
                    {tr('取消')}
                  </Button>
                  <Button type="submit" disabled={disabled}>
                    {site.id ? tr('保存') : tr('添加网站')}
                  </Button>
                </div>
              </form>
              <Feedback text={error} failed />
            </SettingsDrawer>
          </div>
          {((state?.sites.length || 0) >= 7 || filter) && (
            <Input
              type="search"
              aria-label={tr('搜索网站')}
              placeholder={tr('搜索网站')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
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
                        onClick={() => {
                          setSite({ ...item });
                          if (siteName.current) revealSettingsDrawer(siteName.current);
                        }}
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
        <section className="settings-section">
          <h2>{tr('预览')}</h2>
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
        </section>
      </section>
      {confirmation.confirmation}
    </>
  );
}
