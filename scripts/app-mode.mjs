/* [INPUT]: Unified App's private request file and the registered local development source.
 * [OUTPUT]: Resolve and check Finder/Homebrew development tools, then prepare/open/stop the existing Dev supervisor with a private JSON result.
 * [POS]: One-shot adapter for app_mode.rs; no new persistent manager or copied user data.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import {
  openDevelopment,
  stopBackgroundDevelopment,
  hasDevelopmentOwner,
  developmentSettingsUrl,
} from './dev-launcher.mjs';
import { readJson, requestRuntime } from './dev-host.mjs';
import { sourcePreference, selectSource } from './dev-sources.mjs';

export function developmentEnvironment(inherited = process.env) {
  const prefixes = [inherited.HOMEBREW_PREFIX, '/opt/homebrew', '/usr/local'].filter(Boolean);
  const env = { ...inherited };
  delete env.PALBOO_START_DISCONNECTED;
  env.PATH = [
    ...new Set(
      [
        dirname(process.execPath),
        ...(inherited.CARGO_HOME ? [join(inherited.CARGO_HOME, 'bin')] : []),
        ...(inherited.PATH || '').split(':'),
        ...(inherited.HOMEBREW_PREFIX
          ? [
              join(inherited.HOMEBREW_PREFIX, 'opt/rustup/bin'),
              join(inherited.HOMEBREW_PREFIX, 'opt/rust/bin'),
            ]
          : []),
        join(homedir(), '.cargo/bin'),
        ...prefixes.flatMap((prefix) => [
          join(prefix, 'bin'),
          join(prefix, 'opt/rustup/bin'),
          join(prefix, 'opt/rust/bin'),
        ]),
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
      ].filter(Boolean),
    ),
  ].join(':');
  return env;
}

export function checkDevelopmentTools(env) {
  for (const [file, label] of [
    ['npm', 'npm'],
    ['cargo', 'Cargo（Rust）'],
    ['rustc', 'Rust 编译器'],
  ]) {
    const result = spawnSync(file, ['--version'], { env, encoding: 'utf8', timeout: 10000 });
    if (result.error || result.status !== 0)
      throw new Error(`开发环境找不到可用的 ${label}，请检查安装与工具路径。`);
  }
}

export async function developmentAction(root, action, connection) {
  const env = developmentEnvironment();
  // The release backend uses this only for its own initial connection handoff.
  delete process.env.PALBOO_START_DISCONNECTED;
  if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name !== 'palboo')
    throw new Error('请选择 Palboo 源码目录。');
  // Finder has no login-shell PATH. Preserve the environment for the supervisor as well.
  process.env.PATH = env.PATH;
  if (action === 'prepare' || (action === 'open' && !hasDevelopmentOwner(root)))
    checkDevelopmentTools(env);
  if (action === 'prepare') {
    const deadline = Date.now() + 900000;
    const remembered = readJson(sourcePreference(root))?.path || root;
    const source = remembered === root ? root : selectSource(root, remembered).path;
    if (!existsSync(join(source, 'node_modules/vite/package.json')))
      throw new Error('缺少开发依赖，请在源码目录运行 npm ci。');
    for (const [file, args] of [
      ['npm', ['run', 'build:web']],
      ['cargo', ['build', '--locked']],
    ]) {
      await new Promise((done, fail) => {
        const child = spawn(file, args, {
          detached: true,
          cwd: source,
          env,
          stdio: ['ignore', 'inherit', 'inherit'],
        });
        const stop = () => {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {}
          process.exitCode = 1;
        };
        process.once('SIGTERM', stop);
        const timer = setTimeout(
          () => {
            try {
              process.kill(-child.pid, 'SIGTERM');
            } catch {}
            fail(new Error('开发源码构建超时；当前模式保持不变。'));
          },
          Math.max(1, deadline - Date.now()),
        );
        child.once('error', (error) => {
          clearTimeout(timer);
          process.removeListener('SIGTERM', stop);
          fail(error);
        });
        child.once('exit', () => {
          clearTimeout(timer);
          process.removeListener('SIGTERM', stop);
        });
        child.once('exit', (code) =>
          code === 0 ? done() : fail(new Error('开发源码构建失败；当前模式保持不变。')),
        );
      });
    }
    return { ready: true };
  }
  if (action === 'stop') {
    await stopBackgroundDevelopment(root);
    return { stopped: true };
  }
  if (action === 'status') {
    if (!hasDevelopmentOwner(root)) throw new Error('开发会话未运行');
    const session = readJson(join(root, 'target/dev/session.json'));
    const runtime = readJson(join(session.runtime, 'runtime.json'));
    const state = await requestRuntime(runtime, 'development');
    if (!state.development || state.roots !== 1) throw new Error('开发会话尚未就绪');
    return { ready: true };
  }
  if (action !== 'open') throw new Error('未知模式操作');
  const revealed = await openDevelopment(root, { connection, cleanupOnFailure: true });
  return { url: developmentSettingsUrl(root), pid: revealed.pid, paused: revealed.paused };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = process.argv[2];
  try {
    const input = JSON.parse(readFileSync(file, 'utf8'));
    const result = await developmentAction(
      resolve(import.meta.dirname, '..'),
      input.action,
      input.connection,
    );
    writeFileSync(`${file}.result`, JSON.stringify(result), { mode: 0o600 });
  } catch (error) {
    writeFileSync(`${file}.result`, JSON.stringify({ error: error.message }), { mode: 0o600 });
    process.exitCode = 1;
  }
}
