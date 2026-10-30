/* [INPUT]: Authenticated App mode API, shared settings controls and existing form save state.
 * [OUTPUT]: Manual App updates, Release/Dev selection and a shared development drawer; retains mode drafts across reconnects and guards progress handoff.
 * [POS]: Startup settings; saves no business data and does not duplicate Dev source management.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { request } from './api';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { Field } from './settings-controls';
import { SettingsDrawer } from './settings-drawer';
import type { SettingsEditor } from './use-settings-form';
import { AppUpdateSettings } from './app-update-settings';

type Mode = 'release' | 'development';
type ModeState = {
  mode: Mode;
  preferredMode: Mode;
  revision: number;
  source: string | null;
  node: string | null;
  releaseAvailable: boolean;
};
export function AppModeSettings({ live, editor }: { live: boolean; editor: SettingsEditor }) {
  useLocale();
  const [state, setState] = useState<ModeState | null>(null);
  const [mode, setMode] = useState<Mode>('release');
  const [source, setSource] = useState('');
  const [node, setNode] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const edited =
    !!state &&
    (mode !== state.mode || source !== (state.source || '') || node !== (state.node || ''));
  const draftEdited = useRef(false);
  draftEdited.current = edited;
  const changed = edited || (!!state && mode !== state.preferredMode);
  const blocked =
    !live || !ready || !state || busy || editor.dirty || editor.saving || editor.remoteChanged;
  useEffect(() => {
    setReady(false);
    if (!live) return;
    let disposed = false;
    setError('');
    request<ModeState>('app-mode')
      .then((value) => {
        if (disposed) return;
        setReady(true);
        // 保留草稿及其原始修订，重连不能替用户覆盖外部修改。
        if (draftEdited.current) return;
        setState(value);
        setMode(value.mode);
        setSource(value.source || '');
        setNode(value.node || '');
      })
      .catch((reason) => {
        if (!disposed) setError(reason.message);
      });
    return () => {
      disposed = true;
    };
  }, [live]);
  async function apply() {
    if (blocked || !state || !changed) return;
    setBusy(true);
    setError('');
    try {
      const value = await request<{ url: string }>('app-mode', {
        mode,
        source: source.trim() || null,
        node: node.trim() || null,
        expectedRevision: state.revision,
      });
      window.location.assign(value.url);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }
  const actions = (
    <>
      {editor.dirty && changed && (
        <p className="settings-hint">{tr('请先保存当前设置，再切换模式。')}</p>
      )}
      {error && (
        <p role="alert" className="settings-error">
          {tr(error)}
        </p>
      )}
      {(changed || busy) && (
        <div className="settings-actions">
          <Button type="button" variant="outline" onClick={() => void apply()} disabled={blocked}>
            {tr(busy ? '正在准备…' : '切换模式')}
          </Button>
        </div>
      )}
    </>
  );
  return (
    <>
      <AppUpdateSettings live={live} editor={editor} modeEditing={busy || edited} />
      <Card
        tabIndex={-1}
        id="settings-app-mode"
        aria-labelledby="app-mode-title"
        data-settings-navigation
      >
        <h2 id="app-mode-title">{tr('运行模式')}</h2>
        <Field id="app-mode" label={tr('启动时使用')}>
          <NativeSelect
            id="app-mode"
            controlWidth="short"
            value={mode}
            disabled={!live || !ready || busy}
            onChange={(event) => {
              // 模式独立提交，不能触发外层模型表单的自动保存。
              event.stopPropagation();
              setMode(event.target.value as Mode);
            }}
          >
            <option value="release">{tr('正式模式')}</option>
            <option value="development">{tr('开发模式')}</option>
          </NativeSelect>
        </Field>
        <SettingsDrawer
          id="settings-app-development"
          title={tr('开发设置')}
          hidden={mode !== 'development'}
          footer={actions}
        >
          <Field id="app-mode-source" label={tr('源码目录')}>
            <Input
              id="app-mode-source"
              value={source}
              disabled={!live || !ready || busy}
              spellCheck={false}
              placeholder="/path/to/palboo"
              onChange={(event) => setSource(event.target.value)}
            />
          </Field>
          <Field id="app-mode-node" label="Node.js">
            <Input
              id="app-mode-node"
              value={node}
              disabled={!live || !ready || busy}
              spellCheck={false}
              placeholder={tr('自动查找')}
              onChange={(event) => setNode(event.target.value)}
            />
          </Field>
        </SettingsDrawer>
        {actions}
      </Card>
    </>
  );
}
