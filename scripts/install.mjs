/*
 * [INPUT]: macOS arm64 环境、源码构建或 release 程序与指定安装目录。
 * [OUTPUT]: 本地 CLI 与双击启动器安装、旧程序保留和服务恢复。
 * [POS]: 源码安装入口，不修改 shell PATH。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import './brand.mjs';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  chmodSync,
  readFileSync,
  lstatSync,
  realpathSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, delimiter } from 'node:path';
import { installLauncher } from './launcher.mjs';

const root = resolve(import.meta.dirname, '..');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('当前安装入口只支持 macOS 14.0+ Apple Silicon；其他平台尚未适配。');
const osVersion = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
if (osVersion.status !== 0 || !(Number(osVersion.stdout.trim().split('.')[0]) >= 14))
  throw new Error('需要 macOS 14.0 或更新版本。');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} 缺少参数`);
  return args[index + 1];
}
const defaultData = join(homedir(), 'Library/Application Support/palboo');
const dataDir = resolve(option('--data-dir', process.env.PALBOO_HOME || defaultData));
const binDir = resolve(option('--bin-dir', join(homedir(), '.local/bin')));
const appDir = resolve(option('--app-dir', '/Applications'));
const file = 'palboo';
const source = join(root, 'target/release', file);
const destination = join(binDir, file);
const previous = join(dataDir, 'previous-installed');
const staged = join(binDir, `${file}.${process.pid}.new`);
function run(program, command, options = {}) {
  const result = spawnSync(program, command, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr?.trim() || `${program} 执行失败 (${result.status})`);
  return result.stdout;
}
if (!args.includes('--skip-build')) run('npm', ['run', 'build'], { stdio: 'inherit' });
if (!existsSync(source)) throw new Error('未找到 release 产物，请先运行 npm run build');
if (!run(source, ['--version']).startsWith('palboo ')) throw new Error('构建产物身份不匹配');
if (existsSync(destination)) {
  if (lstatSync(destination).isSymbolicLink())
    throw new Error(`目标是符号链接，请先确认安装位置：${destination}`);
  if (!run(destination, ['--version']).startsWith('palboo '))
    throw new Error('安装位置已有其他程序，未覆盖');
}
// Stop a recognized old installation before the Rust migration acquires its lock.
const legacyDirectories = ['codex-buddy', 'codex-companion'].map((name) =>
  join(homedir(), 'Library/Application Support', name),
);
const legacyBinaries = ['codex-buddy', 'codex-companion'].map((name) => join(binDir, name));
let legacyRuntime;
if (dataDir === defaultData) {
  const independent = legacyDirectories.filter(
    (path) =>
      existsSync(path) && (!existsSync(dataDir) || realpathSync(path) !== realpathSync(dataDir)),
  );
  if (independent.length > 1 || (existsSync(dataDir) && independent.length))
    throw new Error('发现多份独立应用数据，未停止服务、合并或覆盖；请先明确要使用的数据目录。');
  for (const legacyData of legacyDirectories) {
    if (!existsSync(legacyData)) continue;
    let candidate;
    try {
      candidate = JSON.parse(readFileSync(join(legacyData, 'runtime.json'), 'utf8'));
      const response = await fetch(`http://127.0.0.1:${candidate.port}/api/state`, {
        headers: { Authorization: `Bearer ${candidate.token}` },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) continue;
    } catch {
      continue;
    }
    if (![destination, ...legacyBinaries].includes(resolve(candidate.executable)))
      throw new Error('旧数据目录正由其他安装运行，请先正常停止对应辅助程序。');
    const identity = run(candidate.executable, ['--version']);
    if (!/^(palboo|codex-buddy|codex-companion) /.test(identity))
      throw new Error('旧程序身份不匹配，未停止或迁移。');
    run(candidate.executable, ['--data-dir', legacyData, 'stop'], { stdio: 'inherit' });
    legacyRuntime = candidate;
  }
  const migrationEnv = { ...process.env };
  delete migrationEnv.PALBOO_HOME;
  delete migrationEnv.CODEX_BUDDY_HOME;
  // schema is local and needs no service; Paths performs the atomic migration.
  run(source, ['config', 'schema'], { env: migrationEnv });
}
mkdirSync(binDir, { recursive: true });
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
let runtime = legacyRuntime;
try {
  const candidate = JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${candidate.port}/api/state`, {
    headers: { Authorization: `Bearer ${candidate.token}` },
    signal: AbortSignal.timeout(2000),
  });
  if (response.ok) runtime = candidate;
} catch {
  /* No active installation to restart. */
}
if (runtime && ![destination, ...legacyBinaries].includes(resolve(runtime.executable)))
  throw new Error(
    '此数据目录正由另一安装路径运行。若从旧名称版本迁移，请先运行 palboo stop，再重新安装；无需退出 Codex。其他安装路径请先停止对应辅助工具。',
  );
const hadDestination = existsSync(destination);
const restoreExecutable = hadDestination ? destination : legacyRuntime?.executable;
if (restoreExecutable) copyFileSync(restoreExecutable, previous);
copyFileSync(source, staged);
chmodSync(staged, 0o755);
let moved = false;
try {
  if (runtime && !legacyRuntime)
    run(runtime.executable, ['--data-dir', dataDir, 'stop'], { stdio: 'inherit' });
  renameSync(staged, destination);
  moved = true;
  if (runtime)
    run(
      destination,
      ['--data-dir', dataDir, 'start', '--port', String(runtime.port), '--no-open'],
      { stdio: 'inherit' },
    );
} catch (error) {
  if (moved && hadDestination && existsSync(previous)) {
    copyFileSync(previous, staged);
    chmodSync(staged, 0o755);
    renameSync(staged, destination);
  }
  if (moved && !hadDestination) rmSync(destination, { force: true });
  if (runtime && restoreExecutable && existsSync(restoreExecutable))
    spawnSync(restoreExecutable, [
      '--data-dir',
      dataDir,
      'start',
      '--port',
      String(runtime.port),
      '--no-open',
    ]);
  throw error;
} finally {
  rmSync(staged, { force: true });
}
console.log(`已安装 ${destination}`);
console.log(`数据目录：${dataDir}`);
const launcher = join(appDir, 'PALBOO.app');
installLauncher({ binary: destination, dataDir, destination: launcher });
// Keep command aliases for old scripts, but only after the new launcher succeeds.
const recovery = join(dataDir, 'legacy-installation');
for (const legacy of legacyBinaries) {
  if (!existsSync(legacy) || lstatSync(legacy).isSymbolicLink()) continue;
  if (!/^(codex-buddy|codex-companion) /.test(run(legacy, ['--version']))) continue;
  mkdirSync(recovery, { recursive: true, mode: 0o700 });
  const saved = join(recovery, `${legacy.split('/').at(-1)}-${Date.now()}`);
  renameSync(legacy, saved);
  symlinkSync(destination, legacy);
}
const oldLauncher = join(appDir, 'CodexBuddy.app');
if (existsSync(oldLauncher)) {
  const identity = spawnSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIdentifier', join(oldLauncher, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  );
  if (identity.status === 0 && identity.stdout.trim() === 'local.codex-buddy.launcher') {
    mkdirSync(recovery, { recursive: true, mode: 0o700 });
    renameSync(oldLauncher, join(recovery, `CodexBuddy-${Date.now()}.app`));
  }
}
console.log(`双击启动：${launcher}（可拖入 Dock）`);
if (!(process.env.PATH || '').split(delimiter).some((path) => resolve(path) === binDir))
  console.log(`该目录尚未加入 PATH，可直接用完整路径运行，或自行将 ${binDir} 加入 PATH。`);
console.log(
  '以后直接打开 PALBOO.app，它会启动或连接 ChatGPT 并打开浮窗。已有普通 ChatGPT 实例时，会提示等待任务结束后退出再打开；不会自动结束对话或多开实例。',
);
