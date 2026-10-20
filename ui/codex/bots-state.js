/* [INPUT]: Codex MCP notifications carrying host, thread, turn and item identities.
 * [OUTPUT]: Bounded metadata-only records for the four existing Grok Bots.
 * [POS]: Pure observation; never reads BDK replies or creates remote sessions.
 * [PROTOCOL]: Keep ui/codex/AGENTS.md in sync. */
export const BOT_NAMES = ['X 资讯', '随口一问', '通用', '环境运维'];
const ACTIONS = ['grokbot__ask', 'grokbot__check', 'grokbot__interrupt'];
const pending = (status) => ['calling', 'running'].includes(status);
export function createBotTracker() {
  const records = new Map();
  function receive(hostId, method, params) {
    // This bridge is local. Remote hosts must not claim a local Bot's conversation.
    if (hostId !== 'local' || !params?.threadId || !params.turnId) return;
    if (method === 'turn/completed') {
      for (const record of records.values()) {
        if (
          record.threadId === params.threadId &&
          record.turnId === params.turnId &&
          record.status === 'calling'
        )
          record.status = 'unknown';
      }
      return;
    }
    const item = params.item;
    if (
      !['item/started', 'item/completed'].includes(method) ||
      item?.type !== 'mcpToolCall' ||
      item.server !== 'grokbot' ||
      item.tool !== 'call_tool' ||
      !item.id
    )
      return;
    const args = item.arguments;
    if (!ACTIONS.includes(args?.toolName) || !BOT_NAMES.includes(args?.input?.agent)) return;
    const key = JSON.stringify([hostId, params.threadId, params.turnId, item.id]);
    const previous = records.get(key);
    if (previous?.completed) return; // Duplicates and late starts cannot regress a terminal item.
    const record = {
      key,
      hostId,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: item.id,
      agent: args.input.agent,
      action: args.toolName,
      status: 'calling',
      completed: method === 'item/completed',
    };
    if (record.completed) {
      let envelope;
      for (const content of item.result?.content ?? []) {
        if (content.type !== 'text' || typeof content.text !== 'string') continue;
        try {
          const candidate = JSON.parse(content.text);
          if (candidate.toolName === args.toolName) envelope = candidate;
        } catch {
          // Unknown responses remain unknown; they are never rendered as reply text.
        }
      }
      const result = envelope?.result;
      if (item.error || item.result?.isError || envelope?.isError) record.status = 'error';
      else if (result?.created === true) record.status = 'unexpected';
      else if (result?.agent && result.agent !== record.agent) record.status = 'unknown';
      else if (['running', 'finished', 'busy', 'interrupted'].includes(result?.status))
        record.status = result.status;
      else record.status = 'unknown';
      if (typeof result?.sessionId === 'string') record.sessionId = result.sessionId;
    }
    records.set(key, record);
    while (records.size > 128) records.delete(records.keys().next().value);
  }
  function snapshot(threadId) {
    const all = [...records.values()];
    return BOT_NAMES.map((name) => {
      const current = all.filter((r) => r.agent === name && r.threadId === threadId).at(-1);
      // A check/interrupt in another chat cannot resolve the original caller's status.
      const latestByThread = new Map();
      for (const record of all.filter((r) => r.agent === name))
        latestByThread.set(record.threadId, record);
      const occupied = [...latestByThread.values()].some(
        (r) => r.threadId !== threadId && pending(r.status),
      );
      return { name, current: current ? { ...current } : null, occupied };
    });
  }
  return {
    receive,
    snapshot,
    disconnect() {
      for (const r of records.values()) if (pending(r.status)) r.status = 'disconnected';
    },
    clear: () => records.clear(),
  };
}
