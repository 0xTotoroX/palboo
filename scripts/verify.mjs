/*
 * [INPUT]: 当前源码、锁定依赖、Cargo 与隔离验收脚本。
 * [OUTPUT]: 统一验证流程、逐项耗时及源码/程序摘要；常规端到端与打包共用 release，Bot 夹具使用 debug。
 * [POS]: 验证编排入口；测试开始前检查产物与源码一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import './brand.mjs';
import { distributionEnvironment } from './artifact-audit.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const steps = [];
let progressFile;
function run(command, args, env = process.env) {
  const started = Date.now();
  const name = `${command === process.execPath ? 'node' : command} ${args.join(' ')}`;
  if (process.env.GITHUB_ACTIONS) console.log(`::group::${command} ${args.join(' ')}`);
  if (progressFile)
    writeFileSync(
      progressFile,
      JSON.stringify({ steps, running: { name, started } }, null, 2) + '\n',
    );
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env,
    timeout: 15 * 60_000,
  });
  const durationMs = Date.now() - started;
  steps.push({ name, durationMs, passed: !result.error && result.status === 0 });
  if (progressFile) {
    writeFileSync(progressFile, JSON.stringify({ steps }, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `${steps.at(-1).passed ? '✓' : '✗'} ${name}: ${(durationMs / 1000).toFixed(1)}s\n\n`,
      );
  }
  console.log(`${name}: ${(durationMs / 1000).toFixed(1)}s`);
  if (process.env.GITHUB_ACTIONS) console.log('::endgroup::');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败 (${result.status})`);
}
function sourceFingerprint(env = process.env) {
  const inputs = [
    'Cargo.toml',
    'Cargo.lock',
    'package.json',
    'package-lock.json',
    'build.rs',
    'scripts/build-panel.mjs',
    'scripts/verify.mjs',
    'scripts/artifact-audit.mjs',
    'scripts/third-party-notices.mjs',
    'scripts/license-texts.json',
    'tsconfig.json',
  ];
  for (const dir of ['src', 'ui', '.cargo']) {
    for (const file of readdirSync(join(root, dir), { recursive: true, withFileTypes: true })) {
      if (file.isFile() && !file.name.endsWith('.md') && file.name !== '.DS_Store')
        inputs.push(join(file.parentPath, file.name).slice(root.length + 1));
    }
  }
  const digest = createHash('sha256')
    .update(process.version)
    .update(execFileSync('rustc', ['-Vv']));
  for (const key of [
    'RUSTFLAGS',
    'CARGO_ENCODED_RUSTFLAGS',
    'CARGO_BUILD_TARGET',
    'MACOSX_DEPLOYMENT_TARGET',
  ])
    digest.update(key).update(env[key] || '');
  for (const path of inputs.sort()) digest.update(path).update(readFileSync(join(root, path)));
  return digest.digest('hex');
}
function prepareWebBuild() {
  const manifest = join(root, 'target/verified-web.json');
  // Both Rust profiles embed the same web files. Keep their compiler flags out of this identity.
  const source = sourceFingerprint({});
  const output = () => {
    const dir = join(root, 'target/web');
    if (!existsSync(dir)) return '';
    const digest = createHash('sha256');
    for (const file of readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((file) => file.isFile())
      .map((file) => join(file.parentPath, file.name))
      .sort())
      digest.update(file.slice(dir.length)).update(readFileSync(file));
    return digest.digest('hex');
  };
  let previous;
  try {
    previous = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {}
  if (previous?.source === source && previous.output && previous.output === output()) return;
  run('npm', ['run', 'build:web']);
  if (sourceFingerprint({}) !== source) throw new Error('网页构建期间源码发生变化');
  writeFileSync(manifest, JSON.stringify({ source, output: output() }) + '\n');
}
export function prepareTestBinary(profile) {
  const explicit = process.env.PALBOO_TEST_BINARY;
  if (!profile && explicit) {
    const match = ['debug', 'release'].find(
      (p) => resolve(explicit) === join(root, 'target', p, 'palboo'),
    );
    if (!match)
      throw new Error(
        'PALBOO_TEST_BINARY 请指向本仓库 target/debug 或 target/release 的程序，以核验源码一致性。',
      );
    profile = match;
  }
  profile ||= 'debug';
  const binary = join(root, 'target', profile, 'palboo');
  const manifestPath = join(root, 'target', `verified-${profile}.json`);
  const env = profile === 'release' ? distributionEnvironment(root) : process.env;
  const source = sourceFingerprint(env);
  prepareWebBuild();
  let previous;
  try {
    previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {}
  if (
    !existsSync(binary) ||
    previous?.source !== source ||
    previous?.sha256 !== hash(readFileSync(binary))
  ) {
    run('cargo', ['build', '--locked', ...(profile === 'release' ? ['--release'] : [])], env);
    if (sourceFingerprint(env) !== source)
      throw new Error('构建期间源码发生变化，请重新运行验证。');
    previous = {
      binary,
      source,
      sha256: hash(readFileSync(binary)),
      version: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
    };
    writeFileSync(manifestPath, JSON.stringify(previous, null, 2) + '\n');
  }
  // Moving the checkout does not invalidate bytes, but cached absolute paths must follow it.
  if (previous.binary !== binary) {
    previous = { ...previous, binary };
    writeFileSync(manifestPath, JSON.stringify(previous, null, 2) + '\n');
  }
  return previous;
}
async function verify() {
  mkdirSync(join(root, 'target/reports'), { recursive: true });
  progressFile = join(root, 'target/reports/verify-progress.json');
  writeFileSync(progressFile, JSON.stringify({ steps: [] }) + '\n');
  rmSync(join(root, 'target/reports/verify.json'), { force: true });
  const started = Date.now();
  let artifact,
    passed = false,
    native = 'not-run';
  try {
    run('npm', ['run', 'format:check']);
    run('cargo', ['fmt', '--check']);
    run('npm', ['run', 'audit:source']);
    prepareWebBuild();
    run('cargo', ['clippy', '--locked', '--', '-D', 'warnings']);
    run('cargo', ['test', '--locked']);
    // build:web already checks TypeScript. Test the same release binary that will be packaged.
    artifact = prepareTestBinary('release');
    run('npm', ['run', 'test:node'], {
      ...process.env,
      PALBOO_TEST_WEB_DIR: join(root, 'target/web'),
    });
    run(process.execPath, ['tests/workbench.mjs']);
    run(process.execPath, ['tests/model-control-host.mjs']);
    run(process.execPath, ['tests/feature-views.mjs']);
    const env = { ...process.env, PALBOO_TEST_BINARY: artifact.binary };
    run(process.execPath, ['tests/model-control-e2e.mjs'], env);
    run(process.execPath, ['tests/board.mjs'], env);
    run(process.execPath, ['tests/config-cli.mjs'], env);
    run(process.execPath, ['tests/backup-e2e.mjs'], env);
    run(process.execPath, ['tests/features-e2e.mjs'], env);
    run(process.execPath, ['tests/web-library.mjs'], env);
    run(process.execPath, ['tests/e2e.mjs'], env);
    run(process.execPath, ['tests/lifecycle-test.mjs'], env);
    if (process.argv.includes('--native')) {
      run(process.execPath, ['tests/native-check.mjs'], env);
      native = 'full';
    } else if (process.argv.includes('--native-appearance')) {
      run(process.execPath, ['tests/native-check.mjs', '--appearance-only'], env);
      native = 'appearance';
    }
    passed = true;
  } finally {
    mkdirSync(join(root, 'target/reports'), { recursive: true });
    writeFileSync(
      join(root, 'target/reports/verify.json'),
      JSON.stringify(
        {
          passed,
          durationMs: Date.now() - started,
          steps,
          artifact,
          native,
        },
        null,
        2,
      ) + '\n',
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Verification timings\n\n| Check | Seconds | Result |\n| --- | ---: | --- |\n` +
          steps
            .map(
              ({ name, durationMs, passed }) =>
                `| ${name} | ${(durationMs / 1000).toFixed(1)} | ${passed ? 'Passed' : 'Failed'} |`,
            )
            .join('\n') +
          '\n',
      );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await verify();
