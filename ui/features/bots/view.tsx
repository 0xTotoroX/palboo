/* [INPUT]: Metadata-only host projection and guarded main-composer actions.
 * [OUTPUT]: Four existing Bot selectors with chat-scoped status, follow-up and stop requests.
 * [POS]: Palboo feature content, shared by existing surfaces; no second chat input.
 * [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
export type BotState = {
  snapshot: {
    target: { threadId: string; token: string } | null;
    bots: {
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
  const blocked = disabled || !snapshot.target;
  return (
    <section className="palboo-bots" aria-label="Grok Bot">
      <p className="palboo-bots-note">选择 Bot 后，在 Codex 主聊天输入并发送。</p>
      {snapshot.bots.map((bot) => {
        const send = (intent: string) =>
          action({
            ...snapshot.target,
            agent: bot.name,
            action: intent,
            key: bot.current?.key,
          });
        return (
          <div className="palboo-bot" key={bot.name}>
            <button
              type="button"
              className="palboo-bot-select"
              disabled={blocked || bot.occupied}
              onClick={() => send('ask')}
            >
              <span className="palboo-bot-avatar" aria-hidden="true">
                {bot.name.slice(0, 1)}
              </span>
              <span>{bot.name}</span>
            </button>
            <span className="palboo-bot-status" role="status">
              {bot.occupied
                ? '其他聊天正在调用'
                : bot.current
                  ? status[bot.current.status] || '状态待确认'
                  : '尚未在本聊天调用'}
            </span>
            {bot.current && (
              <div className="palboo-bot-actions">
                <button
                  type="button"
                  disabled={blocked || bot.occupied}
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
                    disabled={blocked || bot.occupied}
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
