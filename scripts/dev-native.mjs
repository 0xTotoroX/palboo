/* [INPUT]: Worktree sources, embedded assets, build environment and the existing Cargo runner.
 * [OUTPUT]: Content-verified reusable debug binary; failed or changing builds never become current.
 * [POS]: Shared native build gate for App preparation, Dev startup, reload and source switching.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync. */
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sourceBinaryName } from './brand.mjs';
import { startupPhase } from './startup-progress.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function files(root, directory) {
  if (!existsSync(join(root, directory))) return [];
  return readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.md') && entry.name !== '.DS_Store')
    .map((entry) => join(entry.parentPath, entry.name));
}

export function nativeSourceFingerprint(root) {
  const inputs = [
    ...['src', 'ui', '.cargo', 'target/web'].flatMap((directory) => files(root, directory)),
    ...[
      'build.rs',
      'Cargo.toml',
      'Cargo.lock',
      'rust-toolchain',
      'rust-toolchain.toml',
      'package.json',
      'package-lock.json',
      'scripts/build-panel.mjs',
    ].map((file) => join(root, file)),
  ];
  const digest = createHash('sha256');
  for (const file of [...new Set(inputs)].sort()) {
    digest.update(file.slice(root.length)).update('\0');
    digest.update(existsSync(file) ? hash(readFileSync(file)) : 'missing').update('\0');
  }
  return digest.digest('hex');
}

function buildIdentity(root, env) {
  const tools = ['cargo', 'rustc', 'node'].map((tool) => {
    const path = (env.PATH || '')
      .split(':')
      .map((dir) => resolve(root, dir, tool))
      .find((file) => existsSync(file));
    if (!path) throw new Error(`开发环境找不到 ${tool}`);
    return [
      realpathSync(path),
      execFileSync(path, ['--version'], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    ];
  });
  const options = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) =>
        /^(CARGO_|RUST|(?:HOST_|TARGET_)?(?:CC|CXX|AR|AS|RANLIB|CFLAGS|CXXFLAGS|CPPFLAGS|ARFLAGS|LDFLAGS|CXXSTDLIB)(?:_|$)|CRATE_CC_|SDKROOT$|MACOSX_DEPLOYMENT_TARGET$|NODE_OPTIONS$|NODE_PATH$)/.test(
          key,
        ),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const configs = new Set();
  for (let directory = root; ; directory = dirname(directory)) {
    for (const file of ['config', 'config.toml']) configs.add(join(directory, '.cargo', file));
    if (dirname(directory) === directory) break;
  }
  for (const file of ['config', 'config.toml'])
    configs.add(join(env.CARGO_HOME || join(homedir(), '.cargo'), file));
  return hash(
    JSON.stringify({
      root: realpathSync(root),
      tools,
      options,
      configs: [...configs]
        .sort()
        .map((file) => [file, existsSync(file) ? hash(readFileSync(file)) : null]),
    }),
  );
}

export async function prepareNativeBinary(root, build, env = process.env) {
  root = resolve(root);
  startupPhase('checking');
  const binary = join(root, 'target/debug', sourceBinaryName(root));
  const record = join(root, 'target/dev/native-build.json');
  const source = nativeSourceFingerprint(root);
  const identity = buildIdentity(root, env);
  let saved;
  try {
    saved = JSON.parse(readFileSync(record, 'utf8'));
  } catch {}
  if (
    saved?.schema === 1 &&
    saved.source === source &&
    saved.identity === identity &&
    existsSync(binary) &&
    saved.output === hash(readFileSync(binary))
  )
    return { binary, source, reused: true };

  // A failed compiler may have partially overwritten its output. Never retain an old success record.
  rmSync(record, { force: true });
  startupPhase('build');
  await build();
  if (source !== nativeSourceFingerprint(root) || identity !== buildIdentity(root, env))
    throw Object.assign(new Error('编译期间源码或开发环境发生变化，请重试'), {
      code: 'PALBOO_BUILD_INPUT_CHANGED',
    });
  if (!existsSync(binary)) throw new Error('开发构建未生成程序');
  const value = { schema: 1, source, identity, output: hash(readFileSync(binary)) };
  mkdirSync(dirname(record), { recursive: true, mode: 0o700 });
  const temporary = `${record}.${randomUUID()}`;
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
    renameSync(temporary, record);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { binary, source, reused: false };
}
