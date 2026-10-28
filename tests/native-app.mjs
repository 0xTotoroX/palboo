/* [INPUT]: Isolated directory and the production Swift launcher/icon builder.
 * [OUTPUT]: A synthetic complete App identity for native window acceptance.
 * [POS]: Test-only bundle; never installs or changes the user's Dock preferences.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { installIcon } from '../scripts/launcher.mjs';

export function nativeApp(directory) {
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
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
  return app;
}
