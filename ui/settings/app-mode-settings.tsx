/* [INPUT]: Authenticated App mode API, shared settings controls and existing form save state.
 * [OUTPUT]: Release/Dev selection, local source registration and handover progress navigation.
 * [POS]: Startup settings; saves no business data and does not duplicate Dev source management.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { request } from './api';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Field } from './settings-controls';
import type { SettingsEditor } from './use-settings-form';

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
  const [error, setError] = useState('');
  useEffect(() => {
    if (!live) return;
    let disposed = false;
    request<ModeState>('app-mode')
      .then((value) => {
        if (disposed) return;
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
    if (!state || busy) return;
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
  return (
    <Card tabIndex={-1} id="settings-app-mode" aria-labelledby="app-mode-title">
      <h2 id="app-mode-title">{tr('运行模式')}</h2>
      <Field id="app-mode" label={tr('Palboo')}>
        <div className="settings-mode-options" role="group" aria-label={tr('运行模式')}>
          {(['release', 'development'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              aria-pressed={mode === value}
              disabled={!state || busy}
              onClick={() => setMode(value)}
            >
              {tr(value === 'release' ? '正式模式' : '开发模式')}
            </Button>
          ))}
        </div>
      </Field>
      {mode === 'development' && (
        <>
          <Field id="app-mode-source" label={tr('源码目录')}>
            <Input
              id="app-mode-source"
              value={source}
              disabled={busy}
              spellCheck={false}
              placeholder="/path/to/palboo"
              onChange={(event) => setSource(event.target.value)}
            />
          </Field>
          <details className="settings-details">
            <summary>{tr('开发环境')}</summary>
            <Field id="app-mode-node" label="Node.js">
              <Input
                id="app-mode-node"
                value={node}
                disabled={busy}
                spellCheck={false}
                placeholder={tr('自动查找')}
                onChange={(event) => setNode(event.target.value)}
              />
            </Field>
          </details>
        </>
      )}
      {editor.dirty && <p className="settings-hint">{tr('请先保存当前设置，再切换模式。')}</p>}
      {error && (
        <p role="alert" className="settings-error">
          {tr(error)}
        </p>
      )}
      <div className="settings-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => void apply()}
          disabled={
            !state ||
            busy ||
            editor.dirty ||
            editor.saving ||
            editor.remoteChanged ||
            (mode === state.mode && source === (state.source || '') && node === (state.node || ''))
          }
        >
          {tr(busy ? '正在准备…' : '切换模式')}
        </Button>
      </div>
    </Card>
  );
}
