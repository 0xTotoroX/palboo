/* [INPUT]: Local roster and installation-bound account fingerprint.
 * [OUTPUT]: Existing-agent validation before any BDK operation.
 * [POS]: PALBOO BDK overlay, using pinned upstream tools for session/cursor handling.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { resolveApiKeySync } = await import(
  new URL('./internal/cursor/credentials.js', import.meta.resolve('@cursor/bdk'))
);
import { readCatalog } from './catalog.mjs';
export function catalog() {
  const result = readCatalog();
  const binding = JSON.parse(readFileSync(new URL('./account.json', import.meta.url), 'utf8'));
  const account = binding.account;
  const key = resolveApiKeySync({})?.apiKey;
  if (!key || createHash('sha256').update(key).digest('hex') !== binding.credentialFingerprint)
    throw new Error('BDK 登录已变化，请重新核对账号后连接');
  if (result.account !== account)
    throw new Error('Grok Bot 账号已变化，请重新核对 BDK 登录账号后连接');
  return result;
}
export function requireBot(input) {
  const result = catalog();
  if (result.stale) throw new Error('Grok Bot 名单缓存已过期，请打开 Grok Bot 等待同步后重试');
  const bot = result.bots.find((b) => b.name === input.agent?.trim());
  if (!bot?.available) throw new Error('未找到唯一的现有 Bot；请刷新名单，不得新建 Bot');
  return { ...input, agent: bot.name };
}
export async function upstream(name) {
  // Private import is pinned to BDK 0.2.27 and covered by installation validation.
  const entry = import.meta.resolve('@cursor/bdk');
  return (await import(new URL(`./extensions/cursor-grokbot-agents/tools/${name}.js`, entry)))
    .default;
}
