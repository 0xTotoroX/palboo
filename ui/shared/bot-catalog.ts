/* [INPUT]: Account-verified Bot identities and optional saved sidebar projection.
 * [OUTPUT]: Shared metadata types and visible groups with kind preserved in upstream order.
 * [POS]: Pure presentation contract for Bot feature and settings; no reads or timers.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md */
export type BotIdentity = { id?: string; name: string; hidden?: boolean };
export type BotSidebar = {
  version: 1;
  groups: {
    id: string;
    kind: 'pinned' | 'section' | 'unassigned';
    name: string;
    botIds: string[];
  }[];
};
export function botGroups<T extends BotIdentity>(bots: T[], sidebar?: BotSidebar) {
  const visible = bots.filter((bot) => !bot.hidden);
  if (!sidebar) return [{ id: 'all', kind: 'unassigned' as const, name: '', bots: visible }];
  const byId = new Map(visible.map((bot) => [bot.id, bot]));
  return sidebar.groups.map((group) => ({
    id: group.id,
    kind: group.kind,
    name: group.name,
    bots: group.botIds.flatMap((id) => {
      const bot = byId.get(id);
      return bot ? [bot] : [];
    }),
  }));
}
