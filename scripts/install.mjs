/*
 * [INPUT]: macOS arm64, release source and explicit App/CLI/data destinations.
 * [OUTPUT]: Complete signed Palboo.app, compatible CLI, atomic mode binding and recoverable upgrade.
 * [POS]: Local installer; prepares first and holds the App mode lock through replacement/rollback.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import './brand.mjs';
import { spawnSync, spawn } from 'node:child_process';
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
  mkdtempSync,
  cpSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, delimiter } from 'node:path';
import { createInterface } from 'node:readline';
import { buildApplication } from './package-app.mjs';
import { copyProjectLicenses } from './project-licenses.mjs';
import { generateNotices } from './third-party-notices.mjs';
import { prepareTestBinary } from './verify.mjs';

const root = resolve(import.meta.dirname, '..'),
  args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error(`${name} 缺少参数`);
  return args[index + 1];
}
function run(program, argv, options = {}) {
  const value = spawnSync(program, argv, { cwd: root, encoding: 'utf8', ...options });
  if (value.error) throw value.error;
  if (value.status !== 0)
    throw Error(value.stderr?.trim() || `${program} 执行失败 (${value.status})`);
  return value.stdout;
}
if (
  process.platform !== 'darwin' ||
  process.arch !== 'arm64' ||
  Number(run('sw_vers', ['-productVersion']).split('.')[0]) < 14
)
  throw Error('当前安装入口只支持 macOS 14.0+ Apple Silicon。');
const defaultData = join(homedir(), 'Library/Application Support/palboo');
const dataDir = resolve(option('--data-dir', process.env.PALBOO_HOME || defaultData));
const binDir = resolve(option('--bin-dir', join(homedir(), '.local/bin')));
const appDir = resolve(option('--app-dir', '/Applications'));
const source = join(root, 'target/release/palboo'),
  destination = join(binDir, 'palboo');
const launcher = join(appDir, 'Palboo.app'),
  bundled = join(launcher, 'Contents/MacOS/palboo');
const legacyBinaries = ['codex-buddy', 'codex-companion'].map((name) => join(binDir, name));
const independent =
  dataDir === defaultData
    ? ['codex-buddy', 'codex-companion']
        .map((name) => join(homedir(), 'Library/Application Support', name))
        .filter(
          (path) =>
            existsSync(path) &&
            (!existsSync(dataDir) || realpathSync(path) !== realpathSync(dataDir)),
        )
    : [];
if (independent.length > 1 || (existsSync(dataDir) && independent.length))
  throw Error('发现多份独立应用数据，未停止服务、合并或覆盖；请先明确要使用的数据目录。');
if (!args.includes('--skip-build')) prepareTestBinary('release');
if (!existsSync(source) || !run(source, ['--version']).startsWith('palboo '))
  throw Error('未找到有效 release 产物，请先构建。');
const ownedCliLink =
  existsSync(destination) &&
  lstatSync(destination).isSymbolicLink() &&
  existsSync(bundled) &&
  realpathSync(destination) === realpathSync(bundled);
if (
  existsSync(destination) &&
  !ownedCliLink &&
  (lstatSync(destination).isSymbolicLink() ||
    !run(destination, ['--version']).startsWith('palboo '))
)
  throw Error('CLI 安装位置已有其他程序或符号链接，未覆盖。');

if (
  existsSync(launcher) &&
  run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleIdentifier',
    join(launcher, 'Contents/Info.plist'),
  ]).trim() !== 'local.palboo.launcher'
)
  throw Error('目标位置已有其他应用，未覆盖。');
mkdirSync(appDir, { recursive: true });
const staging = mkdtempSync(join(appDir, '.palboo-install-')),
  next = join(staging, 'Palboo.app'),
  old = join(staging, 'previous.app');
const resources = join(staging, 'resources');
mkdirSync(resources);
let guard,
  lines,
  runtime,
  originalData = independent[0] || dataDir,
  stopped = false,
  replaced = false,
  cliReplaced = false,
  keepStaging = false;
const hadCli = existsSync(destination),
  oldCli = join(staging, 'previous-cli');
const responses = [];
let pending;
async function reply() {
  if (responses.length) return responses.shift();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
  });
}
async function inspectRuntime(path) {
  const file = join(path, 'runtime.json');
  if (!existsSync(file)) return null;
  let record;
  try {
    record = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw Error('后台运行记录损坏，未覆盖安装。');
  }
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0)
    throw Error('后台进程身份无效，未覆盖安装。');
  try {
    const res = await fetch(`http://127.0.0.1:${record.port}/api/state`, {
      headers: { Authorization: `Bearer ${record.token}` },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw Error();
    return { ...record, state: await res.json() };
  } catch {
    try {
      process.kill(record.pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return null;
    }
    throw Error('后台仍在运行但无法确认状态，请正常停止 Palboo 后再安装。');
  }
}
function start(executable, dir, previous) {
  const env = { ...process.env };
  delete env.PALBOO_START_DISCONNECTED;
  if (previous.state.connection.status === 'disconnected') env.PALBOO_START_DISCONNECTED = '1';
  run(executable, ['--data-dir', dir, 'start', '--port', String(previous.port), '--no-open'], {
    env,
    stdio: 'inherit',
  });
}
try {
  copyProjectLicenses(root, resources);
  generateNotices(resources);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  buildApplication({
    binary: source,
    version,
    resources,
    destination: next,
    sourceFingerprint: 'local-install',
  });
  guard = spawn(
    source,
    [
      '--data-dir',
      staging,
      'app-mode',
      'install-guard',
      '--executable',
      bundled,
      '--data',
      dataDir,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  guard.stdin.on('error', () => {});
  let guardError = '';
  guard.stderr.on('data', (bytes) => (guardError += bytes));
  lines = createInterface({ input: guard.stdout });
  lines.on('line', (line) => {
    if (pending) {
      pending.resolve(line);
      pending = null;
    } else responses.push(line);
  });
  guard.on('error', (error) => pending?.reject(error));
  guard.on('exit', () => pending?.reject(Error(guardError || '安装协调进程已退出')));
  if ((await reply()) !== 'ready') throw Error('无法取得安装锁');
  // Fresh read under the same lock used by launch and mode switching.
  runtime = await inspectRuntime(originalData);
  if (runtime) {
    if (![destination, bundled, ...legacyBinaries].includes(resolve(runtime.executable)))
      throw Error('此数据目录由其他安装运行，请先正常停止对应 Palboo。');
    if (runtime.state.connection.status === 'disconnected') {
      let prefs = {};
      try {
        prefs = JSON.parse(
          readFileSync(
            join(
              process.env.PALBOO_LAUNCHER_HOME ||
                join(homedir(), 'Library/Application Support/palboo-launcher'),
              'app-mode.json',
            ),
            'utf8',
          ),
        );
      } catch {}
      for (const controller of new Set([root, prefs.source].filter(Boolean))) {
        try {
          const owner = JSON.parse(readFileSync(join(controller, 'target/dev/owner.json'), 'utf8'));
          const paused = JSON.parse(
            readFileSync(join(controller, 'target/dev/paused-installation.json'), 'utf8'),
          );
          if (paused.runtime?.pid !== runtime.pid) continue;
          try {
            process.kill(owner.pid, 0);
          } catch (error) {
            if (error.code === 'ESRCH') continue;
            throw error;
          }
          throw Error('安装版正被开发模式接管，请正常退出开发模式后再更新 App；配置和数据保留。');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (spawnSync(runtime.executable, ['app-mode', '--help'], { stdio: 'ignore' }).status !== 0)
        throw Error('旧版当前处于断开状态，请正常停止 Palboo 后再安装；配置和数据保留。');
    }
    if (!/^(palboo|codex-buddy|codex-companion) /.test(run(runtime.executable, ['--version'])))
      throw Error('旧程序身份不匹配。');
    run(runtime.executable, ['--data-dir', originalData, 'stop'], { stdio: 'inherit' });
    stopped = true;
    if (await inspectRuntime(originalData)) throw Error('旧后台尚未退出，未替换应用。');
  }
  // Only independent old directories enter migration. Compatible aliases are left alone.
  if (dataDir === defaultData) {
    const env = { ...process.env };
    delete env.PALBOO_HOME;
    delete env.CODEX_BUDDY_HOME;
    run(source, ['config', 'schema'], { env });
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(binDir, { recursive: true });
  if (hadCli) copyFileSync(destination, oldCli);
  if (existsSync(launcher)) renameSync(launcher, old);
  try {
    renameSync(next, launcher);
    replaced = true;
  } catch (error) {
    if (existsSync(old)) renameSync(old, launcher);
    throw error;
  }
  if (!ownedCliLink) {
    const cliStage = join(binDir, `palboo.${process.pid}.new`);
    copyFileSync(source, cliStage);
    chmodSync(cliStage, 0o755);
    renameSync(cliStage, destination);
    cliReplaced = true;
  }
  if (runtime) {
    start(bundled, dataDir, runtime);
    const fresh = await inspectRuntime(dataDir);
    if (!fresh || fresh.pid === runtime.pid || resolve(fresh.executable) !== resolve(bundled))
      throw Error('更新后后台身份回读失败。');
  }
  guard.stdin.write('commit\n');
  if ((await reply()) !== 'committed') throw Error('运行模式登记失败');
  if (hadCli) copyFileSync(oldCli, join(dataDir, 'previous-installed'));
} catch (error) {
  try {
    if (replaced) {
      const running = await inspectRuntime(dataDir);
      if (running) {
        if (resolve(running.executable) !== resolve(bundled)) throw Error('后台身份已变化');
        run(bundled, ['--data-dir', dataDir, 'stop']);
        if (await inspectRuntime(dataDir)) throw Error('新后台尚未退出');
      }
      rmSync(launcher, { recursive: true, force: true });
      if (existsSync(old)) renameSync(old, launcher);
    }
    if (cliReplaced) {
      if (hadCli) copyFileSync(oldCli, destination);
      else rmSync(destination, { force: true });
    }
    if (stopped && runtime) {
      const restoreDir = existsSync(join(dataDir, 'config.json')) ? dataDir : originalData;
      start(runtime.executable, restoreDir, runtime);
      const restored = await inspectRuntime(restoreDir);
      if (!restored || restored.pid === runtime.pid) throw Error('旧后台未恢复');
    }
  } catch (rollback) {
    keepStaging = true;
    throw Error(`${error.message}；回滚未完成：${rollback.message}。恢复文件保留于 ${staging}`);
  }
  throw error;
} finally {
  guard?.stdin.end('quit\n');
  lines?.close();
  if (existsSync(old)) {
    try {
      const archive = join(dataDir, 'installation-backups', `Palboo-${Date.now()}.app`);
      mkdirSync(join(dataDir, 'installation-backups'), { recursive: true, mode: 0o700 });
      cpSync(old, archive, { recursive: true, preserveTimestamps: true });
      run('/usr/bin/codesign', ['--verify', '--strict', archive]);
      rmSync(old, { recursive: true });
    } catch {
      keepStaging = true;
      console.warn(`旧 App 保留于 ${old}`);
    }
  }
  if (!keepStaging) rmSync(staging, { recursive: true, force: true });
}
const recovery = join(dataDir, 'legacy-installation');
for (const legacy of legacyBinaries) {
  if (!existsSync(legacy) || lstatSync(legacy).isSymbolicLink()) continue;
  if (!/^(codex-buddy|codex-companion) /.test(run(legacy, ['--version']))) continue;
  mkdirSync(recovery, { recursive: true, mode: 0o700 });
  renameSync(legacy, join(recovery, `${legacy.split('/').at(-1)}-${Date.now()}`));
  symlinkSync(destination, legacy);
}
console.log(`已安装完整 App：${launcher}\n数据目录：${dataDir}\n源码 CLI：${destination}`);
if (!(process.env.PATH || '').split(delimiter).some((path) => resolve(path) === binDir))
  console.log(`CLI 目录尚未加入 PATH，可使用完整路径：${destination}`);
