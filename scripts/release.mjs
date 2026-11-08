/*
 * [INPUT]: 当前 main 修订、同次 CI 生成的 DMG/打包记录、Git 标签引用与 GitHub token。
 * [OUTPUT]: 新版本的公开 Release；已发布版本或过时的 main 运行正常跳过。
 * [POS]: CI 最后一步，仅上传已验证的云端产物，不构建、不替换已发布内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { validateRelease } from './release-plan.mjs';

const root = resolve(import.meta.dirname, '..');
const { GITHUB_ACTIONS, GITHUB_REF, GITHUB_EVENT_NAME, GITHUB_REPOSITORY, GITHUB_SHA } =
  process.env;
if (
  GITHUB_ACTIONS !== 'true' ||
  GITHUB_REF !== 'refs/heads/main' ||
  !['push', 'workflow_dispatch'].includes(GITHUB_EVENT_NAME) ||
  GITHUB_REPOSITORY !== '0xTotoroX/palboo' ||
  !/^[0-9a-f]{40}$/.test(GITHUB_SHA || '')
)
  throw new Error('发布只在官方仓库 main 的 GitHub Actions 中执行');

function api(path) {
  const result = spawnSync('gh', ['api', `repos/${GITHUB_REPOSITORY}/${path}`], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/\(HTTP 404\)/.test(result.stderr)) return null;
  throw new Error(`GitHub 查询失败：${result.stderr.trim()}`);
}
function report(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
}
function publish() {
  const plan = validateRelease(root);
  const existing = api(`releases/tags/${plan.tag}`);
  if (existing) {
    if (existing.draft) throw new Error(`${plan.tag} 已有未完成草稿，请检查该次发布失败日志`);
    report(`${plan.tag} 已发布，本次只生成 CI 验收包，保留原 Release。`);
    return;
  }
  if (api('commits/main')?.sha !== GITHUB_SHA) {
    report('main 已有更新提交，本次保留 CI 验收包，由更新的提交负责发布。');
    return;
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (head !== GITHUB_SHA) throw new Error('发布源码与已验证修订不一致');
  const tagRef = api(`git/ref/tags/${plan.tag}`);
  const tag = tagRef ? api(`commits/${plan.tag}`) : null;
  if (tag && tag.sha !== GITHUB_SHA) throw new Error('已有标签指向其他修订，拒绝发布或移动标签');
  const artifact = JSON.parse(readFileSync(join(root, 'target/reports/package.json'), 'utf8'));
  const bytes = readFileSync(join(root, plan.assets[0]));
  if (
    artifact.version !== plan.version ||
    artifact.commit !== GITHUB_SHA ||
    artifact.artifact !== plan.assets[0] ||
    !bytes.length ||
    artifact.sha256 !== createHash('sha256').update(bytes).digest('hex')
  )
    throw new Error('DMG 与本次已验证修订、版本或摘要不一致');
  execFileSync(
    'gh',
    [
      'release',
      'create',
      plan.tag,
      plan.assets[0],
      '--repo',
      GITHUB_REPOSITORY,
      '--target',
      GITHUB_SHA,
      '--title',
      `Palboo ${plan.tag}`,
      '--notes-file',
      plan.notes,
      ...(plan.prerelease ? ['--prerelease'] : []),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  report(
    `已发布 [Palboo ${plan.tag}](https://github.com/${GITHUB_REPOSITORY}/releases/tag/${plan.tag})，产物来自本次 GitHub CI。`,
  );
}
publish();
