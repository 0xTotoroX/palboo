/* [INPUT]: Metadata-only host projection and guarded main-composer actions.
 * [OUTPUT]: Dynamic Bot selectors with chat-scoped status, follow-up and stop requests.
 * [POS]: Palboo feature content, shared by existing surfaces; no second chat input.
 * [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
import { createPortal } from 'react-dom';
import { Icon } from '../../shared/icons/react';
import { BotAvatar } from './avatar';
import { botGroups, type BotSidebar } from '../../shared/bot-catalog';
export type BotState = {
  autoSync?: boolean;
  snapshot: {
    target: { threadId: string; token: string } | null;
    catalog?: {
      revision: string;
      stale: boolean;
      error?: string;
      updatedAt?: number;
      sidebar?: BotSidebar;
      sidebarError?: string;
    };
    bots: {
      id?: string;
      available?: boolean;
      hidden?: boolean;
      avatar?: { shape: string; color: string; photoAvailable?: boolean };
      preview?: string;
      description?: string;
      unread?: boolean;
      name: string;
      occupied: boolean;
      current: { key: string; status: string } | null;
    }[];
  } | null;
};
const status: Record<string, string> = {
  calling: '正在调用',
  running: 'Bot 处理中',
  finished: '回复已返回 Codex',
  busy: 'Bot 忙碌',
  interrupted: '已停止',
  error: '调用失败',
  unknown: '状态待确认',
  unexpected: 'Bot 身份异常，请在主聊天核查',
  disconnected: '连接已变化，请在主聊天核查',
};
export function BotsView({
  state,
  disabled,
  action,
  headerActions,
}: {
  headerActions?: HTMLElement;
  state: BotState;
  disabled: boolean;
  action: (data: Record<string, unknown>) => void;
}) {
  const snapshot = state.snapshot;
  if (!snapshot) return <p className="feature-placeholder">等待 Codex 连接…</p>;
  const blocked = disabled || !snapshot.target || snapshot.catalog?.stale;
  const groups = botGroups(snapshot.bots, snapshot.catalog?.sidebar);
  const refresh =
    state.autoSync === false ? (
      <button
        type="button"
        data-refresh="bots"
        aria-label="刷新 Bot 资料"
        disabled={disabled}
        onClick={() => action({ action: 'refresh' })}
      >
        <Icon name="refresh" />
      </button>
    ) : null;
  return (
    <section className="palboo-bots" aria-label="Grok Bot">
      {headerActions ? createPortal(refresh, headerActions) : refresh}
      {snapshot.catalog?.error && <p role="status">{snapshot.catalog.error}</p>}
      {snapshot.catalog?.sidebarError && <p role="status">{snapshot.catalog.sidebarError}</p>}
      {snapshot.catalog?.stale && !snapshot.catalog.error && (
        <p role="status">资料已过期，请打开 Grok Bot 等待同步。</p>
      )}
      {!snapshot.catalog?.error && !groups.some((group) => group.bots.length) && (
        <p role="status">当前没有显示的 Bot。</p>
      )}
      {groups.map((group) => (
        <section className="palboo-bot-group" key={group.id} aria-label={group.name || 'Bot 列表'}>
          {group.name && <h3 className="palboo-bot-group-title">{group.name}</h3>}
          {group.bots.map((bot) => {
            const send = (intent: string) =>
              action({
                ...snapshot.target,
                agent: bot.name,
                botId: bot.id,
                revision: snapshot.catalog?.revision,
                action: intent,
                key: bot.current?.key,
              });
            return (
              <div className="palboo-bot" key={bot.id || bot.name}>
                <button
                  type="button"
                  className="palboo-bot-select"
                  aria-label={bot.name}
                  disabled={blocked || bot.occupied || bot.available === false}
                  onClick={() => send('ask')}
                >
                  <BotAvatar avatar={bot.avatar} />
                  <span className="palboo-bot-copy">
                    <span>{bot.name}</span>
                    {bot.preview && (
                      <span className="palboo-bot-preview" title={bot.preview}>
                        {bot.preview}
                      </span>
                    )}
                  </span>
                </button>
                {bot.available === false && (
                  <span className="palboo-bot-status">存在同名 Bot，请先在 Grok Bot 中改名。</span>
                )}
                {(bot.current || bot.occupied) && (
                  <span className="palboo-bot-status" role="status">
                    {bot.occupied
                      ? '其他聊天正在调用'
                      : status[bot.current!.status] || '状态待确认'}
                  </span>
                )}
                {bot.current && (
                  <div className="palboo-bot-actions">
                    <button
                      type="button"
                      disabled={blocked || bot.occupied || bot.available === false}
                      onClick={() =>
                        send(
                          ['calling', 'running'].includes(bot.current!.status)
                            ? 'check'
                            : 'followup',
                        )
                      }
                    >
                      {['calling', 'running'].includes(bot.current.status) ? '查看进度' : '追问'}
                    </button>
                    {['calling', 'running'].includes(bot.current.status) && (
                      <button
                        type="button"
                        disabled={blocked || bot.occupied || bot.available === false}
                        onClick={() => send('stop')}
                      >
                        填入停止请求
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </section>
  );
}
