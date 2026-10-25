import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: 认证 CodexHost API。 [OUTPUT]: CodexHost 独立开关、运行状态、版本更新及显式重启停用。
 * [POS]: 设置展示，不管理进程或复制其他功能配置；只在此分类可见时轮询。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Toggle, Feedback } from './settings-controls';
import { useFeedbackTarget } from './settings-feedback';
import { ConfirmationButton } from './settings-confirmation';
import { Button } from './components/ui/button';
import type { CodexHostStatus } from '../shared/codex-host';
const labels: Record<CodexHostStatus['state'], string> = {
  get disabled() {
    return tr('已关闭');
  },
  get notInstalled() {
    return tr('尚未安装');
  },
  get pendingEnable() {
    return tr('待启动启用');
  },
  get pendingDisable() {
    return tr('待重启停用');
  },
  get pendingUpdate() {
    return tr('所选安装待重启生效');
  },
  get running() {
    return tr('运行中');
  },
  get error() {
    return tr('状态异常');
  },
};
export function CodexHostSettings({ live, active }: { live: boolean; active: boolean }) {
  useLocale();
  const [state, setState] = useState<CodexHostStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const writing = useRef(false),
    generation = useRef(0);
  const feedback = useFeedbackTarget();
  const restarting = ['queued', 'confirming', 'restarting'].includes(state?.restart?.state || '');
  const disabled = !live || busy || restarting;
  useEffect(() => {
    if (!live || !active) return;
    let disposed = false;
    const load = async () => {
      if (writing.current) return;
      const current = ++generation.current;
      try {
        const result = await request<CodexHostStatus>('codex-host');
        if (!disposed && current === generation.current) {
          setState(result);
        }
      } catch (e) {
        if (!disposed && current === generation.current) setError(String(e));
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    window.addEventListener('focus', load);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [live, active]);
  async function command(op: string, data: Record<string, unknown> = {}) {
    if (writing.current || restarting || !state) return false;
    feedback.capture();
    writing.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      if (op === 'check-update') {
        const result = await request<{ version: string }>('codex-host', { op, id: 'codex-host' });
        setLatest(result.version);
      } else
        setState(
          await request<CodexHostStatus>('codex-host', {
            op,
            id: 'codex-host',
            expectedRevision: state.revision,
            ...data,
          }),
        );
      return true;
    } catch (e) {
      setError(String(e));
      if (op === 'restore' || op === 'restart-disabled') throw e;
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const target = latest || state?.baseline;
  const newer =
    target &&
    (!state?.version ||
      target
        .split('.')
        .map(Number)
        .some(
          (n, i, parts) =>
            parts.slice(0, i).every((v, j) => v === Number(state.version?.split('.')[j])) &&
            n > Number(state.version?.split('.')[i]),
        ));
  return (
    <section
      className="settings-section space-y-6"
      aria-label={tr('CodexHost 设置')}
      id="settings-codex-host"
    >
      <Toggle
        label={tr('启用 CodexHost')}
        checked={state?.enabled ?? false}
        disabled={disabled || !state}
        onChange={(enabled) => void command('set-enabled', { enabled })}
      />
      <Feedback
        text={error || state?.error || (busy ? tr('处理中…') : '')}
        failed={!!(error || state?.error)}
        target={feedback.target}
      />
      {state?.restart && (
        <Feedback text={state.restart.message} failed={state.restart.state === 'failed'} />
      )}
      {state && (
        <>
          <dl className="settings-status-list">
            <div className="settings-row">
              <dt>{tr('状态')}</dt>
              <dd>{labels[state.state]}</dd>
            </div>
            <div className="settings-row">
              <dt>{tr('已安装版本')}</dt>
              <dd>{state.version || tr('未安装')}</dd>
            </div>
            {state.runningVersion && (
              <div className="settings-row">
                <dt>{tr('实际运行版本')}</dt>
                <dd>{state.runningVersion}</dd>
              </div>
            )}
            {state.executable && (
              <div className="settings-row items-start">
                <dt className="shrink-0">{tr('程序路径')}</dt>
                <dd className="min-w-0 break-all text-right select-text">{state.executable}</dd>
              </div>
            )}
            {state.runningExecutable && state.runningExecutable !== state.executable && (
              <div className="settings-row items-start">
                <dt className="shrink-0">{tr('运行路径')}</dt>
                <dd className="min-w-0 break-all text-right select-text">
                  {state.runningExecutable}
                </dd>
              </div>
            )}
          </dl>
          {state.state === 'pendingEnable' && (
            <p>{tr('需要重开 Codex 才能启用时，请先结束任务，再打开 Palboo。')}</p>
          )}
          <div className="settings-actions">
            {state.state === 'pendingDisable' && (
              <ConfirmationButton
                disabled={disabled}
                revision={state.revision}
                title={tr('重启 Codex 并停用 CodexHost？')}
                description={tr(
                  'Codex 将退出并重新打开，正在运行的任务可能中断。请先保存内容并结束任务。',
                )}
                confirmLabel={tr('确认重启')}
                onConfirm={() => command('restart-disabled')}
              >
                {restarting ? tr('正在重启…') : tr('重启 Codex 并停用')}
              </ConfirmationButton>
            )}
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void command('check-update')}
            >
              {tr('检查更新')}
            </Button>
            {target && newer && (
              <Button
                disabled={disabled}
                onClick={() => void command('install', { version: target })}
              >
                {busy
                  ? tr('处理中…')
                  : tr('{{value1}} {{target}}', {
                      value1: state.version ? tr('更新到') : tr('安装'),
                      target: target,
                    })}
              </Button>
            )}
            {state.enabled && ['pendingEnable'].includes(state.state) && (
              <Button variant="outline" disabled={disabled} onClick={() => void command('start')}>
                {tr('启动')}
              </Button>
            )}
            {state.canRestore && (
              <ConfirmationButton
                variant="ghost"
                disabled={disabled}
                revision={state.revision}
                title={tr('恢复 CodexHost 上一版本？')}
                description={tr(
                  '将切换回先前安装的版本，当前会话可能需要重新启动才能使用。已有配置保持不变。',
                )}
                confirmLabel={tr('确认恢复')}
                onConfirm={() => command('restore')}
              >
                {tr('恢复上一版本')}
              </ConfirmationButton>
            )}
          </div>
          {latest === state.version && <p role="status">{tr('已是最新版本')}</p>}
        </>
      )}
    </section>
  );
}
