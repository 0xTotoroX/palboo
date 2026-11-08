/*
 * [INPUT]: 官方 main、已验证候选 DMG/来源记录、已审核说明与 GitHub token。
 * [OUTPUT]: 可恢复的内部草稿、核验后的公开 Release 与逐阶段发布回执。
 * [POS]: CI 的只读预检查和发布入口；永不删除 Release，写响应不确定时先回读。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { appendFileSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRelease } from './release-plan.mjs';
import { githubClient } from './release-api.mjs';
import {
  releaseContext,
  checkCandidateHistory,
  checkedBuild,
  checkedDmg,
  digest,
} from './release-candidate.mjs';

export async function findRelease(api, tag) {
  const published = await api.request('GET', `releases/tags/${tag}`, undefined, { optional: true });
  if (published) return published;
  const matches = (await api.list('releases')).filter((release) => release.tag_name === tag);
  if (matches.length > 1) throw new Error('同一标签存在多个 Release，拒绝选择');
  return matches[0] || null;
}
export async function checkTag(api, tag, commit, required = false) {
  const ref = await api.request('GET', `git/ref/tags/${tag}`, undefined, { optional: true });
  if (!ref) {
    if (required) throw new Error('公开 Release 缺少对应标签');
    return;
  }
  const target = await api.request('GET', `commits/${tag}`);
  if (target?.sha !== commit) throw new Error('已有标签指向其他修订，拒绝发布或移动标签');
}
function draftBody(candidate, notes) {
  const owner = {
    schema: 1,
    commit: candidate.commit,
    runId: candidate.runId,
    sha256: candidate.sha256,
    notes: digest(notes),
  };
  return `${notes}\n<!-- palboo-release:${JSON.stringify(owner)} -->`;
}
function checkPlannedDraft(release, candidate, plan, notes) {
  const prefix = `${notes}\n<!-- palboo-release:`;
  let owner;
  try {
    if (!release.body?.startsWith(prefix) || !release.body.endsWith(' -->')) throw new Error();
    owner = JSON.parse(release.body.slice(prefix.length, -4));
  } catch {
    throw new Error('存在未知来源草稿，保留原对象并停止');
  }
  if (
    !release.draft ||
    release.target_commitish !== candidate.commit ||
    release.tag_name !== plan.tag ||
    release.name !== `Palboo ${plan.tag}` ||
    release.prerelease !== plan.prerelease ||
    owner.schema !== 1 ||
    owner.commit !== candidate.commit ||
    owner.runId !== candidate.runId ||
    owner.notes !== digest(notes) ||
    !/^[a-f0-9]{64}$/.test(owner.sha256 || '')
  )
    throw new Error('现有草稿与候选身份或说明不一致，保留原对象并停止');
}
function checkDraft(release, candidate, plan, notes) {
  if (
    !Number.isSafeInteger(release?.id) ||
    !release.draft ||
    release.tag_name !== plan.tag ||
    release.target_commitish !== candidate.commit ||
    release.name !== `Palboo ${plan.tag}` ||
    release.prerelease !== plan.prerelease ||
    release.body !== draftBody(candidate, notes)
  )
    throw new Error('草稿不属于本次已验证候选，保留原对象并停止');
}
function checkAsset(asset, candidate) {
  if (
    !Number.isSafeInteger(asset?.id) ||
    asset.name !== candidate.name ||
    asset.state !== 'uploaded' ||
    asset.size !== candidate.bytes.length ||
    asset.digest !== `sha256:${candidate.sha256}`
  )
    throw new Error('远端 DMG 的名称、大小、状态或 SHA-256 不一致');
  return asset;
}
async function releaseAssets(api, id) {
  return api.list(`releases/${id}/assets`);
}
async function checkedPublished(api, release, candidate, plan, notes) {
  if (
    release.draft ||
    !release.published_at ||
    release.tag_name !== plan.tag ||
    release.name !== `Palboo ${plan.tag}` ||
    release.body !== notes ||
    release.prerelease !== plan.prerelease
  )
    throw new Error('公开 Release 与已审核说明或版本不一致，保留原对象');
  await checkTag(api, plan.tag, candidate.commit, true);
  const assets = await releaseAssets(api, release.id);
  if (assets.length !== 1) throw new Error('公开 Release 附件数量不一致，保留原对象');
  checkAsset(assets[0], candidate);
  if (!plan.prerelease && (await api.request('GET', 'releases/latest')).id !== release.id)
    throw new Error('新稳定版未成为 Latest，保留远端状态供检查');
  return assets[0];
}

export async function publishCandidate(api, candidate, plan, notes, record = () => {}) {
  await checkTag(api, plan.tag, candidate.commit);
  let release = await findRelease(api, plan.tag);
  if (release && !release.draft) {
    const asset = await checkedPublished(api, release, candidate, plan, notes);
    record({ status: 'published', releaseId: release.id, assetId: asset.id });
    return release;
  }
  const currentMain = async () => {
    if ((await api.request('GET', 'commits/main')).sha !== candidate.publisher)
      throw new Error('main 已更新，保留候选与草稿；由新 main 检查后恢复');
  };
  await currentMain();
  if (!release) {
    try {
      release = await api.request('POST', 'releases', {
        tag_name: plan.tag,
        target_commitish: candidate.commit,
        name: `Palboo ${plan.tag}`,
        body: draftBody(candidate, notes),
        draft: true,
        prerelease: plan.prerelease,
      });
    } catch (error) {
      release = await findRelease(api, plan.tag);
      if (!release) throw error;
    }
  }
  checkDraft(release, candidate, plan, notes);
  record({ status: 'draft', releaseId: release.id });
  let assets = await releaseAssets(api, release.id);
  if (assets.length > 1 || assets.some((asset) => asset.name !== candidate.name))
    throw new Error('草稿含未知附件，保留原对象并停止');
  // GitHub 502 可能留下空 starter，仅清理仍属于本候选草稿的该空附件。
  if (assets[0]?.state === 'starter' && assets[0].size === 0) {
    checkDraft(await api.request('GET', `releases/${release.id}`), candidate, plan, notes);
    const starter = assets[0];
    try {
      await api.request('DELETE', `releases/assets/${starter.id}`);
    } catch (error) {
      if ((await releaseAssets(api, release.id)).some((asset) => asset.id === starter.id))
        throw error;
    }
    assets = await releaseAssets(api, release.id);
  }
  if (!assets.length) {
    checkDraft(await api.request('GET', `releases/${release.id}`), candidate, plan, notes);
    try {
      await api.request(
        'POST',
        `releases/${release.id}/assets?name=${encodeURIComponent(candidate.name)}`,
        candidate.bytes,
        { upload: true },
      );
    } catch (error) {
      assets = await releaseAssets(api, release.id);
      if (assets.length !== 1) throw error;
      try {
        checkAsset(assets[0], candidate);
      } catch {
        throw error;
      }
    }
  }
  assets = await releaseAssets(api, release.id);
  if (assets.length !== 1) throw new Error('草稿附件数量不一致');
  const asset = checkAsset(assets[0], candidate);
  record({ status: 'uploaded', assetId: asset.id });
  await currentMain();
  await checkTag(api, plan.tag, candidate.commit);
  release = await api.request('GET', `releases/${release.id}`);
  if (release.draft) {
    checkDraft(release, candidate, plan, notes);
    record({ status: 'publishing' });
    try {
      await api.request('PATCH', `releases/${release.id}`, {
        draft: false,
        body: notes,
        make_latest: plan.prerelease ? 'false' : 'true',
      });
    } catch (error) {
      // 请求可能已成功；这里没有 Release DELETE，也不重发公开请求。
      release = await api.request('GET', `releases/${release.id}`);
      if (release.draft) throw error;
    }
  }
  release = await api.request('GET', `releases/${release.id}`);
  await checkedPublished(api, release, candidate, plan, notes);
  record({ status: 'published', releaseId: release.id, assetId: asset.id });
  return release;
}

export async function preflight(api, context, plan, root) {
  checkCandidateHistory(root, context.publisher, context.publisher);
  const candidate = context.recovery
    ? await checkedBuild(api, context)
    : { ...context, commit: context.publisher };
  checkCandidateHistory(root, candidate.commit, context.publisher);
  const existing = await findRelease(api, plan.tag);
  if (existing && !existing.draft)
    return { ...candidate, publish: false, reason: '版本已发布，保留原 Release' };
  if ((await api.request('GET', 'commits/main')).sha !== context.publisher)
    return { ...candidate, publish: false, reason: 'main 已更新，本次仅保留验证结果' };
  if (existing)
    checkPlannedDraft(existing, candidate, plan, readFileSync(join(root, plan.notes), 'utf8'));
  await checkTag(api, plan.tag, candidate.commit);
  return { ...candidate, publish: true };
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const context = releaseContext(process.env);
  const plan = validateRelease(root);
  const notes = readFileSync(join(root, plan.notes), 'utf8');
  const api = githubClient({ token: process.env.GH_TOKEN });
  const directory = join(root, 'target/reports');
  mkdirSync(directory, { recursive: true });
  let receipt = {
    version: plan.version,
    publisher: context.publisher,
    runId: context.runId,
    notesSha256: digest(notes),
  };
  const record = (event) => {
    receipt = { ...receipt, ...event };
    writeFileSync(join(directory, 'publication.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(`Release ${plan.tag}: ${event.status || 'checked'}`);
  };
  if (process.argv.includes('--preflight')) {
    const result = await preflight(api, context, plan, root);
    writeFileSync(
      join(directory, 'release-preflight.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `publish=${result.publish}\nrun-id=${result.runId}\nartifact-id=${result.artifactId || ''}\n`,
      );
    console.log(result.reason || `发布预检查通过：${plan.tag}`);
    return;
  }
  try {
    const candidate = await checkedBuild(api, context);
    checkCandidateHistory(root, candidate.commit, context.publisher);
    if (!context.recovery && candidate.commit !== context.publisher)
      throw new Error('同次构建修订不一致');
    const artifact = checkedDmg(root, plan, candidate);
    record({
      status: 'verified',
      commit: candidate.commit,
      artifactId: candidate.artifactId,
      sha256: artifact.sha256,
    });
    await publishCandidate(api, artifact, plan, notes, record);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `已发布 [Palboo ${plan.tag}](https://github.com/0xTotoroX/palboo/releases/tag/${plan.tag})；候选 ${candidate.commit}，构建 run ${candidate.runId}。\n`,
      );
  } catch (error) {
    record({ status: 'failed', lastPhase: receipt.status, error: error.message });
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
