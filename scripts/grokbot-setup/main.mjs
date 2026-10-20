/* [INPUT]: Embedded adapter, Node/npm, official BDK login and scoped Codex registration.
 * [OUTPUT]: Per-user BDK installation, owned LaunchAgent/MCP/Skill and resumable status.
 * [POS]: Optional PALBOO onboarding; all conversations stay in the Codex composer.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync. */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  renameSync,
  openSync,
  closeSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
const url = 'http://127.0.0.1:3417';
const label = 'com.palboo.grokbot-bdk';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const present = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};
export function locations(
  home = homedir(),
  codexHome = process.env.CODEX_HOME || join(home, '.codex'),
) {
  const root = join(home, 'Library/Application Support/palboo/grokbot');
  return {
    root,
    project: join(root, 'project'),
    manifest: join(root, 'installation.json'),
    plist: join(home, 'Library/LaunchAgents', `${label}.plist`),
    skill: join(home, '.agents/skills/grokbot-bdk'),
    legacySkill: join(codexHome, 'skills/grokbot-bdk'),
    codexHome,
  };
}
export function launchAgent(
  project,
  state,
  log,
  node = process.execPath,
  bdk = join(project, 'node_modules/@cursor/bdk/dist/bin/agent-serve.js'),
) {
  const xml = (s) =>
    s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  const args = [
    node,
    bdk,
    'serve',
    '--mode',
    'single',
    '--dev',
    '--host',
    '127.0.0.1',
    '--port',
    '3417',
    '--state-root',
    state,
    '--no-docs',
    '--no-playground',
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((v) => `<string>${xml(v)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(project)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(`${dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>${Object.entries(
    bdkEnvironment({ root: dirname(project) }),
  )
    .map(([key, val]) => `<key>${key}</key><string>${xml(val)}</string>`)
    .join(
      '',
    )}</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(join(log, 'stdout.log'))}</string><key>StandardErrorPath</key><string>${xml(join(log, 'stderr.log'))}</string></dict></plist>\n`;
}
function command(file, args, { cwd, capture = false, optional = false, env = {} } = {}) {
  const result = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH || ''}`, ...env },
  });
  if (!optional && (result.error || result.status !== 0))
    throw new Error(`${file} ${args[0]} 未完成，请处理上面的提示后重试`);
  return result;
}
function codexBinary() {
  for (const file of [
    process.env.PALBOO_CODEX,
    'codex',
    '/Applications/Codex.app/Contents/Resources/codex',
  ].filter(Boolean)) {
    if (command(file, ['--version'], { capture: true, optional: true }).status === 0) return file;
  }
  throw new Error('未找到 Codex CLI；请安装 Codex CLI，或用 PALBOO_CODEX 指定可执行文件');
}
function registrations() {
  const response = command(codexBinary(), ['mcp', 'list', '--json'], { capture: true });
  return JSON.parse(response.stdout);
}
function save(paths, state) {
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  const temporary = `${paths.manifest}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, paths.manifest);
}
function load(paths) {
  if (!existsSync(paths.manifest)) return null;
  const state = JSON.parse(readFileSync(paths.manifest, 'utf8'));
  if (state.owner !== label || state.version !== 1)
    throw new Error('安装记录不属于 PALBOO，保留原目录');
  return state;
}
export function checkSkillConflict(paths, state) {
  for (const p of [paths.skill, paths.legacySkill]) {
    if (!present(p)) continue;
    if (
      p === paths.skill &&
      state?.skillOwned &&
      lstatSync(p).isSymbolicLink() &&
      realpathSync(p) === realpathSync(join(paths.project, 'skills/grokbot-bdk'))
    )
      continue;
    throw new Error('已有 grokbot-bdk Skill，保留原文件；请先处理已有接入，再重试');
  }
}
async function portFree() {
  const server = createServer();
  await new Promise((ok, fail) => {
    server.once('error', () =>
      fail(new Error('3417 端口已被占用；保留已有服务，请先检查原 Grok Bot 接入')),
    );
    server.listen(3417, '127.0.0.1', ok);
  });
  await new Promise((ok) => server.close(ok));
}
async function catalog(installationId) {
  const response = await fetch(`${url}/v1/tools/grokbot__list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"input":{}}',
    signal: AbortSignal.timeout(3000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('本地 BDK 服务不可用');
  const body = await response.json();
  if (body.isError || body.result?.catalog?.version !== 1)
    throw new Error('BDK 账号或名单校验未通过');
  if (installationId && body.result.catalog.installationId !== installationId)
    throw new Error('端口上的服务不属于本次 PALBOO 安装，停止连接');
  return body.result.catalog;
}
const domain = () => `gui/${process.getuid()}`;
function serviceLoaded() {
  return (
    command('launchctl', ['print', `${domain()}/${label}`], { capture: true, optional: true })
      .status === 0
  );
}
export function bdkEnvironment(paths) {
  return {
    AGENT_SERVE_CONFIG_DIR: join(paths.root, 'auth'),
    AGENT_SERVE_NO_UPDATE_CHECK: '1',
    CURSOR_API_KEY: '',
    CURSOR_API_KEY_FILE: '/dev/null',
    CURSOR_SERVICE_ACCOUNT_KEY: '',
    CURSOR_SERVICE_ACCOUNT_KEY_FILE: '',
  };
}
function bdk(paths, args, options = {}) {
  return command(
    process.execPath,
    [join(paths.project, 'node_modules/@cursor/bdk/dist/bin/agent-serve.js'), ...args],
    { cwd: paths.project, env: bdkEnvironment(paths), ...options },
  );
}
function ownedPlist(paths, state) {
  if (
    !existsSync(paths.plist) ||
    ![state?.plistHash, state?.pendingPlistHash]
      .filter(Boolean)
      .includes(hash(readFileSync(paths.plist)))
  )
    throw new Error('服务配置不属于本次安装或已被修改，保留现有服务');
}
async function start(paths, state) {
  ownedPlist(paths, state);
  if (!serviceLoaded()) {
    await portFree();
    command('launchctl', ['bootstrap', domain(), paths.plist]);
  }
  for (let i = 0; i < 30; i++) {
    try {
      const current = await catalog(state.id);
      if (current.stale) throw new Error('请打开 Grok Bot 并等待名单同步');
      return current;
    } catch (e) {
      if (i === 29) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
async function stop(paths, state) {
  ownedPlist(paths, state);
  if (!serviceLoaded()) return;
  command('launchctl', ['bootout', `${domain()}/${label}`]);
  for (let i = 0; i < 30 && serviceLoaded(); i++) await new Promise((r) => setTimeout(r, 100));
  if (serviceLoaded()) throw new Error('BDK 服务尚未退出，保留现有配置');
}
async function confirmAccount(confirmed) {
  if (confirmed) return;
  if (!process.stdin.isTTY)
    throw new Error('请核对 BDK 与 Grok Bot 为同一账号，再运行 grokbot connect --confirm-account');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (
      (await prompt.question('请在 Grok Bot 应用核对账号。与上方 BDK 账号相同请输入 yes：'))
        .trim()
        .toLowerCase() !== 'yes'
    )
      throw new Error('未确认账号，已保留安装，可稍后继续连接');
  } finally {
    prompt.close();
  }
}
async function connect(paths, state, confirmed) {
  if (!state) throw new Error('请先运行 grokbot setup');
  checkSkillConflict(paths, state);
  const registered = registrations().find((v) => v.name === 'grokbot');
  if (registered && !state.mcpOwned && !state.mcpPending)
    throw new Error('已有 grokbot MCP，保留原配置');
  if (registered && registered.transport?.url !== `${url}/v1/mcp`)
    throw new Error('grokbot MCP 地址已被修改，保留现有配置');
  bdk(paths, ['whoami']);
  await confirmAccount(confirmed);
  // Reuse a healthy owned process; never interrupt it merely to repair registration.
  let current;
  if (serviceLoaded()) {
    ownedPlist(paths, state);
    current = await catalog(state.id);
    if (current.stale) throw new Error('请打开 Grok Bot 并等待同步');
  } else {
    await portFree();
    command(
      process.execPath,
      [resolve(import.meta.dirname, '../install-grokbot-adapter.mjs'), paths.project],
      {
        env: { ...bdkEnvironment(paths), PALBOO_GROKBOT_INSTALLATION_ID: state.id },
      },
    );
    try {
      bdk(paths, ['validate']);
    } catch (e) {
      state.dependencyHash = null;
      save(paths, state);
      throw e;
    }
    mkdirSync(dirname(paths.plist), { recursive: true });
    mkdirSync(join(paths.root, 'logs'), { recursive: true, mode: 0o700 });
    const plist = launchAgent(paths.project, join(paths.root, 'state'), join(paths.root, 'logs'));
    if (existsSync(paths.plist)) ownedPlist(paths, state);
    state.pendingPlistHash = hash(plist);
    save(paths, state);
    writeFileSync(`${paths.plist}.tmp`, plist, { mode: 0o600 });
    renameSync(`${paths.plist}.tmp`, paths.plist);
    state.plistHash = state.pendingPlistHash;
    state.pendingPlistHash = null;
    save(paths, state);
    current = await start(paths, state);
  }
  const skillTarget = join(paths.project, 'skills/grokbot-bdk');
  if (!present(paths.skill)) {
    state.skillOwned = true;
    save(paths, state);
    mkdirSync(dirname(paths.skill), { recursive: true });
    symlinkSync(skillTarget, paths.skill, 'dir');
  }
  // The Rust writer stamps the installation ID and accepts an exact owned retry only.
  // Persist intent first, so a crash after the config write can resume safely.
  state.mcpPending = true;
  save(paths, state);
  command(process.env.PALBOO_HOST_CLI, ['grokbot', 'register', '--installation-id', state.id]);
  state.mcpOwned = true;
  state.mcpPending = false;
  state.connected = true;
  save(paths, state);
  console.log(
    `PALBOO 已连接 ${current.bots.length} 个现有 Bot。请在 Codex 主聊天输入“请问「Bot名」：任务”。`,
  );
  console.log(
    '若当前聊天尚未显示 grokbot 工具或 Skill，请刷新 MCP/技能或新开聊天；无需重启正在工作的 Codex。',
  );
}
async function setup(paths, state) {
  checkSkillConflict(paths, state);
  if (registrations().some((v) => v.name === 'grokbot') && !state?.mcpOwned && !state?.mcpPending)
    throw new Error('已有 grokbot MCP，保留原接入；不会新建重复服务');
  if (!state) {
    await portFree();
    if (present(paths.root) || present(paths.plist) || serviceLoaded())
      throw new Error('目标目录或服务已存在且无 PALBOO 安装记录，保留它');
    state = {
      owner: label,
      version: 1,
      id: randomUUID(),
      codexHome: paths.codexHome,
      connected: false,
      mcpOwned: false,
      skillOwned: false,
    };
    save(paths, state);
  }
  mkdirSync(paths.project, { recursive: true, mode: 0o700 });
  for (const file of ['package.json', 'package-lock.json']) {
    if (!existsSync(join(paths.project, file)))
      writeFileSync(
        join(paths.project, file),
        readFileSync(join(import.meta.dirname, 'project', file)),
      );
  }
  const pkg = JSON.parse(readFileSync(join(paths.project, 'package.json')));
  if (pkg.dependencies?.['@cursor/bdk'] !== '0.2.27') throw new Error('BDK 版本已改变，停止覆盖');
  const dependencyHash = hash(readFileSync(join(paths.project, 'package-lock.json')));
  const validVersion = () => {
    try {
      return (
        JSON.parse(readFileSync(join(paths.project, 'node_modules/@cursor/bdk/package.json')))
          .version === '0.2.27' &&
        bdk(paths, ['version'], { capture: true, optional: true }).status === 0
      );
    } catch {
      return false;
    }
  };
  if (state.dependencyHash !== dependencyHash || !validVersion()) {
    if (serviceLoaded()) throw new Error('依赖需要修复，请先 grokbot stop 后重试');
    command('npm', ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: paths.project,
    });
    if (!validVersion()) throw new Error('BDK 依赖未完整安装，请重试 setup');
    state.dependencyHash = dependencyHash;
    save(paths, state);
  }
  mkdirSync(join(paths.project, 'bot'), { recursive: true });
  if (!existsSync(join(paths.project, 'bot/agent.ts')))
    writeFileSync(
      join(paths.project, 'bot/agent.ts'),
      'import { defineAgent } from "@cursor/bdk";\nexport default defineAgent({ tools: [] });\n',
    );
  if (!existsSync(join(paths.project, 'bot/instructions.md')))
    writeFileSync(
      join(paths.project, 'bot/instructions.md'),
      'Consult existing Grok Bot agents only. Use the dynamic catalog before calling. Never create a Bot.\n',
    );
  if (bdk(paths, ['whoami'], { capture: true, optional: true }).status !== 0) {
    console.log('即将打开 BDK 官方登录页，请登录与 Grok Bot 应用相同的账号。');
    bdk(paths, ['login', '--key-name', 'PALBOO Grok Bot']);
  }
  await connect(paths, state, false);
}
async function operate(action, confirmed = false, paths = locations()) {
  if (process.platform !== 'darwin') throw new Error('当前接入支持 macOS');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw new Error('需要 Node.js 22.16 或更新版本');
  const state = load(paths);
  if (state && state.codexHome !== paths.codexHome)
    throw new Error('CODEX_HOME 与安装时不同，保留两边的配置；请在原 Codex 配置环境运行');
  if (action === 'status') {
    let current, error;
    try {
      current = await catalog(state?.id);
    } catch (e) {
      error = e.message;
    }
    let mcp;
    try {
      mcp = registrations().find((v) => v.name === 'grokbot');
    } catch (e) {
      error = e.message;
    }
    console.log(
      JSON.stringify(
        {
          managed: !!state,
          bdkInstalled: existsSync(join(paths.project, 'node_modules/@cursor/bdk/package.json')),
          serviceLoaded: serviceLoaded(),
          mcpRegistered: !!mcp,
          mcpMatches: mcp?.transport?.url === `${url}/v1/mcp`,
          skillRegistered: present(paths.skill) || present(paths.legacySkill),
          botCount: current?.bots?.length,
          stale: current?.stale,
          error,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === 'setup') return setup(paths, state);
  if (!state) throw new Error('没有 PALBOO 管理的接入；原有服务和配置保持不变');
  if (action === 'login') {
    if (serviceLoaded()) throw new Error('请先 grokbot stop，再更换 BDK 登录');
    return bdk(paths, ['login', '--key-name', 'PALBOO Grok Bot']);
  }
  if (action === 'connect') return connect(paths, state, confirmed);
  if (action === 'start') {
    await start(paths, state);
    console.log('PALBOO BDK 服务已就绪');
    return;
  }
  if (action === 'stop') {
    await stop(paths, state);
    console.log('本地接入已停止；云端 Bot 任务未中断');
    return;
  }
  if (action !== 'uninstall') throw new Error('未知接入命令');
  // Check all ownership before changing any registration.
  if (existsSync(paths.plist)) ownedPlist(paths, state);
  checkSkillConflict(paths, state);
  if (state.mcpOwned || state.mcpPending) {
    command(process.env.PALBOO_HOST_CLI, ['grokbot', 'unregister', '--installation-id', state.id]);
    state.mcpOwned = false;
    state.mcpPending = false;
    save(paths, state);
  }
  if (existsSync(paths.plist)) {
    await stop(paths, state);
    unlinkSync(paths.plist);
  }
  if (state.skillOwned && present(paths.skill)) unlinkSync(paths.skill);
  state.skillOwned = false;
  state.plistHash = null;
  state.pendingPlistHash = null;
  state.connected = false;
  save(paths, state);
  console.log(
    '已移除 PALBOO 的 MCP、Skill 链接和后台服务。BDK 工程、状态和官方登录保留，可重新 setup。',
  );
}
export async function main(action, confirmed = false, paths = locations()) {
  if (action === 'status') return operate(action, confirmed, paths);
  mkdirSync(dirname(paths.root), { recursive: true, mode: 0o700 });
  const lock = `${paths.root}.lock`;
  if (existsSync(lock)) {
    const previous = readFileSync(lock, 'utf8');
    const pid = JSON.parse(previous).pid;
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('安装锁格式异常，停止操作');
    try {
      process.kill(pid, 0);
      throw new Error('另一个 PALBOO 接入操作正在运行');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
    if (readFileSync(lock, 'utf8') !== previous) throw new Error('安装锁已变化，请重试');
    unlinkSync(lock);
  }
  const fd = openSync(lock, 'wx', 0o600);
  const identity = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  writeFileSync(fd, identity);
  closeSync(fd);
  try {
    return await operate(action, confirmed, paths);
  } finally {
    if (existsSync(lock) && readFileSync(lock, 'utf8') === identity) unlinkSync(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv[2], process.argv.includes('--confirm-account')).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
