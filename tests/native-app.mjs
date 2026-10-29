/* [INPUT]: Isolated directory, verified binary and the production Swift launcher/icon builder.
 * [OUTPUT]: A self-contained synthetic App identity for native window acceptance.
 * [POS]: Test-only bundle; never installs or changes the user's Dock preferences.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { installIcon } from '../scripts/launcher.mjs';

export function nativeApp(directory, binary) {
  const app = join(directory, 'Palboo.app');
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents/Resources'));
  execFileSync('xcrun', [
    'swiftc',
    resolve(import.meta.dirname, '../scripts/app-launcher.swift'),
    '-o',
    join(app, 'Contents/MacOS/PalbooLauncher'),
  ]);
  writeFileSync(
    join(app, 'Contents/Info.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.palboo.launcher</string>
<key>CFBundleName</key><string>Palboo</string>
<key>CFBundleExecutable</key><string>PalbooLauncher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>palboo.icns</string>
<key>PalbooWindowHostVersion</key><integer>1</integer>
<key>LSUIElement</key><true/></dict></plist>`,
  );
  installIcon(app, directory);
  // 合成 App 自带已核验的程序，不跨入真实源码目录读取可执行文件。
  copyFileSync(binary, join(app, 'Contents/MacOS/palboo'));
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
  return app;
}
