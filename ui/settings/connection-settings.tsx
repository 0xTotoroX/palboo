/* [INPUT]: Existing connection, restart and performance preferences with authenticated APIs.
 * [OUTPUT]: One connection status and its available actions; manual connection and monitoring under diagnostics.
 * [POS]: Keeps temporary disconnect separate from persisted integration pause; no configuration or API changes.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useState, useEffect } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { ConfirmationButton, useConfirmation } from './settings-confirmation';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import { NativeSelect } from './components/ui/native-select';
import { Field, Feedback } from './settings-controls';
import { PerformanceSettings, usePerformanceSettings } from './performance-settings';
import { request, type View } from './api';
import type { SettingsEditor } from './use-settings-form';
import { Icon } from '../shared/icons/react';

export function ConnectionSettings({
  editor,
  view,
  live,
  active = true,
  notify,
}: {
  editor: SettingsEditor;
  view: View | null;
  live: boolean;
  active?: boolean;
  notify: (text: string, failed?: boolean) => void;
}) {
  useLocale();
  const { form, change } = editor;
  const { confirm, confirmation } = useConfirmation(
    editor.saved?.configurationRevision,
    editor.saving || editor.remoteChanged,
  );
  const [endpoint, setEndpoint] = useState(''),
    [targetId, setTargetId] = useState(''),
    [connectionEdited, setConnectionEdited] = useState(false),
    [busy, setBusy] = useState('');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const performance = usePerformanceSettings(live, active, diagnosticsOpen);
  const paused = performance.state?.preferences.integrationEnabled === false;
  const connection = view?.connection;
  const connected = connection?.status === 'connected';
  const unresponsive = connection?.status === 'unresponsive';
  const connecting = connection?.status === 'connecting';
  const attached = connected || unresponsive;
  const blocked = !live || !!busy || performance.busy || connecting;
  const needsLaunch =
    live &&
    !paused &&
    !attached &&
    !connecting &&
    !import.meta.env.DEV &&
    !connection?.endpoint &&
    !connection?.targets.length;

  useEffect(() => {
    if (!connectionEdited && connection?.endpoint) {
      setEndpoint(connection.endpoint);
      setTargetId(connection.targetId || '');
    }
  }, [connection?.endpoint, connection?.targetId, connectionEdited]);

  async function run(name: string, action: () => Promise<unknown>) {
    if (blocked) return;
    setBusy(name);
    try {
      await action();
    } catch (error) {
      notify((error as Error).message, true);
      throw error;
    } finally {
      setBusy('');
    }
  }

  const connectButton = (primary: boolean) => (
    <Button
      id={primary ? 'connect-codex' : 'connect-codex-manual'}
      type="button"
      variant={primary ? 'default' : 'outline'}
      disabled={blocked || paused}
      onClick={() =>
        void run('connect', async () => {
          await request('connect', { endpoint, targetId: targetId || null });
          setConnectionEdited(false);
          notify(tr('已连接 Codex'));
        }).catch(() => {})
      }
    >
      {tr(busy === 'connect' || connecting ? '正在连接…' : attached ? '重新连接' : '连接 Codex')}
    </Button>
  );
  const pauseButton = (
    <Button
      id="connection-pause"
      aria-label={tr(paused ? '恢复连接' : '持续暂停')}
      type="button"
      variant={paused ? 'default' : 'outline'}
      disabled={blocked || performance.disabled}
      onClick={() => void performance.save({ integrationEnabled: paused })}
    >
      {tr(paused ? '恢复连接' : '持续暂停')}
    </Button>
  );
  return (
    <>
      {confirmation}
      <Card id="settings-connection" aria-labelledby="connection-title" tabIndex={-1}>
        <div className="settings-section-heading">
          <h2 id="connection-title">{tr('桌面连接')}</h2>
          <span role="status" className="text-sm text-muted-foreground">
            {tr(
              !live
                ? '本地服务未连接'
                : paused
                  ? '已暂停'
                  : unresponsive
                    ? '页面暂未响应'
                    : connected
                      ? '已连接'
                      : connecting
                        ? '正在连接…'
                        : '未连接',
            )}
          </span>
        </div>
        {paused && <p className="settings-help">{tr('重启后仍保持暂停。')}</p>}
        {needsLaunch && (
          <p className="settings-help">
            {tr('首次接入：等待任务结束并完整退出 ChatGPT，再在终端运行启动命令。')}
          </p>
        )}
        <div className="settings-actions mt-4" data-settings-navigation>
          {needsLaunch && (
            <Button
              id="copy-codex-launch"
              type="button"
              disabled={blocked}
              onClick={() =>
                void run('copy', async () => {
                  await navigator.clipboard.writeText('palboo launch --restart-running');
                  notify(tr('已复制启动命令'));
                }).catch(() => {})
              }
            >
              {tr('复制启动命令')}
            </Button>
          )}
          {!paused && !needsLaunch && !connected && !diagnosticsOpen && connectButton(true)}
          {pauseButton}
          {attached && !paused && (
            <ConfirmationButton
              id="disconnect-codex"
              type="button"
              variant="ghost"
              disabled={blocked}
              title={tr('断开本次 Codex 连接？')}
              description={tr('Palboo 将停止跟随当前聊天并收回桌面浮窗，启动偏好不会改变。')}
              confirmLabel={tr('确认断开')}
              onConfirm={() =>
                run('disconnect', async () => {
                  await request('disconnect', {});
                  notify(tr('连接已断开，桌面浮窗已移除。'));
                })
              }
            >
              {tr('断开本次')}
            </ConfirmationButton>
          )}
        </div>
        {live && !paused && !connected && !connecting && !needsLaunch && connection?.message && (
          <Feedback text={connection.message} />
        )}
        <Feedback
          text={performance.message || (performance.busy ? tr('正在保存…') : '')}
          failed={!!performance.message}
          target={performance.target}
        />
      </Card>
      <Card>
        <details
          id="connection-diagnostics"
          className="settings-disclosure"
          onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
        >
          <summary data-settings-navigation>
            {tr('连接诊断')}
            <Icon name="chevron-down" />
          </summary>
          <div className="settings-disclosure-content">
            <div
              data-settings-navigation
              onChange={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing &&
                  event.target instanceof HTMLInputElement
                )
                  event.preventDefault();
              }}
            >
              <Field id="cdp-endpoint" label={tr('本机调试端口')}>
                <Input
                  id="cdp-endpoint"
                  readOnly={import.meta.env.DEV}
                  value={endpoint}
                  onChange={(event) => {
                    setEndpoint(event.target.value);
                    setTargetId('');
                    setConnectionEdited(true);
                  }}
                  placeholder={tr('9229 或 http://127.0.0.1:9229')}
                  spellCheck={false}
                />
              </Field>
              {(connection?.targets.length || 0) > 1 && (
                <Field id="target" label={tr('Codex 窗口')}>
                  <NativeSelect
                    id="target"
                    disabled={import.meta.env.DEV}
                    value={targetId}
                    onChange={(event) => {
                      setTargetId(event.target.value);
                      setConnectionEdited(true);
                    }}
                  >
                    <option value="">{tr('自动选择')}</option>
                    {connection?.targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.title}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
              {!paused && <div className="settings-actions">{connectButton(false)}</div>}
            </div>
            {form && (
              <Field id="host-restart-policy" label={tr('ChatGPT 已打开，但没有调试连接时')}>
                <NativeSelect
                  id="host-restart-policy"
                  controlWidth="medium"
                  value={form.hostRestartPolicy}
                  onChange={(event) => {
                    if (event.target.value === 'force') {
                      event.stopPropagation();
                      confirm({
                        title: tr('允许直接强制重开？'),
                        description: tr(
                          '以后无法连接已打开的 Codex 时，将不再询问而直接强制退出，可能中断任务或丢失未保存内容。',
                        ),
                        confirmLabel: tr('确认启用'),
                        action: () => {
                          change('hostRestartPolicy', 'force');
                          return editor.save();
                        },
                      });
                    } else change('hostRestartPolicy', 'ask');
                  }}
                >
                  <option value="ask">{tr('询问后正常重开')}</option>
                  <option value="force">{tr('直接强制重开')}</option>
                </NativeSelect>
              </Field>
            )}
            <PerformanceSettings performance={performance} active={active && diagnosticsOpen} />
          </div>
        </details>
      </Card>
    </>
  );
}
