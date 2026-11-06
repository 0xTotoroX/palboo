/*
 * [INPUT]: 已核验的本地 ComposerScope、宿主附件接口和侧聊文字快照。
 * [OUTPUT]: 原生粘贴文本卡片；内容哈希去重、写入前后核验和失败时仅回收本次附件。
 * [POS]: 侧聊接力的本地附件适配，不改输入正文、不上传云端、不发送或读取原始会话文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { tr } from '../shared/i18n.js';

export async function attachLocalSideChatText(runtime, scope, text, preview, guard) {
  const state = runtime.c.TSib?.exports;
  if (
    scope?.value.kind !== 'local' ||
    scope.value.placement !== 'main' ||
    !state?.VH ||
    !state.kV ||
    !state.YH ||
    !state.TQ ||
    typeof state.Rh !== 'function' ||
    !globalThis.crypto?.subtle
  )
    return false;
  const rpc = runtime.c.Dgwo?.exports?.V?.(scope, 'local');
  if (
    typeof rpc?.createPastedTextAttachment !== 'function' ||
    typeof rpc.removePastedTextAttachment !== 'function' ||
    scope.get(state.YH) !== 'local'
  )
    return false;
  const before = scope.get(state.VH);
  if (!Array.isArray(before)) return false;
  const generation = scope.get(state.kV);
  const changed = () => Error(tr('草稿或聊天已变化，未继续带回。'));
  const check = () => {
    guard();
    if (
      scope.get(state.kV) !== generation ||
      scope.get(state.YH) !== 'local' ||
      scope.get(state.TQ)
    )
      throw changed();
  };
  check();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const filename = `palboo-side-chat-${hash}.md`;
  check();
  if (scope.get(state.VH) !== before) throw changed();
  if (
    before.some(
      (item) =>
        item.hostId === 'local' &&
        item.characterCount === text.length &&
        item.file?.path?.endsWith(`/${filename}`),
    )
  )
    return true;
  let file, attachment;
  try {
    file = await rpc.createPastedTextAttachment(text, `${tr('侧聊记录')}.md`, filename);
    check();
    if (!file?.path || scope.get(state.VH) !== before) throw changed();
    attachment = { file, hostId: 'local', characterCount: text.length, preview };
    // 原生更新器传入 Immer 草稿代理；列表身份在调用前核验，不与代理比较。
    state.Rh(scope, 'pastedTextAttachments', (items) => [...items, attachment]);
    check();
    const after = scope.get(state.VH);
    if (
      after.length !== before.length + 1 ||
      after.at(-1)?.file?.path !== file.path ||
      before.some((item, index) => after[index] !== item)
    )
      throw Error(tr('输入框未完整接收结果，请检查当前草稿。'));
    return true;
  } catch (error) {
    if (file?.path) {
      // 仅移除本次创建的路径；原卡片、用户后续添加的附件及正文保持原样。
      try {
        state.Rh(scope, 'pastedTextAttachments', (items) =>
          items.filter((item) => item.file?.path !== file.path),
        );
      } catch {}
      // 若卡片未能解除引用，保留文件，不能留下指向已删除文件的卡片。
      try {
        if (!scope.get(state.VH).some((item) => item.file?.path === file.path))
          await rpc.removePastedTextAttachment(file.path);
      } catch {}
    }
    throw error;
  }
}
