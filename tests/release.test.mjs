/*
 * [INPUT]: 发布状态机、真实 HTTP 适配器、有状态的隔离 GitHub 替身及临时 Git 仓库。
 * [OUTPUT]: 中断续接、公开不可修改、只读重试、候选来源和产物完整性回归。
 * [POS]: Linux 预检查与完整 Node 验收共用；无真实网络、凭据或远端写入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { githubClient, repository } from '../scripts/release-api.mjs';
import {
  releaseContext,
  checkedBuild,
  checkCandidateHistory,
  checkedDmg,
  digest,
} from '../scripts/release-candidate.mjs';
import { publishCandidate, checkTag, preflight } from '../scripts/release.mjs';
import { releasePlan, validateRelease } from '../scripts/release-plan.mjs';

const sha = 'a'.repeat(40),
  newer = 'b'.repeat(40);
const plan = releasePlan('1.6.0');
const notes = '### Fixes\n\nReviewed content.\n';
const candidate = {
  publisher: sha,
  commit: sha,
  currentRun: '11',
  runId: '11',
  recovery: false,
  name: plan.assets[0].slice(5),
  bytes: Buffer.from('verified synthetic DMG'),
};
candidate.sha256 = digest(candidate.bytes);

function service(options = {}) {
  const tag = options.tagName || plan.tag;
  const state = {
    release: null,
    assets: [],
    tag: null,
    main: sha,
    requests: [],
    sleeps: [],
    ...options,
  };
  const response = (body, status = 200, headers = {}) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const fetcher = async (url, init) => {
    const parsed = new URL(url);
    assert.ok(['api.github.com', 'uploads.github.com'].includes(parsed.hostname));
    assert.equal(init.headers.Authorization, 'Bearer fixture');
    const path = parsed.pathname.replace(`/repos/${repository}/`, '');
    const method = init.method;
    const body =
      init.body && (parsed.hostname === 'uploads.github.com' ? init.body : JSON.parse(init.body));
    state.requests.push({ method, path });
    if (state.readFailures > 0 && method === 'GET') {
      state.readFailures--;
      return response({}, 503, { 'retry-after': '0' });
    }
    if (method === 'GET') {
      if (path === 'commits/main') return response({ sha: state.main });
      if (path === `git/ref/tags/${tag}`)
        return state.tag
          ? response({
              object: {
                type: state.annotated ? 'tag' : 'commit',
                sha: state.annotated ? newer : state.tag,
              },
            })
          : response({}, 404);
      if (path === `commits/${tag}`)
        return state.tag && !state.missingCommit ? response({ sha: state.tag }) : response({}, 422);
      if (path === `releases/tags/${tag}`)
        return state.release && !state.release.draft ? response(state.release) : response({}, 404);
      if (path === 'releases') return response(state.release ? [state.release] : []);
      if (path === 'releases/7/assets') return response(state.assets);
      if (path === 'releases/7' || path === 'releases/latest') return response(state.release);
      if (path === 'actions/runs/11')
        return response(
          state.run || {
            id: 11,
            repository: { full_name: repository },
            head_repository: { full_name: repository },
            head_branch: 'main',
            path: '.github/workflows/ci.yml',
            event: 'push',
            status: 'completed',
            head_sha: sha,
          },
        );
      if (path === 'actions/runs/11/jobs')
        return response({
          jobs: state.jobs || [
            {
              name: 'Build and check App',
              conclusion: 'success',
              steps: [
                'Verify',
                'Check embedded glass',
                'Package verified App',
                'Save App and build identity',
              ].map((name) => ({ name, conclusion: 'success' })),
            },
          ],
        });
      if (path === 'actions/runs/11/artifacts')
        return response({
          artifacts: state.artifacts || [
            {
              id: 99,
              name: 'palboo-macos',
              expired: false,
              size_in_bytes: 100,
              workflow_run: { head_sha: sha },
            },
          ],
        });
    }
    if (method === 'POST' && path === 'releases') {
      assert.equal(state.release, null, 'must reconcile existing drafts before creating');
      if (state.rejectCreate) return response({}, 503);
      state.release = { ...body, id: 7, published_at: null };
      if (state.loseCreate) {
        state.loseCreate = false;
        throw new Error('lost creation response');
      }
      return response(state.release, 201);
    }
    if (method === 'POST' && path === 'releases/7/assets') {
      assert.equal(state.release.draft, true);
      assert.equal(state.assets.length, 0, 'never overwrite an asset');
      state.assets = [
        {
          id: 8,
          name: parsed.searchParams.get('name'),
          state: 'uploaded',
          size: body.length,
          digest: `sha256:${digest(body)}`,
        },
      ];
      if (state.starter) {
        state.starter = false;
        state.assets[0].state = 'starter';
        state.assets[0].size = 0;
        return response({}, 502);
      }
      if (state.advanceMain) state.main = newer;
      if (state.loseUpload) {
        state.loseUpload = false;
        throw new Error('lost upload response');
      }
      return response(state.assets[0], 201);
    }
    if (method === 'DELETE' && path === 'releases/assets/8') {
      assert.equal(state.release.draft, true, 'never mutate published assets');
      assert.equal(state.assets[0].state, 'starter');
      state.assets = [];
      return response(null, 204);
    }
    if (method === 'PATCH' && path === 'releases/7') {
      assert.equal(state.release.draft, true, 'never patch a published release');
      if (state.rejectPublish) return response({}, 503);
      state.release = { ...state.release, ...body, published_at: '2026-11-08T00:00:00Z' };
      state.tag = state.release.target_commitish;
      if (state.losePublish) {
        state.losePublish = false;
        throw new Error('lost publication response');
      }
      return response(state.release);
    }
    assert.fail(`Unexpected request: ${method} ${path}`);
  };
  return {
    state,
    api: githubClient({ token: 'fixture', fetcher, sleep: async (ms) => state.sleeps.push(ms) }),
    snapshot: () => copy({ release: state.release, assets: state.assets, tag: state.tag }),
  };
}
const writes = (state) => state.requests.filter((request) => request.method !== 'GET');

test('publication uploads a checked draft, publishes exact reviewed notes, and reruns without writes', async () => {
  const { api, state, snapshot } = service();
  await publishCandidate(api, candidate, plan, notes);
  assert.equal(state.release.draft, false);
  assert.equal(state.release.body, notes);
  assert.equal(state.release.make_latest, 'true');
  assert.equal(state.tag, candidate.commit);
  assert.deepEqual(
    writes(state).map(({ method, path }) => `${method} ${path}`),
    ['POST releases', 'POST releases/7/assets', 'PATCH releases/7'],
  );
  const before = snapshot();
  state.requests = [];
  await publishCandidate(api, candidate, plan, notes);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(writes(state), []);
});

test('prereleases retain their identity and do not become the latest stable release', async () => {
  const preview = releasePlan('1.6.1-beta.1');
  const { api, state } = service({ tagName: preview.tag });
  await publishCandidate(api, { ...candidate, name: preview.assets[0].slice(5) }, preview, notes);
  assert.equal(state.release.prerelease, true);
  assert.equal(state.release.tag_name, preview.tag);
  assert.equal(state.release.make_latest, 'false');
  assert.ok(!state.requests.some(({ path }) => path === 'releases/latest'));
});

test('lost responses after creation, upload and publication reconcile without duplicate writes or Release deletion', async () => {
  for (const failure of ['loseCreate', 'loseUpload', 'losePublish']) {
    const { api, state } = service({ [failure]: true });
    await publishCandidate(api, candidate, plan, notes);
    assert.equal(state.release.draft, false);
    assert.equal(writes(state).length, 3, failure);
    assert.ok(!writes(state).some(({ method }) => method === 'DELETE'));
  }
});

test('process interruptions after draft or upload resume the same Release and never repeat completed stages', async () => {
  for (const stage of ['draft', 'uploaded']) {
    const { api, state } = service();
    await assert.rejects(
      publishCandidate(api, candidate, plan, notes, ({ status }) => {
        if (status === stage) throw new Error('simulated process exit');
      }),
      /simulated process exit/,
    );
    assert.equal(state.release.draft, true);
    await publishCandidate(api, candidate, plan, notes);
    assert.equal(state.release.draft, false);
    assert.equal(writes(state).filter(({ path }) => path === 'releases').length, 1);
    assert.equal(writes(state).filter(({ path }) => path === 'releases/7/assets').length, 1);
  }
});

test('failed publication preserves its uploaded draft and retries only the unfinished publication', async () => {
  const { api, state } = service({ rejectPublish: true });
  await assert.rejects(publishCandidate(api, candidate, plan, notes), /HTTP 503/);
  assert.equal(state.release.draft, true);
  assert.equal(state.assets.length, 1);
  state.rejectPublish = false;
  state.requests = [];
  await publishCandidate(api, candidate, plan, notes);
  assert.deepEqual(writes(state), [{ method: 'PATCH', path: 'releases/7' }]);
});

test('failed upload can recover its owned empty starter without deleting a Release', async () => {
  const { api, state } = service({ starter: true });
  await assert.rejects(publishCandidate(api, candidate, plan, notes), /HTTP 502/);
  assert.equal(state.assets[0].state, 'starter');
  state.requests = [];
  await publishCandidate(api, candidate, plan, notes);
  assert.equal(state.release.draft, false);
  assert.deepEqual(
    writes(state).filter(({ method }) => method === 'DELETE'),
    [{ method: 'DELETE', path: 'releases/assets/8' }],
  );
});

test('foreign drafts, altered assets and published mismatches are preserved with no mutation', async () => {
  for (const edit of [
    (state) => {
      state.release.body = 'Unknown draft';
    },
    (state) => {
      state.release.target_commitish = newer;
    },
    (state) => {
      state.assets[0].digest = `sha256:${'0'.repeat(64)}`;
    },
    (state) => {
      state.assets[0].name = 'unexpected.dmg';
    },
    (state) => {
      state.release.draft = false;
      state.release.published_at = 'now';
      state.tag = sha;
    },
  ]) {
    const { api, state, snapshot } = service();
    await assert.rejects(
      publishCandidate(api, candidate, plan, notes, ({ status }) => {
        if (status === 'uploaded') throw new Error('stop');
      }),
    );
    edit(state);
    state.requests = [];
    const before = snapshot();
    await assert.rejects(publishCandidate(api, candidate, plan, notes));
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(writes(state), []);
  }
});

test('main advancing during upload prevents publication and leaves recoverable verified bytes', async () => {
  const { api, state } = service({ advanceMain: true });
  await assert.rejects(publishCandidate(api, candidate, plan, notes), /main 已更新/);
  assert.equal(state.release.draft, true);
  assert.ok(!writes(state).some(({ method }) => method === 'PATCH'));
  state.requests = [];
  await publishCandidate(api, { ...candidate, publisher: newer }, plan, notes);
  assert.equal(state.tag, sha, 'recovery tags the product candidate, not the publisher');
  assert.deepEqual(writes(state), [{ method: 'PATCH', path: 'releases/7' }]);
});

test('missing tag uses ref 404, annotated tags resolve, conflicts and disappearing commits stop before writes', async () => {
  const absent = service();
  await checkTag(absent.api, plan.tag, sha);
  assert.ok(!absent.state.requests.some(({ path }) => path === `commits/${plan.tag}`));
  for (const annotated of [false, true])
    await checkTag(service({ tag: sha, annotated }).api, plan.tag, sha);
  for (const options of [{ tag: newer }, { tag: sha, missingCommit: true }]) {
    const { api, state } = service(options);
    await assert.rejects(publishCandidate(api, candidate, plan, notes));
    assert.deepEqual(writes(state), []);
  }
});

test('GET retries are bounded and preserve status semantics; POST never retries implicitly', async () => {
  const read = service({ readFailures: 2 });
  await read.api.request('GET', 'commits/main');
  assert.equal(read.state.requests.length, 3);
  assert.deepEqual(read.state.sleeps, [0, 0]);
  const exhausted = service({ readFailures: 3 });
  await assert.rejects(exhausted.api.request('GET', 'commits/main'), /HTTP 503/);
  assert.equal(exhausted.state.requests.length, 3);
  const write = service({ rejectCreate: true });
  await assert.rejects(write.api.request('POST', 'releases', {}), /HTTP 503/);
  assert.equal(write.state.requests.length, 1);
  for (const status of [401, 403, 422, 404, 429]) {
    let requests = 0;
    const api = githubClient({
      token: 'fixture',
      fetcher: async () => {
        requests++;
        return new Response('{}', { status, headers: { 'retry-after': '120' } });
      },
      sleep: async () => assert.fail('must not retry'),
    });
    await assert.rejects(api.request('GET', 'releases'), new RegExp(`HTTP ${status}`));
    assert.equal(requests, 1);
  }
});

test('recovery requires an official main build, every release gate, and one unexpired artifact with matching provenance', async () => {
  const good = service();
  assert.equal((await checkedBuild(good.api, candidate)).artifactId, 99);
  const baseRun = await good.api.request('GET', 'actions/runs/11');
  for (const run of [
    { ...baseRun, repository: { full_name: 'someone/fork' } },
    { ...baseRun, head_repository: { full_name: 'someone/fork' } },
    { ...baseRun, head_branch: 'feature' },
    { ...baseRun, event: 'pull_request' },
    { ...baseRun, path: '.github/workflows/site.yml' },
    { ...baseRun, status: 'in_progress' },
  ])
    await assert.rejects(checkedBuild(service({ run }).api, { ...candidate, currentRun: '12' }));
  for (const jobs of [
    [],
    [{ name: 'Build and check App', conclusion: 'failure', steps: [] }],
    [
      {
        name: 'Build and check App',
        conclusion: 'success',
        steps: [{ name: 'Verify', conclusion: 'success' }],
      },
    ],
  ])
    await assert.rejects(checkedBuild(service({ jobs }).api, candidate));
  const artifact = (await good.api.list('actions/runs/11/artifacts', 'artifacts'))[0];
  for (const artifacts of [
    [],
    [artifact, artifact],
    [{ ...artifact, expired: true }],
    [{ ...artifact, workflow_run: { head_sha: newer } }],
  ])
    await assert.rejects(checkedBuild(service({ artifacts }).api, candidate));
});

test('event boundaries reject fork, PR, non-main and injected recovery IDs', () => {
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: repository,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '11',
  };
  assert.equal(releaseContext(env).recovery, false);
  assert.equal(
    releaseContext({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', PALBOO_RELEASE_RUN_ID: '10' })
      .runId,
    '10',
  );
  for (const edit of [
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_REPOSITORY: 'someone/fork' },
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_SHA: 'main' },
    { GITHUB_RUN_ID: '' },
    { PALBOO_RELEASE_RUN_ID: '10' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', PALBOO_RELEASE_RUN_ID: '10\npublish=true' },
  ])
    assert.throws(() => releaseContext({ ...env, ...edit }));
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'palboo-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, content) => {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), content);
  };
  put('package.json', JSON.stringify({ version: plan.version }));
  put(
    'package-lock.json',
    JSON.stringify({ version: plan.version, packages: { '': { version: plan.version } } }),
  );
  put('Cargo.toml', `[package]\nversion = "${plan.version}"\n`);
  put('Cargo.lock', `[[package]]\nname = "palboo"\nversion = "${plan.version}"\n`);
  put(`.github/release-notes/${plan.tag}.md`, notes);
  put('.github/workflows/ci.yml', 'original workflow');
  put('src/main.rs', 'product');
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-qm',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const original = commit();
  return { root, put, git, commit, original };
}

test('publisher fixes may reuse an ancestor; product, workflow, version, notes and build changes require new verification', (t) => {
  const f = fixture(t);
  f.put('scripts/release.mjs', 'publisher fix');
  const publisher = f.commit();
  checkCandidateHistory(f.root, f.original, publisher);
  assert.throws(() => checkCandidateHistory(f.root, f.original, f.original), /checkout/);
  for (const path of [
    'src/main.rs',
    '.github/workflows/ci.yml',
    'package.json',
    `.github/release-notes/${plan.tag}.md`,
    'scripts/verify.mjs',
  ]) {
    const g = fixture(t);
    g.put(path, 'changed');
    const updated = g.commit();
    assert.throws(() => checkCandidateHistory(g.root, g.original, updated), /需要新的完整构建/);
  }
});

test('moving a product file into an allowed test path still requires full verification', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'tests'));
  f.git('mv', 'src/main.rs', 'tests/main.rs');
  const publisher = f.commit();
  assert.throws(() => checkCandidateHistory(f.root, f.original, publisher), /需要新的完整构建/);
});

test('version, notes, packaged checks and actual bytes are validated before any publication', (t) => {
  const f = fixture(t);
  const metadata = {
    version: plan.version,
    commit: sha,
    artifact: plan.assets[0],
    sha256: candidate.sha256,
    app: { passed: true },
    image: { bytes: candidate.bytes.length, relocated: true },
  };
  f.put(plan.assets[0], candidate.bytes);
  f.put('target/reports/package.json', JSON.stringify(metadata));
  assert.equal(validateRelease(f.root).version, plan.version);
  assert.equal(checkedDmg(f.root, plan, candidate).sha256, candidate.sha256);
  for (const edit of [
    { commit: newer },
    { version: '9.0.0' },
    { app: { passed: false } },
    { sha256: '0'.repeat(64) },
  ]) {
    f.put('target/reports/package.json', JSON.stringify({ ...metadata, ...edit }));
    assert.throws(() => checkedDmg(f.root, plan, candidate));
  }
  f.put('target/reports/package.json', JSON.stringify(metadata));
  f.put(plan.assets[0], 'altered');
  assert.throws(() => checkedDmg(f.root, plan, candidate));
  rmSync(join(f.root, plan.assets[0]));
  assert.throws(() => checkedDmg(f.root, plan, candidate));
  f.put('Cargo.lock', '[[package]]\nname = "palboo"\nversion = "9.0.0"\n');
  assert.throws(() => validateRelease(f.root), /版本不一致/);
  f.put('Cargo.lock', `[[]]`);
  assert.throws(() => validateRelease(f.root));
  rmSync(join(f.root, `.github/release-notes/${plan.tag}.md`));
  assert.throws(() => validateRelease(f.root));
});

test('read-only preflight skips existing versions and superseded main without writes', async (t) => {
  const f = fixture(t);
  for (const state of [{ main: newer }, { release: { id: 7, tag_name: plan.tag, draft: false } }]) {
    const s = service(state);
    const result = await preflight(s.api, { ...candidate, publisher: f.original }, plan, f.root);
    assert.equal(result.publish, false);
    assert.deepEqual(writes(s.state), []);
  }
});

test('recovery preflight selects the verified ancestor and publication keeps its tag identity', async (t) => {
  const f = fixture(t);
  f.put('scripts/release.mjs', 'new publication tool');
  const publisher = f.commit();
  const s = service({ main: publisher });
  s.state.run = {
    ...(await s.api.request('GET', 'actions/runs/11')),
    head_sha: f.original,
    conclusion: 'failure',
  };
  s.state.artifacts = [
    {
      id: 99,
      name: 'palboo-macos',
      expired: false,
      size_in_bytes: 100,
      workflow_run: { head_sha: f.original },
    },
  ];
  const context = { publisher, currentRun: '12', runId: '11', recovery: true };
  const configured = validateRelease(f.root);
  const selected = await preflight(s.api, context, configured, f.root);
  assert.equal(selected.publish, true);
  assert.equal(selected.commit, f.original);
  assert.equal(selected.artifactId, 99);
  assert.deepEqual(writes(s.state), []);
  await publishCandidate(s.api, { ...candidate, ...selected }, configured, notes);
  assert.equal(s.state.tag, f.original);
  assert.notEqual(s.state.tag, publisher);
});

test('preflight rejects unrelated drafts before the expensive build and accepts its own interrupted draft', async (t) => {
  const f = fixture(t),
    configured = validateRelease(f.root);
  const current = { ...candidate, commit: f.original, publisher: f.original };
  const s = service({ main: f.original });
  await assert.rejects(
    publishCandidate(s.api, current, configured, notes, ({ status }) => {
      if (status === 'draft') throw new Error('interrupted');
    }),
  );
  s.state.requests = [];
  assert.equal((await preflight(s.api, current, configured, f.root)).publish, true);
  s.state.release.body = 'unrelated draft';
  await assert.rejects(preflight(s.api, current, configured, f.root), /未知来源草稿/);
  assert.deepEqual(writes(s.state), []);
});
