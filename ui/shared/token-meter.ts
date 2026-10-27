/* [INPUT]: 已校验当前聊天身份的宿主测速快照。
 * [OUTPUT]: 当前聊天状态与当前模型最近测速的可选投影契约。
 * [POS]: 采集器与可插拔视图共用，不包含原文或持久设置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export interface TokenMeterSnapshot {
  threadId: string;
  phase: string;
  speed: number | null;
  /** 当前模型及 Fast 模式最近一次有效测速，可来自其他聊天。 */
  lastSpeed?: number | null;
  model?: string;
  fast?: boolean;
  official: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  } | null;
  scope: 'turn' | 'call';
  average: number | null;
}
