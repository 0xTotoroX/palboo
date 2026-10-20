/* [INPUT]: Existing BDK 0.2.27 project and Grok Bot account already matched at login.
 * [OUTPUT]: Backed-up PALBOO directory overlay and main-chat Skill; no new Bot or credentials.
 * [POS]: Explicit local integration install, not an additional service.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync. */
import { readFile, cp, mkdir, rename, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readCatalog } from './grokbot-adapter/catalog.mjs';
const root = resolve(process.argv[2] || '');
if (!process.argv[2])
  throw new Error('用法: node scripts/install-grokbot-adapter.mjs <现有BDK项目>');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (pkg.dependencies?.['@cursor/bdk'] !== '0.2.27') throw new Error('仅验证过 BDK 0.2.27');
const catalog = readCatalog();
const entry = createRequire(join(root, 'package.json')).resolve('@cursor/bdk');
const { resolveApiKeySync } = await import(
  new URL('./internal/cursor/credentials.js', pathToFileURL(entry))
);
const key = resolveApiKeySync({})?.apiKey;
if (!key) throw new Error('请先完成 BDK 登录');
const credentialFingerprint = createHash('sha256').update(key).digest('hex');
if (catalog.stale || !catalog.bots.length) throw new Error('请先打开 Grok Bot 同步现有名单');
const stamp = new Date().toISOString().replaceAll(':', '-');
const backup = join(homedir(), 'Documents/Codex-Archive/backups/palboo-grokbot', stamp);
await mkdir(backup, { recursive: true, mode: 0o700 });
for (const path of [
  'bot/extensions/grokbot.ts',
  'bot/extensions/grokbot',
  'skills/grokbot-bdk/SKILL.md',
]) {
  const source = join(root, path);
  try {
    await access(source);
  } catch {
    continue;
  }
  await cp(source, join(backup, path), { recursive: true });
}
const source = fileURLToPath(new URL('./grokbot-adapter', import.meta.url));
const stage = join(root, '.palboo-grokbot-stage');
await cp(source, stage, { recursive: true });
await writeFile(
  join(stage, 'account.json'),
  JSON.stringify({ account: catalog.account, credentialFingerprint }),
  {
    mode: 0o600,
  },
);
const dest = join(root, 'bot/extensions/grokbot');
try {
  await access(dest);
  await rename(dest, join(backup, 'previous-overlay'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
try {
  await rename(join(root, 'bot/extensions/grokbot.ts'), join(backup, 'previous-mount.ts'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
await rename(stage, dest);
await mkdir(join(root, 'skills/grokbot-bdk'), { recursive: true });
await cp(join(source, 'SKILL.md'), join(root, 'skills/grokbot-bdk/SKILL.md'));
console.log(`已安装 PALBOO 接入：${catalog.bots.length} 个现有 Bot；备份 ${backup}`);
