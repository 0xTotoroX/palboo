import { useLocale } from '../../shared/use-locale';
import { tr } from '../../shared/i18n.js';
/* [INPUT]: Metadata-only host projection and guarded main-composer actions.
 * [OUTPUT]: Avatar-based status and one corner badge, hover actions and a shared latest-message view.
 * [POS]: Palboo feature content, shared by existing surfaces; no second chat input.
 * [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../shared/icons/react';
import { BotAvatar, type BotBadge } from './avatar';
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
function BotStatus({
  label,
  icon,
  className = '',
}: {
  label: string;
  icon: string;
  className?: string;
}) {
  return (
    <span
      className={`palboo-bot-status palboo-bot-hint ${className}`}
      role="status"
      tabIndex={0}
      aria-label={label}
    >
      <Icon name={icon} />
      <span className="palboo-bot-hint-text" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
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
  const [expanded, setExpanded] = useState(false);
  const previewId = useId();
  const snapshot = state.snapshot;
  if (!snapshot)
    return (
      <section className="palboo-bots">
        <BotStatus className="palboo-bot-notice" label={tr('等待 Codex 连接…')} icon="connection" />
      </section>
    );
  const blocked = disabled || !snapshot.target || snapshot.catalog?.stale;
  const groups = botGroups(snapshot.bots, snapshot.catalog?.sidebar);
  const hasBots = groups.some((group) => group.bots.length);
  const messages = groups.flatMap((group) => group.bots).filter((bot) => bot.preview);
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
      {notice && <BotStatus className="palboo-bot-notice" label={tr(notice)} icon="warning" />}
      {hasBots && (
        <div className="palboo-bot-toolbar">
          <button
            type="button"
            className="palboo-bot-history"
            aria-expanded={expanded}
            aria-controls={expanded ? previewId : undefined}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? tr('返回 Bot 列表') : tr('最近消息')}
          </button>
        </div>
      )}
      {expanded && (
        <section className="palboo-bot-messages" id={previewId} aria-label={tr('最近消息')}>
          {messages.length ? (
            messages.map((bot) => (
              <article className="palboo-bot-message" key={bot.id || bot.name}>
                <h3>{bot.name}</h3>
                <p className="palboo-bot-preview">{bot.preview}</p>
              </article>
            ))
          ) : (
            <BotStatus
              className="palboo-bot-notice"
              label={tr('暂无最近消息')}
              icon="feature-bots"
            />
          )}
        </section>
      )}
      {!expanded &&
        groups.map((group) => (
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
              const working =
                bot.occupied || ['calling', 'running'].includes(bot.current?.status || '');
              const abnormal =
                bot.available === false ||
                ['error', 'unknown', 'unexpected', 'disconnected'].includes(
                  bot.current?.status || '',
                );
              const badge: BotBadge | undefined = abnormal
                ? 'error'
                : bot.occupied
                  ? 'occupied'
                  : bot.unread
                    ? 'unread'
                    : bot.current?.status === 'interrupted'
                      ? 'stopped'
                      : undefined;
              const label = [
                bot.available === false ? tr('Bot 重名，请在 Grok Bot 中改名。') : '',
                bot.current ? status[bot.current.status] || tr('状态待确认') : '',
                bot.occupied ? tr('其他聊天正在调用') : '',
                bot.unread ? tr('有未读消息') : '',
              ]
                .filter(Boolean)
                .join(' · ');
              const unavailable = Boolean(blocked || bot.occupied || bot.available === false);
              const descriptionId = `${previewId}-${encodeURIComponent(id)}`;
              const pending = ['calling', 'running'].includes(bot.current?.status || '');
              const primaryAction = pending ? tr('查看进度') : tr('追问');
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
                <div
                  className="palboo-bot"
                  key={id}
                  role="group"
                  aria-label={bot.name}
                  tabIndex={unavailable ? 0 : undefined}
                  aria-describedby={label ? descriptionId : undefined}
                  data-actions={bot.current ? (pending ? 'two' : 'one') : 'none'}
                >
                  <div className="palboo-bot-row">
                    <button
                      type="button"
                      className="palboo-bot-select"
                      aria-label={bot.name}
                      aria-describedby={label ? descriptionId : undefined}
                      disabled={unavailable}
                      onClick={() => send('ask')}
                    >
                      <span
                        className="palboo-bot-avatar-status"
                        role={label ? 'status' : undefined}
                        aria-label={label || undefined}
                      >
                        <BotAvatar
                          avatar={bot.avatar}
                          badge={badge}
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
                      </span>
                      <span className="palboo-bot-copy">{bot.name}</span>
                    </button>
                    {label && (
                      <span
                        className="palboo-bot-hint-text palboo-bot-state-description"
                        id={descriptionId}
                        aria-hidden="true"
                      >
                        {label}
                      </span>
                    )}
                    {bot.current && (
                      <div className="palboo-bot-actions">
                        <button
                          type="button"
                          className="palboo-bot-hint"
                          aria-label={primaryAction}
                          disabled={unavailable}
                          onClick={() => send(pending ? 'check' : 'followup')}
                        >
                          <Icon name={pending ? 'eye' : 'feature-bots'} />
                          <span className="palboo-bot-hint-text" aria-hidden="true">
                            {primaryAction}
                          </span>
                        </button>
                        {pending && (
                          <button
                            type="button"
                            className="palboo-bot-hint"
                            aria-label={tr('填入停止请求')}
                            disabled={unavailable}
                            onClick={() => send('stop')}
                          >
                            <Icon name="close" />
                            <span className="palboo-bot-hint-text" aria-hidden="true">
                              {tr('填入停止请求')}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
    </section>
  );
}
