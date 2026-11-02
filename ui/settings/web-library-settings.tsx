/* [INPUT]: Local revisioned website/vault grants and existing settings controls/preview.
 * [OUTPUT]: Preview-first settings, visible folders/sites and retained detail editors.
 * [POS]: Settings only; user drafts survive failures, previews never navigate or read notes.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Field, FeatureSwitch, Feedback } from './settings-controls';
import { Button, IconButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { ReaderFolderSettings } from './reader-folder-settings';
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
  if (
    data.folders !== undefined &&
    (!Array.isArray(data.folders) ||
      !data.folders.every(
        (folder) =>
          folder &&
          typeof folder.id === 'string' &&
          typeof folder.name === 'string' &&
          typeof folder.path === 'string' &&
          Array.isArray(folder.attachments) &&
          folder.attachments.every((path) => typeof path === 'string'),
      ))
  )
    throw new Error(tr('网站设置暂不可用，请更新或重新连接 Palboo。'));
  return {
    ...data,
    folders:
      data.folders ??
      (data.vault
        ? [
            {
              id: 'obsidian',
              name: data.vault.split('/').at(-1) || 'Obsidian',
              path: data.vault,
              attachments: data.attachments,
            },
          ]
        : []),
  };
}
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
  const [site, setSite] = useState<Site>({ id: '', name: '', url: '' });
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const siteName = useRef<HTMLInputElement>(null);
  const confirmation = useConfirmation(state?.revision, busy);
  function receive(value: unknown) {
    const next = configuration(value);
    setState((previous) => ({ ...previous, ...next }));
    return next;
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
  async function save(patch: Partial<WebLibrary>, revision?: number) {
    if (!state || flight.current) return false;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const next = configuration(
        await request<WebLibrary>('web-library', {
          ...patch,
          expectedRevision: revision ?? state.revision,
        }),
      );
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
        <ReaderFolderSettings
          state={state}
          active={active}
          disabled={disabled}
          error={error}
          clearError={() => setError('')}
          save={save}
          open={open}
        />
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
      </section>
      {confirmation.confirmation}
    </>
  );
}
