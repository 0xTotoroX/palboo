/* [INPUT]: 已校验当前聊天身份的宿主测速快照。
 * [OUTPUT]: 与模型选择无关、只含数值的可选测速投影契约。
 * [POS]: 采集器与可插拔视图共用，不包含原文或持久设置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export interface TokenMeterSnapshot {
  threadId: string;
  phase: string;
  speed: number | null;
  /** 当前聊天最近一次有效的可见回复测速；不是当前阶段的实时速度。 */
  lastSpeed?: number | null;
  official: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  } | null;
  scope: 'turn' | 'call';
  average: number | null;
}
