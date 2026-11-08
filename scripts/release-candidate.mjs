/*
 * [INPUT]: 官方 main 事件、版本计划、Git 历史、已完成构建 job 与不可变 Actions artifact。
 * [OUTPUT]: 经来源校验的候选提交/run/artifact 身份及本地 DMG 摘要。
 * [POS]: 自动发布与手动恢复共用的门禁；发布工具修订与产品修订分别记录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { repository } from './release-api.mjs';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function releaseContext(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')
  )
    throw new Error('发布只在官方仓库 main 的 GitHub Actions 中执行');
  const reuse = env.PALBOO_RELEASE_RUN_ID || '';
  if (reuse && (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !/^[1-9][0-9]*$/.test(reuse)))
    throw new Error('产物复用只接受 main 手动运行中的有效 run ID');
  return {
    publisher: env.GITHUB_SHA,
    currentRun: env.GITHUB_RUN_ID,
    runId: reuse || env.GITHUB_RUN_ID,
    recovery: Boolean(reuse),
  };
}

export function checkCandidateHistory(root, candidate, publisher) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (git('rev-parse', 'HEAD').trim() !== publisher)
    throw new Error('发布工具 checkout 与事件修订不一致');
  if (candidate === publisher) return;
  try {
    git('merge-base', '--is-ancestor', candidate, publisher);
  } catch {
    throw new Error('候选提交不是当前 main 的祖先');
  }
  const files = git('diff', '--no-renames', '--name-only', '-z', candidate, publisher)
    .split('\0')
    .filter(Boolean);
  // workflow 不同会触发 GitHub 的额外 Workflows 写权限要求；不引入更高权限令牌。
  const allowed =
    /^(?:scripts\/release(?:-[a-z]+)?\.mjs|tests\/.+|(?:scripts\/)?AGENTS\.md|README(?:\.zh-CN)?\.md)$/;
  if (files.some((file) => !allowed.test(file)))
    throw new Error('候选之后包含产品、构建输入、版本说明或 workflow 变化，需要新的完整构建');
}

export async function checkedBuild(api, context) {
  const run = await api.request('GET', `actions/runs/${context.runId}`);
  if (
    String(run.id) !== context.runId ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.head_branch !== 'main' ||
    run.path !== '.github/workflows/ci.yml' ||
    !['push', 'workflow_dispatch'].includes(run.event) ||
    !/^[a-f0-9]{40}$/.test(run.head_sha || '') ||
    (run.status !== 'completed' && context.runId !== context.currentRun)
  )
    throw new Error('候选运行不是官方 main 的受信 CI');
  const jobs = await api.list(`actions/runs/${context.runId}/jobs?filter=latest`, 'jobs');
  const build = jobs.filter((job) => job.name === 'Build and check App');
  const required = [
    'Verify',
    'Check embedded glass',
    'Package verified App',
    'Save App and build identity',
  ];
  if (
    build.length !== 1 ||
    build[0].conclusion !== 'success' ||
    required.some(
      (name) =>
        !build[0].steps?.some((step) => step.name === name && step.conclusion === 'success'),
    )
  )
    throw new Error('候选没有通过完整验证、液态检查和打包，拒绝复用');
  const artifacts = (await api.list(`actions/runs/${context.runId}/artifacts`, 'artifacts')).filter(
    (artifact) => artifact.name === 'palboo-macos',
  );
  if (
    artifacts.length !== 1 ||
    artifacts[0].expired ||
    artifacts[0].workflow_run?.head_sha !== run.head_sha ||
    !Number.isSafeInteger(artifacts[0].id) ||
    artifacts[0].size_in_bytes <= 0
  )
    throw new Error('候选 App artifact 缺失、过期或来源不一致');
  return { ...context, commit: run.head_sha, artifactId: artifacts[0].id };
}

export function checkedDmg(root, plan, candidate) {
  const artifact = JSON.parse(readFileSync(join(root, 'target/reports/package.json'), 'utf8'));
  const bytes = readFileSync(join(root, plan.assets[0]));
  if (
    artifact.version !== plan.version ||
    artifact.commit !== candidate.commit ||
    artifact.artifact !== plan.assets[0] ||
    !bytes.length ||
    artifact.sha256 !== digest(bytes) ||
    artifact.app?.passed !== true ||
    artifact.image?.bytes !== bytes.length ||
    artifact.image?.relocated !== true
  )
    throw new Error('DMG 与已验证修订、版本、打包结果或摘要不一致');
  return {
    ...candidate,
    version: plan.version,
    tag: plan.tag,
    name: plan.assets[0].slice(5),
    sha256: artifact.sha256,
    bytes,
  };
}
