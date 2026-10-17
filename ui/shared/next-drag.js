/* [INPUT]: 下一步的只读投影与原生 DataTransfer。
 * [OUTPUT]: 无正文的拖放身份载荷，以及复制拖放的共用 MIME 标识。
 * [POS]: 内容视图与 Codex 接收端之间的临时契约，不保存配置或执行写入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export const NEXT_DRAG_TYPE = 'application/x-codex-buddy-next';
export function nextDragCommand(snapshot, index) {
  if (!snapshot?.instanceId || !snapshot.viewToken || !snapshot.prompts?.[index]?.prompt)
    return null;
  return {
    kind: 'fill',
    instanceId: snapshot.instanceId,
    viewToken: snapshot.viewToken,
    context: snapshot.context,
    promptToken: snapshot.promptToken,
    index,
    submit: false,
  };
}
