/* [INPUT]: Native preview source, optional Palboo data directory and authenticated host appearance.
 * [OUTPUT]: Standalone menu-bar notification rehearsal, built under target/.
 * [POS]: npm run dev:status; never launches, quits or restarts the host or product backend.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync. */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { copyProjectLicenses } from './project-licenses.mjs';
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('原生预览需要 Apple Silicon Mac。');
const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check')
  ? '--check'
  : process.argv.includes('--motion-check')
    ? '--motion-check'
    : null;
const output = join(root, 'target/lifecycle-preview', check ? 'checks' : '');
const app = join(output, 'Palboo Status Preview.app');
const contents = join(app, 'Contents');
mkdirSync(join(contents, 'MacOS'), { recursive: true });
mkdirSync(join(contents, 'Resources'), { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const binary = join(contents, 'MacOS/Preview');
if (!check) {
  run('xcrun', [
    'swift',
    '-e',
    `import AppKit
let previews = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == "local.palboo.status-preview" }
for app in previews { app.terminate() }
let deadline = Date().addingTimeInterval(3)
while previews.contains(where: { !$0.isTerminated }) && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
if previews.contains(where: { !$0.isTerminated }) { exit(1) }
`,
  ]);
}
run('xcrun', [
  'swiftc',
  '-target',
  'arm64-apple-macosx14.0',
  join(root, 'scripts/lifecycle-preview.swift'),
  '-o',
  binary,
]);
writeFileSync(
  join(contents, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.palboo.status-preview${check ? '.checks' : ''}</string>
<key>CFBundleName</key><string>Palboo Status Preview</string>
<key>CFBundleExecutable</key><string>Preview</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`,
);
copyProjectLicenses(root, join(contents, 'Resources'));
run('codesign', ['--force', '--sign', '-', app]);
if (check) run(binary, [check]);
else {
  const index = process.argv.indexOf('--data-dir');
  if (index >= 0 && !process.argv[index + 1]) throw new Error('--data-dir 需要目录。');
  const directory = index >= 0 ? resolve(process.argv[index + 1]) : join(root, 'target/dev/real');
  const connection = mkdtempSync(join(tmpdir(), 'palboo-notice-'));
  try {
    const runtime = JSON.parse(readFileSync(join(directory, 'runtime.json'), 'utf8'));
    const prefs = JSON.parse(readFileSync(join(directory, 'panel.json'), 'utf8'));
    let settingsAppearance;
    try {
      const response = await fetch(`http://127.0.0.1:${runtime.port}/api/state`, {
        headers: { Authorization: `Bearer ${runtime.token}` },
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        const state = await response.json();
        settingsAppearance = state.settingsAppearance;
      }
    } catch {
      // The native preview retains its last valid palette when the host is unavailable.
    }
    writeFileSync(
      join(connection, 'runtime.json'),
      JSON.stringify({ port: runtime.port, token: runtime.token }),
      { mode: 0o600 },
    );
    writeFileSync(
      join(connection, 'panel.json'),
      JSON.stringify({
        revision: prefs.revision,
        lifecyclePreview: prefs.lifecyclePreview,
        language: prefs.language,
        settingsAppearance,
      }),
      { mode: 0o600 },
    );
  } catch {
    /* The standalone preview also works without a running product. */
  }
  run('open', [
    app,
    '--args',
    '--connection-dir',
    connection,
    ...(process.argv.includes('--report-theme') ? ['--report-theme'] : []),
  ]);
}
