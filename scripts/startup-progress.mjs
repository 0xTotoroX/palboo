/* [INPUT]: App 创建的私有短期事件文件及固定启动阶段。
 * [OUTPUT]: startupPhase；跨 Dev/Rust 启动链追加无正文、无凭据的计时事件。
 * [POS]: 启动反馈适配，失败不改变业务，启动器移除文件后停止记录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { openSync, closeSync, fstatSync, writeSync, constants } from 'node:fs';
import { isAbsolute } from 'node:path';

const phases = new Set([
  'preparing',
  'source',
  'development',
  'tools',
  'checking',
  'web',
  'build',
  'compatibility',
  'confirmation',
  'closing',
  'opening',
  'host',
  'renderer',
  'connecting',
  'workspace',
  'presenting',
]);
export function startupPhase(phase, file = process.env.PALBOO_STARTUP_PROGRESS) {
  if (!file || !isAbsolute(file) || !phases.has(phase)) return;
  let fd;
  try {
    fd = openSync(
      file,
      constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size >= 262144)
      return;
    writeSync(fd, JSON.stringify({ phase, atMs: Date.now() }) + '\n');
  } catch {
    // 反馈不可用时继续原启动流程，不创建或修复外部文件。
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
