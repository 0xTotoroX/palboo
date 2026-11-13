/* [INPUT]: 显式指定的官方 CodexHost 0.18 安装、LaunchServices 和合成 App/运行时。
 * [OUTPUT]: Palboo 直接打开 App 时，官方 Shim 路由和辅助命令隔离的专项验收。
 * [POS]: 仅验证启动参数交接，不替代生产协调及真实 Codex 冷启动验收。
 * [PROTOCOL]: 变更时同步 tests/AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  realpathSync,
  copyFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test(
  'direct LaunchServices open passes process-local routing to the official shim',
  {
    skip: process.platform !== 'darwin' || !process.env.PALBOO_TEST_CODEXHOST_PACKAGE,
  },
  (t) => {
    const installation = realpathSync(process.env.PALBOO_TEST_CODEXHOST_PACKAGE);
    assert.match(
      execFileSync(join(installation, 'bin/codexhost'), ['--version'], { encoding: 'utf8' }),
      /0\.18\.0/,
    );
    const root = mkdtempSync(join(tmpdir(), 'palboo-direct-host-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    // 合成 App 没有用户应用的文稿访问授权；只复制执行文件到隔离目录，不修改官方安装。
    const shim = join(root, 'codexhost-shim');
    copyFileSync(join(installation, 'libexec/codexhost-shim'), shim);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', shim], { stdio: 'pipe' });
    const app = join(root, 'Synthetic Codex.app'),
      bin = join(app, 'Contents/MacOS');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(app, 'Contents/Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleIdentifier</key><string>local.palboo.direct-host-test</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>',
    );
    const swift = join(root, 'fixture.swift');
    writeFileSync(
      swift,
      `import Foundation
import Darwin
let environment = ProcessInfo.processInfo.environment
let executable = environment["CODEX_CLI_PATH"]!
for arguments in [["app-server", "--stdio"], ["--version"]] {
    let input = Pipe()
    let child = Process()
    child.executableURL = URL(fileURLWithPath: executable)
    child.arguments = arguments
    child.standardInput = input
    child.standardOutput = FileHandle.nullDevice
    child.standardError = FileHandle(forWritingAtPath: environment["PALBOO_TEST_ERRORS"]!)!
    try child.run()
    DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
        if child.isRunning { child.terminate() }
    }
    child.waitUntilExit()
    try Data("\\(arguments[0]):\\(child.terminationStatus)".utf8).write(to: URL(fileURLWithPath: environment["PALBOO_TEST_STATUS"]!))
    if child.terminationStatus != 0 { exit(child.terminationStatus) }
}
try Data("done".utf8).write(to: URL(fileURLWithPath: environment["PALBOO_TEST_DONE"]!))
`,
    );
    execFileSync('xcrun', ['swiftc', swift, '-o', join(bin, 'Fixture')]);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
    const runtime = join(root, 'runtime.mjs'),
      stock = join(root, 'stock'),
      record = join(root, 'routing.json');
    writeFileSync(
      runtime,
      `import {writeFileSync} from 'node:fs';
writeFileSync(process.env.PALBOO_TEST_ROUTING,JSON.stringify({args:process.argv.slice(2),shimRemoved:!process.env.CODEX_CLI_PATH,stock:process.env.CODEXHOST_STOCK_CODEX_PATH}),{mode:0o600});
`,
    );
    writeFileSync(
      stock,
      `#!/bin/sh
test "$1" = '--version' || exit 3
test -z "$CODEX_CLI_PATH" || exit 4
test -z "$CODEXHOST_HOST_RUNTIME_PATH" || exit 5
printf 'stock' > "$PALBOO_TEST_STOCK"
`,
      { mode: 0o700 },
    );
    const injected = {
      CODEX_CLI_PATH: shim,
      CODEXHOST_STOCK_CODEX_PATH: stock,
      CODEXHOST_HOST_NODE_PATH: process.execPath,
      CODEXHOST_HOST_RUNTIME_PATH: runtime,
      PALBOO_TEST_ROUTING: record,
      PALBOO_TEST_STOCK: join(root, 'stock-called'),
      PALBOO_TEST_DONE: join(root, 'done'),
      PALBOO_TEST_ERRORS: join(root, 'errors'),
      PALBOO_TEST_STATUS: join(root, 'status'),
    };
    writeFileSync(injected.PALBOO_TEST_ERRORS, '');
    // 与产品的 LaunchServices 边界一致，环境只交给本次唯一测试 App；不写 launchctl 或 shell 配置。
    const args = ['-n', '-W'];
    for (const [key, value] of Object.entries(injected)) args.push('--env', `${key}=${value}`);
    args.push('-a', app);
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('CODEXHOST_') && key !== 'CODEX_CLI_PATH',
      ),
    );
    const opened = spawnSync('/usr/bin/open', args, {
      env: environment,
      encoding: 'utf8',
      timeout: 12000,
    });
    assert.equal(opened.status, 0, opened.stderr || String(opened.error || opened.signal));
    assert.ok(
      existsSync(join(root, 'done')),
      JSON.stringify({
        routed: existsSync(record),
        stock: existsSync(join(root, 'stock-called')),
        status:
          existsSync(injected.PALBOO_TEST_STATUS) &&
          readFileSync(injected.PALBOO_TEST_STATUS, 'utf8'),
        errors: readFileSync(injected.PALBOO_TEST_ERRORS, 'utf8').slice(0, 1500),
      }),
    );
    assert.deepEqual(JSON.parse(readFileSync(record)), {
      args: ['app-server', '--stdio'],
      shimRemoved: true,
      stock: realpathSync(stock),
    });
    assert.equal(readFileSync(join(root, 'stock-called'), 'utf8'), 'stock');
  },
);
