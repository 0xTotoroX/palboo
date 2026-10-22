/* [INPUT]: Codex MCP notifications carrying host, thread, turn and item identities.
 * [OUTPUT]: Bounded metadata-only records and retained task occupancy for catalog-verified Grok Bots.
 * [POS]: Pure observation; never reads BDK replies or creates remote sessions.
 * [PROTOCOL]: Keep ui/codex/AGENTS.md in sync. */
const ACTIONS = ['grokbot__ask', 'grokbot__check', 'grokbot__interrupt'];
const pending = (status) => ['calling', 'running'].includes(status);
export function createBotTracker() {
  let catalog = [];
  const records = new Map();
  const retired = new Set();
  function retire(key) {
    records.delete(key);
    retired.add(key);
    while (retired.size > 128) retired.delete(retired.values().next().value);
  }
  function receive(hostId, method, params) {
    // This bridge is local. Remote hosts must not claim a local Bot's conversation.
    const turnId = params?.turnId || params?.turn?.id;
    if (hostId !== 'local' || !params?.threadId || !turnId) return;
    if (method === 'turn/completed') {
      for (const record of records.values()) {
        if (
          record.threadId === params.threadId &&
          record.turnId === turnId &&
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
    if (!ACTIONS.includes(args?.toolName) || !catalog.some((b) => b.name === args?.input?.agent))
      return;
    const key = JSON.stringify([hostId, params.threadId, turnId, item.id]);
    if (retired.has(key)) return;
    const previous = records.get(key);
    if (previous?.completed) return; // Duplicates and late starts cannot regress a terminal item.
    // A completion without an observed start cannot establish account/Bot ownership.
    if (method === 'item/completed' && !previous) return;
    if (previous && (previous.agent !== args.input.agent || previous.action !== args.toolName))
      return;
    const record = {
      key,
      hostId,
      threadId: params.threadId,
      turnId,
      itemId: item.id,
      agent: args.input.agent,
      agentId: previous?.agentId ?? catalog.find((b) => b.name === args.input.agent)?.id,
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
      else if (result?.interrupted === true) record.status = 'interrupted';
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
    return catalog.map((bot) => {
      const { name } = bot;
      // Request errors and busy replies do not prove the preceding task has ended.
      const latestByThread = new Map();
      const activeByThread = new Map();
      for (const record of all.filter((r) => r.agentId === bot.id && r.agent === name)) {
        latestByThread.set(record.threadId, record);
        const active = activeByThread.get(record.threadId);
        if (record.status === 'running') activeByThread.set(record.threadId, record);
        else if (
          ['finished', 'interrupted', 'disconnected'].includes(record.status) &&
          (!active?.sessionId || !record.sessionId || active.sessionId === record.sessionId)
        )
          activeByThread.delete(record.threadId);
      }
      const latest = latestByThread.get(threadId);
      const current = activeByThread.get(threadId) || latest;
      const occupied = [...latestByThread.values()].some(
        (r) => r.threadId !== threadId && (pending(r.status) || activeByThread.has(r.threadId)),
      );
      return { ...bot, current: current ? { ...current } : null, occupied };
    });
  }
  return {
    receive,
    snapshot,
    setCatalog(bots) {
      for (const [key, record] of records) {
        if (!bots.some((b) => b.id === record.agentId && b.name === record.agent)) retire(key);
      }
      catalog = bots;
    },
    disconnect() {
      for (const r of records.values()) if (pending(r.status)) r.status = 'disconnected';
    },
    clear() {
      for (const key of records.keys()) retire(key);
    },
  };
}
