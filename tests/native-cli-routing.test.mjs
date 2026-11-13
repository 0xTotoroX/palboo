/* [INPUT]: 显式指定的 Palboo、隔离原生 App 和可观察的 CLI 夹具。
 * [OUTPUT]: 主服务/原生工具分流、交接环境缺失时的原生调用、进程语义及官方初始化回归。
 * [POS]: 启动边界集成验收；不读取聊天，不启动第二个真实 ChatGPT。
 * [PROTOCOL]: 变更时同步 tests/AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  realpathSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const enabled = process.platform === 'darwin' && process.env.PALBOO_TEST_CLI;
test(
  'private CLI preserves native tools and only routes the verified desktop main service',
  { skip: !enabled },
  async (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'palboo-native-cli-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const app = join(root, 'Synthetic.app'),
      bin = join(app, 'Contents/MacOS');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(app, 'Contents/Info.plist'),
      `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleIdentifier</key><string>local.palboo.native-cli.${Date.now()}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
    );
    const cliRoot = join(root, 'codex-host-native-cli'),
      cliDirectory = join(cliRoot, randomUUID());
    mkdirSync(cliRoot, { mode: 0o700 });
    mkdirSync(cliDirectory, { mode: 0o700 });
    const desktop = join(bin, 'Fixture'),
      proxy = join(cliDirectory, 'palboo'),
      context = join(cliDirectory, 'context.json');
    const source = join(root, 'fixture.swift');
    writeFileSync(
      source,
      `import Foundation
import Darwin
let env = ProcessInfo.processInfo.environment
let helper = CommandLine.arguments.contains("helper")
let proxy = env["CODEX_CLI_PATH"]!
func run(_ args: [String], _ origin: String? = nil) throws -> [String: Any] {
    let p = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
    p.executableURL = URL(fileURLWithPath: proxy)
    p.arguments = args
    var environment = env
    environment.removeValue(forKey: "CODEX_INTERNAL_ORIGINATOR_OVERRIDE")
    if let origin { environment["CODEX_INTERNAL_ORIGINATOR_OVERRIDE"] = origin }
    if args.contains("preserve-alias") { environment["CODEX_APP_RUNTIME_CLI_PATH"] = env["PALBOO_TEST_FOREIGN_ALIAS"] }
    if args.contains("--without-context") {
        environment.removeValue(forKey: "PALBOO_NATIVE_CLI_CONTEXT")
        p.arguments = args.filter { $0 != "--without-context" }
    }
    p.environment = environment
    p.standardInput = input; p.standardOutput = output; p.standardError = errors
    try p.run()
    input.fileHandleForWriting.write(Data([0, 255, 10, 65]))
    try input.fileHandleForWriting.close()
    let out = output.fileHandleForReading.readDataToEndOfFile()
    let err = errors.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return ["pid": p.processIdentifier, "status": p.terminationStatus, "out": String(data: out, encoding: .utf8)!, "err": String(data: err, encoding: .utf8)!]
}
if helper {
    let row = try run(["app-server", "--listen", "stdio://"])
    try JSONSerialization.data(withJSONObject: row).write(to: URL(fileURLWithPath: env["PALBOO_TEST_NESTED"]!))
    exit(0)
}
var rows = [try run(["-c", "features.code_mode_host=true", "app-server", "--analytics-default-enabled"]),
            try run(["app-server", "--listen", "stdio://"], "codex-computer-use"),
            try run(["exec-server", "--concurrent-requests", "32"]),
            try run(["--version"]),
            try run(["app-server", "--listen", "stdio://"]),
            try run(["--version", "preserve-alias"]),
            try run(["app-server", "--listen", "stdio://", "--without-context"]),
            try run(["app-server", "--analytics-default-enabled", "--without-context"])]
let nested = Process()
nested.executableURL = URL(fileURLWithPath: env["PALBOO_TEST_HELPER"]!)
nested.arguments = ["helper"]
try nested.run(); nested.waitUntilExit()
let signal = Process()
signal.executableURL = URL(fileURLWithPath: proxy)
signal.arguments = ["signal-test"]
signal.standardOutput = FileHandle.nullDevice
try signal.run()
Thread.sleep(forTimeInterval: 0.3)
signal.terminate(); signal.waitUntilExit()
try JSONSerialization.data(withJSONObject: ["rows": rows, "signal": signal.terminationStatus, "signaled": signal.terminationReason == .uncaughtSignal]).write(to: URL(fileURLWithPath: env["PALBOO_TEST_RESULT"]!))
`,
    );
    execFileSync('xcrun', ['swiftc', source, '-o', desktop], { stdio: 'pipe' });
    const helper = join(root, 'helper');
    copyFileSync(desktop, helper);
    for (const file of [helper, app])
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', file], { stdio: 'pipe' });
    copyFileSync(realpathSync(process.env.PALBOO_TEST_CLI), proxy);
    chmodSync(proxy, 0o700);
    const shim = join(root, 'shim'),
      stock = join(root, 'stock');
    for (const [path, route] of [
      [shim, 'host'],
      [stock, 'native'],
    ])
      writeFileSync(
        path,
        `#!${process.execPath}
if (process.argv[2] === 'signal-test') { setInterval(()=>{}, 1000); } else {
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
process.stdout.write(JSON.stringify({route:${JSON.stringify(route)},pid:process.pid,args:process.argv.slice(2),input:Buffer.concat(chunks).toString('hex'),compat:Object.keys(process.env).filter(k=>k.startsWith('CODEXHOST_')||k==='CODEX_CLI_PATH'||k==='PALBOO_NATIVE_CLI_CONTEXT'),origin:process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE,unrelated:process.env.PALBOO_TEST_UNRELATED,runtimeCli:process.env.CODEX_APP_RUNTIME_CLI_PATH}));
process.stderr.write('preserved stderr\\n'); process.exitCode=37;
}
`,
        { mode: 0o700 },
      );
    writeFileSync(
      context,
      JSON.stringify({
        executable: proxy,
        desktop,
        endpoint: 'http://127.0.0.1:54321',
        stock,
        shim,
      }),
      { mode: 0o600 },
    );
    const result = join(root, 'result.json'),
      nested = join(root, 'nested.json');
    const env = {
      ...process.env,
      CODEX_CLI_PATH: proxy,
      CODEX_APP_RUNTIME_CLI_PATH: proxy,
      PALBOO_TEST_FOREIGN_ALIAS: process.execPath,
      PALBOO_NATIVE_CLI_CONTEXT: context,
      CODEXHOST_HOST_RUNTIME_PATH: 'owned-routing',
      CODEXHOST_LAUNCHER_PID: 'must-not-leak',
      PALBOO_TEST_HELPER: helper,
      PALBOO_TEST_RESULT: result,
      PALBOO_TEST_NESTED: nested,
      PALBOO_TEST_UNRELATED: 'preserved',
    };
    // 启动的是唯一临时 App，真实 ChatGPT 与用户数据保持不动。
    const args = ['-n', '-W'];
    for (const [key, value] of Object.entries(env))
      if (key.startsWith('CODEX') || key.startsWith('PALBOO_'))
        args.push('--env', `${key}=${value}`);
    args.push('-a', app, '--args', '--remote-debugging-port=54321');
    execFileSync('/usr/bin/open', args, { env, timeout: 20000, stdio: 'pipe' });
    const observed = JSON.parse(readFileSync(result, 'utf8'));
    const rows = [...observed.rows, JSON.parse(readFileSync(nested, 'utf8'))];
    for (const [index, row] of rows.entries()) {
      assert.equal(row.status, 37, `row ${index}: ${row.err}`);
      assert.equal(row.err, 'preserved stderr\n');
      const out = JSON.parse(row.out);
      assert.equal(out.route, index === 0 ? 'host' : 'native');
      assert.equal(out.pid, row.pid, 'exec must preserve PID and signal delivery');
      assert.equal(out.input, '00ff0a41');
      assert.equal(out.unrelated, 'preserved');
      assert.equal(out.runtimeCli, out.args.includes('preserve-alias') ? process.execPath : stock);
      if (index === 0) assert.ok(out.compat.includes('CODEXHOST_HOST_RUNTIME_PATH'));
      else assert.deepEqual(out.compat, []);
    }
    assert.deepEqual(JSON.parse(rows[0].out).args, [
      '-c',
      'features.code_mode_host=true',
      'app-server',
      '--analytics-default-enabled',
    ]);
    assert.equal(JSON.parse(rows[1].out).origin, 'codex-computer-use');
    assert.equal(observed.signal, 15);
    assert.equal(observed.signaled, true);

    if (process.env.PALBOO_TEST_STOCK_CLI) {
      // 在真实原生 CLI 上验证辅助 app-server 协议；不创建会话或执行任务。
      const actual = realpathSync(process.env.PALBOO_TEST_STOCK_CLI);
      writeFileSync(
        context,
        JSON.stringify({
          executable: proxy,
          desktop,
          endpoint: 'http://127.0.0.1:54321',
          stock: actual,
          shim,
        }),
        { mode: 0o600 },
      );
      const nativeEnv = { ...env, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'codex-computer-use' };
      delete nativeEnv.PALBOO_NATIVE_CLI_CONTEXT;
      nativeEnv.CODEX_HOME = join(root, 'codex-home');
      mkdirSync(nativeEnv.CODEX_HOME, { mode: 0o700 });
      const child = spawn(proxy, ['app-server', '--listen', 'stdio://'], {
        env: nativeEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      t.after(() => child.kill('SIGTERM'));
      let output = '',
        errors = '';
      child.stderr.on('data', (b) => (errors += b));
      const request = (id, method, params) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`initialize timeout: ${errors}`)), 10000);
          const receive = (b) => {
            output += b;
            for (const line of output.split('\n')) {
              try {
                const msg = JSON.parse(line);
                if (msg.id === id) {
                  clearTimeout(timer);
                  child.stdout.off('data', receive);
                  resolve(msg);
                }
              } catch {}
            }
          };
          child.stdout.on('data', receive);
          child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`stock exited ${code}: ${errors}`));
          });
          child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
        });
      assert.ok(
        (
          await request(1, 'initialize', {
            clientInfo: { name: 'palboo_native_acceptance', version: '1.0' },
            capabilities: { experimentalApi: true },
          })
        ).result,
        'official native app-server initialized',
      );
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      for (const [id, method, params] of [
        [2, 'config/read', { includeLayers: false }],
        [3, 'configRequirements/read', {}],
      ]) {
        const reply = await request(id, method, params);
        assert.ok(reply.result, `${method}: ${JSON.stringify(reply.error)}`);
      }
      child.stdin.end();
    }
  },
);
