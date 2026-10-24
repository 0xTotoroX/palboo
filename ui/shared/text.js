/* [INPUT]: Text and numeric values. [OUTPUT]: Escaping, normalization, concise error presentation and bounds shared by views and adapters.
 * [POS]: Pure helpers. [PROTOCOL]: Keep shared/AGENTS.md in sync. */
export function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

/** @param {unknown} error */
export function errorMessage(error) {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : error;
  const text = typeof message === 'string' ? message.replace(/^Error:\s*/, '').trim() : '';
  if (text === '当前聊天中未找到该术语的位置，聊天可能已切换或内容已更新')
    return '未找到原文，请刷新术语。';
  return text || '操作失败，请重试。';
}
