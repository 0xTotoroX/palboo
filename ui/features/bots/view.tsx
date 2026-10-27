import { useLocale } from '../../shared/use-locale';
import { tr } from '../../shared/i18n.js';
/* [INPUT]: Metadata-only host projection and guarded main-composer actions.
 * [OUTPUT]: Compact Bot selectors, animated activity and opt-in latest-message disclosure.
 * [POS]: Palboo feature content, shared by existing surfaces; no second chat input.
 * [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
import { useId, useState } from 'react';
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
  get calling() {
    return tr('正在调用');
  },
  get running() {
    return tr('处理中');
  },
  get finished() {
    return tr('已回复');
  },
  get busy() {
    return tr('忙碌');
  },
  get interrupted() {
    return tr('已停止');
  },
  get error() {
    return tr('调用失败');
  },
  get unknown() {
    return tr('状态待确认');
  },
  get unexpected() {
    return tr('Bot 身份异常，请在主聊天核查');
  },
  get disconnected() {
    return tr('连接已变化，请在主聊天核查');
  },
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
  useLocale();
  const [expanded, setExpanded] = useState<string | null>(null);
  const previewId = useId();
  const snapshot = state.snapshot;
  if (!snapshot) return <p className="feature-placeholder">{tr('等待 Codex 连接…')}</p>;
  const blocked = disabled || !snapshot.target || snapshot.catalog?.stale;
  const groups = botGroups(snapshot.bots, snapshot.catalog?.sidebar);
  const hasBots = groups.some((group) => group.bots.length);
  const notice =
    snapshot.catalog?.error ||
    snapshot.catalog?.sidebarError ||
    (snapshot.catalog?.stale
      ? tr('请打开 Grok Bot 更新资料。')
      : !hasBots
        ? tr('暂无 Bot')
        : !snapshot.target
          ? tr('请先打开可输入的聊天')
          : '');
  const refresh =
    state.autoSync === false ? (
      <button
        type="button"
        data-refresh="bots"
        aria-label={tr('刷新 Bot 资料')}
        disabled={disabled}
        onClick={() => action({ action: 'refresh' })}
      >
        <Icon name="refresh" />
      </button>
    ) : null;
  return (
    <section className="palboo-bots" aria-label="Grok Bot">
      {headerActions ? createPortal(refresh, headerActions) : refresh}
      {notice && <p role="status">{tr(notice)}</p>}
      {groups.map((group) => (
        <section
          className="palboo-bot-group"
          key={group.id}
          aria-label={group.name || tr('Bot 列表')}
        >
          {group.kind !== 'pinned' && group.name && (
            <h3 className="palboo-bot-group-title">{group.name}</h3>
          )}
          {group.bots.map((bot) => {
            const id = bot.id || bot.name;
            const open = expanded === id;
            const working =
              bot.occupied || ['calling', 'running'].includes(bot.current?.status || '');
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
              <div className="palboo-bot" key={id}>
                <div className="palboo-bot-row">
                  <button
                    type="button"
                    className="palboo-bot-select"
                    aria-label={bot.name}
                    disabled={blocked || bot.occupied || bot.available === false}
                    onClick={() => send('ask')}
                  >
                    <BotAvatar
                      avatar={bot.avatar}
                      activity={
                        snapshot.catalog?.stale
                          ? undefined
                          : working
                            ? 'working'
                            : bot.current?.status === 'finished'
                              ? 'finished'
                              : undefined
                      }
                    />
                    <span className="palboo-bot-copy">
                      <span>{bot.name}</span>
                    </span>
                  </button>
                  {bot.preview && (
                    <button
                      type="button"
                      className="palboo-bot-history"
                      aria-label={tr('最近消息：{{name}}', { name: bot.name })}
                      title={tr('最近消息')}
                      aria-expanded={open}
                      aria-controls={open ? `${previewId}-${encodeURIComponent(id)}` : undefined}
                      onClick={() => setExpanded(open ? null : id)}
                    >
                      <Icon name="chevron-right" />
                    </button>
                  )}
                </div>
                {open && bot.preview && (
                  <p className="palboo-bot-preview" id={`${previewId}-${encodeURIComponent(id)}`}>
                    {bot.preview}
                  </p>
                )}
                {bot.available === false && (
                  <span className="palboo-bot-status">
                    {tr('Bot 重名，请在 Grok Bot 中改名。')}
                  </span>
                )}
                {(bot.current || bot.occupied) && (
                  <span className="palboo-bot-status" role="status">
                    {bot.occupied
                      ? tr('其他聊天正在调用')
                      : status[bot.current!.status] || tr('状态待确认')}
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
                      {['calling', 'running'].includes(bot.current.status)
                        ? tr('查看进度')
                        : tr('追问')}
                    </button>
                    {['calling', 'running'].includes(bot.current.status) && (
                      <button
                        type="button"
                        disabled={blocked || bot.occupied || bot.available === false}
                        onClick={() => send('stop')}
                      >
                        {tr('填入停止请求')}
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
