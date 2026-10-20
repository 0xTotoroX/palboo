/* [INPUT]: Metadata-only host projection and guarded main-composer actions.
 * [OUTPUT]: Dynamic Bot selectors with chat-scoped status, follow-up and stop requests.
 * [POS]: PALBOO feature content, shared by existing surfaces; no second chat input.
 * [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
import { BotAvatar } from './avatar';
export type BotState = {
  snapshot: {
    target: { threadId: string; token: string } | null;
    catalog?: { revision: string; stale: boolean; error?: string; updatedAt?: number };
    bots: {
      id?: string;
      available?: boolean;
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
}: {
  state: BotState;
  disabled: boolean;
  action: (data: Record<string, unknown>) => void;
}) {
  const snapshot = state.snapshot;
  if (!snapshot) return <p className="feature-placeholder">等待 Codex 连接…</p>;
  const blocked = disabled || !snapshot.target || snapshot.catalog?.stale;
  return (
    <section className="palboo-bots" aria-label="Grok Bot">
      <p className="palboo-bots-note">选择 Bot 后，在 Codex 主聊天输入并发送。</p>
      {snapshot.catalog?.error && <p role="status">{snapshot.catalog.error}</p>}
      {snapshot.catalog?.stale && !snapshot.catalog.error && (
        <p role="status">资料已过期，请打开 Grok Bot 等待同步。</p>
      )}
      {!snapshot.catalog?.error && !snapshot.bots.length && (
        <p role="status">当前账号没有可接入的 Bot。</p>
      )}
      {snapshot.bots.map((bot) => {
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
              disabled={blocked || bot.occupied || bot.available === false}
              onClick={() => send('ask')}
            >
              <BotAvatar name={bot.name} avatar={bot.avatar} />
              <span>{bot.name}</span>
            </button>
            {bot.preview && (
              <p className="palboo-bot-preview" title={bot.preview}>
                {bot.preview}
              </p>
            )}
            {bot.description && (
              <details className="palboo-bot-details">
                <summary>简介</summary>
                <p>{bot.description}</p>
              </details>
            )}
            {bot.available === false && (
              <span className="palboo-bot-status">存在同名 Bot，请先在 Grok Bot 中改名。</span>
            )}
            {(bot.current || bot.occupied) && (
              <span className="palboo-bot-status" role="status">
                {bot.occupied ? '其他聊天正在调用' : status[bot.current!.status] || '状态待确认'}
              </span>
            )}
            {bot.current && (
              <div className="palboo-bot-actions">
                <button
                  type="button"
                  disabled={blocked || bot.occupied || bot.available === false}
                  onClick={() =>
                    send(
                      ['calling', 'running'].includes(bot.current!.status) ? 'check' : 'followup',
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
  );
}
