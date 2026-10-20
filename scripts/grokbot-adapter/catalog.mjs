/* [INPUT]: Grok Bot's account-scoped local roster cache, never credentials or transcripts.
 * [OUTPUT]: Validated dynamic catalog and a stable identity revision.
 * [POS]: Shared source for the BDK list and guarded tool overlays.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync. */
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
function appRunning() {
  try {
    execFileSync('/usr/bin/pgrep', ['-x', 'Grok Bot'], { timeout: 1000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
export function cacheFile(key) {
  let bits = 0,
    value = 0,
    out = '';
  for (const byte of Buffer.from(key)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return `${out}.blob`;
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
// Default avatar identity follows the installed app's ID hashing (observed 2026-10-20).
// Rendering is independently drawn by PALBOO; no packaged artwork is copied.
export function avatarIdentity(id, shape, color) {
  const defaults = [
    'blob',
    'cloud',
    'square',
    'sparkle',
    'clover',
    'heart',
    'flower',
    'teardrop',
    'tablet',
    'wedge',
    'house',
    'star',
    'hex',
  ];
  const palette = [
    'brown',
    'red',
    'orange',
    'yellow',
    'green',
    'cyan',
    'blue',
    'violet',
    'magenta',
    'gray',
  ];
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  let mixed = Math.imul(hash ^ (hash >>> 16), 73244475);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 3266489909);
  const defaultShape = defaults[((mixed ^ (mixed >>> 16)) >>> 0) % defaults.length];
  const seed = (hash + 1831565813) | 0;
  let random = Math.imul(seed ^ (seed >>> 15), seed | 1);
  random ^= random + Math.imul(random ^ (random >>> 7), random | 61);
  const defaultColor =
    palette[Math.floor((((random ^ (random >>> 14)) >>> 0) / 4294967296) * palette.length)];
  return { shape: shape || defaultShape, color: color || defaultColor };
}
export function readCatalog({
  root = join(homedir(), 'Library/Application Support/Grok Bot/sand-client-persistence'),
  now = Date.now(),
  running = appRunning(),
} = {}) {
  const read = (key, version) => {
    const path = join(root, cacheFile(key));
    const before = statSync(path);
    const size = before.size;
    if (size > 2 * 1024 * 1024) throw new Error('Grok Bot 资料超出读取上限');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const after = statSync(path);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('Grok Bot 资料正在更新，请重试');
    if (data.schemaVersion !== version)
      throw new Error('Grok Bot 资料格式已变化，请更新 PALBOO 接入');
    return { value: data.value, modifiedAt: after.mtimeMs };
  };
  const slotKey = 'sand.client.slice.client-meta.account-slot';
  const slot = read(slotKey, 1).value;
  if (typeof slot !== 'string' || !slot) throw new Error('请先登录 Grok Bot');
  const roster = read(
    `sand.client.slice.account.${encodeURIComponent(slot)}.roster.last-roster`,
    4,
  );
  if (!Array.isArray(roster.value?.rows)) throw new Error('Grok Bot 名单不可用');
  if (read(slotKey, 1).value !== slot) throw new Error('Grok Bot 账号正在切换');
  const rows = roster.value.rows.filter((r) => !r.isGroup && r.harness === 'temporal');
  const names = new Map();
  for (const r of rows) {
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    names.set(name.toLowerCase(), (names.get(name.toLowerCase()) || 0) + 1);
  }
  const bots = rows.flatMap((r) => {
    if (
      typeof r.id !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(r.id) ||
      typeof r.name !== 'string' ||
      !r.name.trim() ||
      r.name.length > 255
    )
      return [];
    const preview = r.lastEntry?.sessionPreview?.text ?? r.lastEntry?.text;
    return [
      {
        id: r.id,
        name: r.name.trim(),
        description: typeof r.description === 'string' ? r.description.slice(0, 4000) : '',
        avatar: {
          ...avatarIdentity(
            r.id,
            typeof r.avatarShape === 'string' ? r.avatarShape : '',
            typeof r.avatarColor === 'string' ? r.avatarColor : '',
          ),
          photoAvailable: !!r.avatarPhoto,
        },
        preview: typeof preview === 'string' ? preview.slice(0, 240) : '',
        updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : null,
        unread: r.hasUnread === true,
        available: names.get(r.name.trim().toLowerCase()) === 1,
      },
    ];
  });
  const account = hash(slot);
  return {
    version: 1,
    account,
    revision: hash(
      JSON.stringify([
        account,
        bots.map(({ id, name }) => [id, name]).sort((a, b) => a[0].localeCompare(b[0])),
      ]),
    ),
    source: 'grok-bot-local-cache',
    updatedAt: roster.modifiedAt,
    stale: !running || now - roster.modifiedAt > 24 * 60 * 60 * 1000,
    bots,
  };
}
