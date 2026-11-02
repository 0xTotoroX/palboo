import { useLocale } from '../../shared/use-locale';
import { tr } from '../../shared/i18n.js';
/* [INPUT]: Host metadata, guarded composer actions and an explicit read-only reply loader.
 * [OUTPUT]: Status-gated Bot actions plus message-directory/detail navigation and icon-only header controls.
 * [POS]: Palboo feature content, shared by existing surfaces; no second chat input.
 * [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
import { useEffect, useId, useState } from 'react';
import { BotMessages, type ReplyLoader } from './messages';
import type { Reading } from '../../shared/features';
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
  openApp,
  openDisabled = false,
  readReply,
  reading,
}: {
  readReply?: ReplyLoader;
  reading?: Reading;
  headerActions?: HTMLElement;
  state: BotState;
  disabled: boolean;
  action: (data: Record<string, unknown>) => void;
  openApp?: () => void;
  openDisabled?: boolean;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const previewId = useId();
  const snapshot = state.snapshot;
  useEffect(() => setSelected(null), [snapshot?.catalog?.revision]);
  const opener = openApp ? (
    <button
      type="button"
      className="palboo-bot-open"
      aria-label={tr('打开 Grok Bot')}
      title={tr('打开 Grok Bot')}
      disabled={openDisabled}
      onClick={openApp}
    >
      <Icon name="detach" />
    </button>
  ) : null;
  if (!snapshot)
    return (
      <section className="palboo-bots">
        {headerActions
          ? createPortal(opener, headerActions)
          : opener && <div className="palboo-bot-toolbar">{opener}</div>}
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
  const historyLabel = selected
    ? tr('返回最近消息')
    : expanded
      ? tr('返回 Bot 列表')
      : tr('最近消息');
  const controls = (
    <>
      {refresh}
      {hasBots && (
        <button
          type="button"
          className="palboo-bot-history"
          aria-label={historyLabel}
          title={historyLabel}
          aria-expanded={expanded}
          aria-controls={expanded ? previewId : undefined}
          onClick={() => (selected ? setSelected(null) : setExpanded(!expanded))}
        >
          <Icon name={selected ? 'back' : expanded ? 'catalog' : 'outline'} />
        </button>
      )}
      {opener}
    </>
  );
  return (
    <section className="palboo-bots" aria-label="Grok Bot">
      {headerActions
        ? createPortal(controls, headerActions)
        : (hasBots || opener || refresh) && <div className="palboo-bot-toolbar">{controls}</div>}
      {notice && <BotStatus className="palboo-bot-notice" label={tr(notice)} icon="warning" />}
      {expanded && (
        <BotMessages
          key={snapshot.catalog?.revision || ''}
          bots={messages}
          selected={selected}
          select={setSelected}
          revision={snapshot.catalog?.revision || ''}
          stale={Boolean(snapshot.catalog?.stale)}
          readReply={readReply}
          reading={reading}
          id={previewId}
        />
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
              const pending = ['calling', 'running'].includes(bot.current?.status || '');
              const canFollowup = ['finished', 'interrupted'].includes(bot.current?.status || '');
              const followupNotice =
                bot.current && !pending && !canFollowup
                  ? tr('此调用暂时无法追问，请先在主聊天确认状态。')
                  : '';
              const label = [
                bot.available === false ? tr('Bot 重名，请在 Grok Bot 中改名。') : '',
                bot.current ? status[bot.current.status] || tr('状态待确认') : '',
                bot.occupied ? tr('其他聊天正在调用') : '',
                bot.unread ? tr('有未读消息') : '',
                followupNotice,
              ]
                .filter(Boolean)
                .join(' · ');
              const unavailable = Boolean(blocked || bot.occupied || bot.available === false);
              const descriptionId = `${previewId}-${encodeURIComponent(id)}`;
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
                          aria-description={followupNotice || undefined}
                          disabled={unavailable || (!pending && !canFollowup)}
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
