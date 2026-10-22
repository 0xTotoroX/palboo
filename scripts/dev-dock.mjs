/*
 * [INPUT]: 已安装的 Palboo Dev.app、当前用户 Dock 偏好与系统 Foundation。
 * [OUTPUT]: repairDevelopmentDock 原位替换旧 Dev 固定入口，清除旧书签并去重；修改前保存私有恢复副本。
 * [POS]: install:dev 的入口迁移；只替换已有 Dev 图标，不新增固定项或改变其他应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, chmodSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function repairDevelopmentDock({
  domain = 'com.apple.dock',
  backupDirectory = join(
    homedir(),
    'Documents/Codex-Archive/backups/palboo-dev-dock',
    new Date().toISOString().replaceAll(':', '-'),
  ),
  refresh = domain === 'com.apple.dock',
} = {}) {
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const backup = join(backupDirectory, 'persistent-apps.plist');
  const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-'], {
    encoding: 'utf8',
    input: `ObjC.import('Foundation');
const domain = ${JSON.stringify(domain)};
const backup = ${JSON.stringify(backup)};
const defaults = $.NSUserDefaults.alloc.initWithSuiteName(domain);
const current = defaults.persistentDomainForName(domain);
const apps = current.isNil() ? $() : current.objectForKey('persistent-apps');
let changed = 0;
if (!apps.isNil()) {
  const next = $.NSMutableArray.alloc.init;
  let found = false;
  for (let i = 0; i < apps.count; i++) {
    const entry = apps.objectAtIndex(i);
    const data = entry.objectForKey('tile-data');
    const id = data.isNil() ? $() : data.objectForKey('bundle-identifier');
    const owned = !id.isNil() && ['local.codex-buddy.dev-launcher', 'local.palboo.dev-launcher'].includes(ObjC.unwrap(id));
    if (!owned) { next.addObject(entry); continue; }
    if (found) { changed++; continue; }
    found = true;
    // 不携带 book/file-data 的旧文件身份，否则 Dock 会跟随被移入归档的 App。
    const replacement = $({
      'tile-type': 'file-tile',
      'tile-data': {
        'file-data': {'_CFURLString': 'file:///Applications/Palboo%20Dev.app/', '_CFURLStringType': 15},
        'file-label': 'Palboo Dev',
        'bundle-identifier': 'local.palboo.dev-launcher',
        'file-type': 41
      }
    });
    next.addObject(replacement);
    if (!entry.isEqualToDictionary(replacement)) changed++;
  }
  if (changed) {
    const bytes = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(apps, $.NSPropertyListXMLFormat_v1_0, 0, null);
    if (!$.NSFileManager.defaultManager.createFileAtPathContentsAttributes(backup, bytes, $({'NSFilePosixPermissions': 384}))) throw Error('无法保存 Dock 恢复副本');
    const latest = defaults.persistentDomainForName(domain).objectForKey('persistent-apps');
    if (!latest.isEqualToArray(apps)) throw Error('Dock 已被其他操作修改，请重试安装');
    defaults.setObjectForKey(next, 'persistent-apps');
    if (!defaults.synchronize) throw Error('Dock 偏好保存失败');
    if (!defaults.persistentDomainForName(domain).objectForKey('persistent-apps').isEqualToArray(next)) throw Error('Dock 偏好回读不一致');
  }
}
JSON.stringify({changed});`,
  });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr.trim() || 'Dev Dock 入口更新失败');
  const { changed } = JSON.parse(result.stdout);
  if (!changed) {
    try {
      rmdirSync(backupDirectory);
    } catch (error) {
      if (error.code !== 'ENOTEMPTY') throw error;
    }
    return { changed: 0 };
  }
  chmodSync(backup, 0o600);
  if (refresh) {
    // Dock 由 launchd 自动恢复；不退出业务应用或清空其余偏好。
    const refreshed = spawnSync('/usr/bin/killall', ['-u', String(process.getuid()), 'Dock'], {
      encoding: 'utf8',
    });
    if (refreshed.error || (refreshed.status !== 0 && refreshed.status !== 1))
      throw new Error(`Dock 入口已保存，刷新失败；恢复副本：${backup}`);
  }
  return { changed, backup };
}
