/* [INPUT]: 手动更新 API、现有设置草稿及共享控件。
 * [OUTPUT]: 本地安装版本、显式检查、版本说明和更新进度页交接。
 * [POS]: 启动与连接页面；不后台联网检查，不自动下载或切换开发模式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { request } from './api';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Field } from './settings-controls';
import type { SettingsEditor } from './use-settings-form';

type UpdateState = {
  currentVersion: string;
  revision: number;
  canInstall: boolean;
  reason: string | null;
  checked: boolean;
  hasUpdate?: boolean;
  release?: { id: number; version: string; url: string; asset: { id: number } | null };
};
export function AppUpdateSettings({
  live,
  editor,
  modeEditing = false,
}: {
  live: boolean;
  editor: SettingsEditor;
  modeEditing?: boolean;
}) {
  useLocale();
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const pending = useRef(false);
  const dirty = editor.dirty || editor.saving || editor.remoteChanged || modeEditing;
  useEffect(() => {
    if (!live) return;
    let disposed = false;
    const current = ++sequence.current;
    request<UpdateState>('app-update')
      .then((value) => {
        if (!disposed && current === sequence.current) setState(value);
      })
      .catch((reason) => {
        if (!disposed && current === sequence.current) setError(reason.message);
      });
    return () => {
      disposed = true;
    };
  }, [live]);
  async function check() {
    if (!live || pending.current) return;
    pending.current = true;
    const current = ++sequence.current;
    setBusy('check');
    setError('');
    try {
      const value = await request<UpdateState>('app-update/check', {});
      if (current === sequence.current) setState(value);
    } catch (reason) {
      if (current === sequence.current) setError((reason as Error).message);
    } finally {
      pending.current = false;
      setBusy('');
    }
  }
  async function install() {
    if (
      !live ||
      pending.current ||
      dirty ||
      !state?.canInstall ||
      !state.hasUpdate ||
      !state.release?.asset
    )
      return;
    pending.current = true;
    setBusy('install');
    setError('');
    try {
      const value = await request<{ url: string }>('app-update', {
        releaseId: state.release.id,
        assetId: state.release.asset.id,
        version: state.release.version,
        currentVersion: state.currentVersion,
        expectedRevision: state.revision,
      });
      window.location.assign(value.url);
    } catch (reason) {
      setError((reason as Error).message);
      pending.current = false;
      setBusy('');
    }
  }
  const available = state?.checked && state.hasUpdate ? state.release : undefined;
  return (
    <Card tabIndex={-1} id="settings-app-update" aria-labelledby="app-update-title">
      <h2 id="app-update-title">{tr('应用更新')}</h2>
      <Field id="app-update-version" label={tr('当前版本')}>
        <div className="settings-actions flex-wrap">
          <span id="app-update-version">{state ? `v${state.currentVersion}` : '—'}</span>
          <Button
            type="button"
            variant="outline"
            disabled={!live || !!busy}
            onClick={() => void check()}
          >
            {tr(busy === 'check' ? '正在检查…' : '检查更新')}
          </Button>
        </div>
      </Field>
      {state?.checked && (
        <p role="status" className="settings-hint">
          {available
            ? tr('发现新版本 v{{version}}', { version: available.version })
            : tr('当前无需更新。')}
          {available && !available.asset && ` ${tr('此版本仅提供源码，没有安装包。')}`}
        </p>
      )}
      {available && state?.reason && <p className="settings-hint">{tr(state.reason)}</p>}
      {available?.asset && dirty && (
        <p className="settings-hint">{tr('请先保存或还原当前设置，再更新。')}</p>
      )}
      {error && (
        <p role="alert" className="settings-error">
          {tr(error)}
        </p>
      )}
      {available && (
        <div className="settings-actions flex-wrap">
          <a
            href={available.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline-offset-4 hover:underline"
          >
            {tr('更新说明')}
          </a>
          {available.asset && (
            <Button
              type="button"
              variant="outline"
              disabled={!live || !!busy || dirty || !state?.canInstall}
              onClick={() => void install()}
            >
              {tr(busy === 'install' ? '正在准备…' : '更新并重启')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
