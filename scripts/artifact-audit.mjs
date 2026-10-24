/*
 * [INPUT]: 待分发目录/程序、构建环境与当前源码路径。
 * [OUTPUT]: distributionEnvironment、auditArtifact；失败只报告文件和问题类型，不打印敏感值。
 * [POS]: 打包前的编译路径映射与打包后的有限隐私检查，包含二进制字节。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

export function distributionEnvironment(root, env = process.env) {
  // Cargo 的 encoded 形式保留参数边界，避免路径里的空格拆开编译选项。
  const flags = env.CARGO_ENCODED_RUSTFLAGS
    ? env.CARGO_ENCODED_RUSTFLAGS.split('\x1f')
    : (env.RUSTFLAGS || '').split(/\s+/).filter(Boolean);
  const mappings = [
    [homedir(), '/build/home'],
    [env.CARGO_HOME || join(homedir(), '.cargo'), '/build/cargo'],
    [env.RUSTUP_HOME || join(homedir(), '.rustup'), '/build/rustup'],
    [root, '/build/palboo'],
  ];
  for (const [from, to] of mappings) flags.push(`--remap-path-prefix=${from}=${to}`);
  return { ...env, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f') };
}

export function auditArtifact(path) {
  let files = 0;
  function inspect(file) {
    const label = relative(path, file) || 'program';
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`分发文件不能是符号链接：${label}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(file)) inspect(join(file, name));
      return;
    }
    if (!stat.isFile()) throw new Error(`非普通分发文件：${label}`);
    if (
      /(^|\/)(?:\._[^/]*|\.DS_Store|\.env(?:\.[^/]*)?|(?:secrets|runtime|panel|config|auth)\.json)$|\.(?:pem|key|log)$/.test(
        label,
      )
    )
      throw new Error(`分发目录含私有文件或系统元数据：${label}`);
    const bytes = readFileSync(file);
    const text = bytes.toString('latin1');
    for (const [kind, pattern] of [
      ['个人绝对路径', /\/(?:Users|Volumes|home)\/[^\s/"'`\x00]{1,100}\//],
      ['Windows 用户路径', /[A-Za-z]:\\Users\\[^\\\s\x00]{1,100}\\/],
      ['疑似凭据', /\b(?:gh[pousr]_|github_pat_|sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}/],
      ['私钥', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ]) {
      if (pattern.test(text)) throw new Error(`分发检查失败：${label} 包含${kind}`);
    }
    // 同时检查 UTF-16（如编译脚本）和当前构建者非标准位置的主目录。
    if (
      bytes.includes(Buffer.from(homedir() + '/')) ||
      bytes.includes(Buffer.from(homedir() + '/', 'utf16le'))
    )
      throw new Error(`分发检查失败：${label} 包含构建者主目录`);
    files++;
  }
  inspect(path);
  return { files, passed: true };
}
