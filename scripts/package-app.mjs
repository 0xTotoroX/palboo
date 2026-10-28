/*
 * [INPUT]: 当前 release CLI、Swift 启动器、版本、许可资源与系统打包工具。
 * [OUTPUT]: buildApplication、packageDmg；本地签名完整 App 与验证后的 DMG。
 * [POS]: 纯本地分发构建，不安装、不启动宿主、不读用户配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  mkdtempSync,
  cpSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { installIcon } from './launcher.mjs';
import { auditArtifact } from './artifact-audit.mjs';

const root = resolve(import.meta.dirname, '..');
const run = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function verifyChecksums(app) {
  const contents = join(app, 'Contents');
  const manifest = JSON.parse(readFileSync(join(contents, 'Resources/manifest.json'), 'utf8'));
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (digest(join(contents, file)) !== expected) throw new Error('包内程序校验值不匹配');
  }
}

function verifyMetadata(app) {
  const lines = run('/usr/bin/xattr', ['-lr', app]).split('\n').filter(Boolean);
  // 本机系统可能保留/重建这个单字节值；拒绝任何来源记录或其他扩展属性。
  if (lines.some((line) => !line.endsWith(': com.apple.provenance: \x01')))
    throw new Error('分发 App 含未清理的扩展属性');
  return { provenanceMarkers: lines.length };
}

export function buildApplication({ binary, version, resources, destination, sourceFingerprint }) {
  const contents = join(destination, 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  mkdirSync(join(contents, 'Resources'), { recursive: true });
  cpSync(resources, join(contents, 'Resources'), { recursive: true });
  const cli = join(contents, 'MacOS/palboo');
  copyFileSync(binary, cli);
  const launcher = join(contents, 'MacOS/PalbooLauncher');
  run('xcrun', [
    'swiftc',
    '-O',
    '-target',
    'arm64-apple-macosx14.0',
    '-debug-prefix-map',
    `${homedir()}=/build/home`,
    '-file-prefix-map',
    `${root}=/build/palboo`,
    join(root, 'scripts/app-launcher.swift'),
    '-o',
    launcher,
  ]);
  run('/usr/bin/strip', ['-S', launcher]);
  writeFileSync(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.palboo.launcher</string>
<key>CFBundleName</key><string>Palboo</string>
<key>CFBundleDisplayName</key><string>Palboo</string>
<key>CFBundleExecutable</key><string>PalbooLauncher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version.split(/[+-]/)[0]}</string>
<key>CFBundleVersion</key><string>${version.split(/[+-]/)[0]}</string>
<key>CFBundleIconFile</key><string>palboo.icns</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>PalbooWindowHostVersion</key><integer>1</integer>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`,
  );
  const iconStaging = mkdtempSync(join(dirname(destination), '.icons-'));
  try {
    installIcon(destination, iconStaging);
  } finally {
    rmSync(iconStaging, { recursive: true, force: true });
  }
  // 清理仅作用于本次生成的目录，保留用户原始图标/安装版的元数据。
  run('/usr/bin/xattr', ['-cr', destination]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', cli]);
  const manifest = {
    name: 'palboo',
    version,
    platform: 'darwin',
    arch: 'arm64',
    minimumOSVersion: '14.0',
    license: 'GPL-3.0-only',
    sourceFingerprint,
    // 启动器随后会被 App 的资源封印改写，由整体签名验证；避免把签名前哈希写入包内。
    files: { 'MacOS/palboo': digest(cli) },
  };
  writeFileSync(
    join(contents, 'Resources/manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  writeFileSync(
    join(contents, 'Resources/SHA256SUMS'),
    Object.entries(manifest.files)
      .map(([file, hash]) => `${hash}  ../${file}\n`)
      .join(''),
  );
  run('/usr/bin/codesign', ['--force', '--sign', '-', destination]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', destination]);
  verifyChecksums(destination);
  for (const program of [cli, launcher]) {
    if (!/minos\s+14\.0\b/.test(run('xcrun', ['vtool', '-show-build', program])))
      throw new Error('分发程序的最低系统版本不符合 macOS 14.0');
    if (
      run('/usr/bin/otool', ['-L', program])
        .split('\n')
        .slice(1)
        .some((line) => line.trim() && !/^\s+\/(?:System\/Library|usr\/lib)\//.test(line))
    )
      throw new Error('分发程序引用了非系统动态库');
  }
  const check = run(launcher, ['--check']).trim();
  if (check !== `palboo ${version}`) throw new Error('App 内部主程序版本不匹配');
  return auditArtifact(destination);
}

export function packageDmg({ app, output, version, temporary }) {
  const imageSource = join(temporary, 'image');
  mkdirSync(imageSource);
  cpSync(app, join(imageSource, 'Palboo.app'), { recursive: true });
  run('/usr/bin/xattr', ['-cr', join(imageSource, 'Palboo.app')]);
  symlinkSync('/Applications', join(imageSource, 'Applications'));
  // HFS+ 不含 tar 的属主名称字段；保留普通用户权限，避免强设 root 触发管理员授权。
  // 不调用 Finder 自动化，也不生成含本机路径的 .DS_Store。
  run('/usr/bin/hdiutil', [
    'create',
    '-ov',
    '-format',
    'UDZO',
    '-fs',
    'HFS+',
    '-volname',
    `Palboo ${version}`,
    '-srcfolder',
    imageSource,
    output,
  ]);
  run('/usr/bin/xattr', ['-c', output]);
  run('/usr/bin/hdiutil', ['verify', output]);
  const mount = join(temporary, 'mounted');
  mkdirSync(mount);
  let attached = false;
  try {
    run('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-noautoopen',
      '-mountpoint',
      mount,
      output,
    ]);
    attached = true;
    const mountedApp = join(mount, 'Palboo.app');
    const inspection = auditArtifact(mountedApp);
    const metadata = verifyMetadata(mountedApp);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', mountedApp]);
    verifyChecksums(mountedApp);
    if (
      run(join(mountedApp, 'Contents/MacOS/PalbooLauncher'), ['--check']).trim() !==
      `palboo ${version}`
    )
      throw new Error('DMG 中的程序版本不一致');
    // 镜像读回以后再复制到不同路径，验证 App 不依赖构建和挂载位置。
    const moved = join(temporary, "moved app's folder", 'Palboo.app');
    cpSync(mountedApp, moved, { recursive: true });
    if (
      run(join(moved, 'Contents/MacOS/PalbooLauncher'), ['--check']).trim() !== `palboo ${version}`
    )
      throw new Error('移动后的 App 无法找到包内主程序');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', moved]);
    const names = readdirSync(mount).filter((name) => !name.startsWith('.'));
    if (names.sort().join(',') !== 'Applications,Palboo.app') throw new Error('镜像含意外文件');
    return {
      ...inspection,
      metadata,
      bytes: statSync(output).size,
      relocated: true,
      signature: 'adhoc',
    };
  } finally {
    if (attached) run('/usr/bin/hdiutil', ['detach', mount]);
  }
}
