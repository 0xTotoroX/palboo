/*
 * [INPUT]: 本机宿主的聊天分页、CodexHost 持久 CLI 归属、运行状态与原生归档接口。
 * [OUTPUT]: 各 CLI 数量、短时归档预览、按需返回的会话资料及实际结果统计。
 * [POS]: 当前桌面连接内的批量归档，不读聊天正文或直接操作宿主存储。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { loadedRuntime, nativeScope } from './side-chat-native.js';
import {
  archiveTimestamp,
  normalizeArchiveFilters,
  resolveArchiveProject,
  selectArchiveChats,
  NO_PROJECT,
} from './chat-archive-filters.js';

const unsupported = () => Error('当前 ChatGPT 桌面版无法批量归档本地聊天。');
const changed = () => Error('本地聊天或连接已变化，请重新预览。');
const incomplete = () => Error('无法完整读取本地聊天，请重试。');
const unknownOwner = () => Error('无法确认 CodexHost 聊天的 CLI 归属，请重试。');
const missingProjects = () => Error('无法读取本机项目归属，请重试。');
const missingProtection = () => Error('无法确认置顶和运行状态，请重试。');
const planLifetime = 5 * 60_000;
const batchSize = 8;
// Both thread/list and ownership/list accept at most 100 items per request.
const pageSize = 100;

async function connect() {
  const runtime = await loadedRuntime().catch(() => {
    throw unsupported();
  });
  const scope = [
    '[data-app-action-sidebar-thread-row]',
    'aside.app-shell-left-panel',
    '[data-app-shell-active-page="true"]',
  ]
    .map((selector) => document.querySelector(selector))
    .reduce(
      (found, element) =>
        found ?? nativeScope(element, (value) => typeof value.query?.fetch === 'function'),
      null,
    );
  const host = runtime.c.Dgwo?.exports;
  const accounts = runtime.c.SPnB?.exports;
  const runtimeStatus = runtime.c.tl5a?.exports?.F9;
  const automations = runtime.c.qKlE?.exports?.Pu;
  const appServerPins = runtime.c.ay73?.exports?.XF;
  const services = runtime.c.GaA7?.exports?.appServices;
  const readState = runtime.c.Wbxh?.exports?.Ts;
  if (
    !scope ||
    !host?.V ||
    !accounts?.chatGptAuthenticatedAccountId$ ||
    !accounts.chatGptAuthenticatedUserId$ ||
    !runtimeStatus ||
    !automations ||
    !appServerPins
  )
    throw unsupported();
  const manager = host.V(scope, 'local');
  if (
    typeof manager?.sendRequest !== 'function' ||
    typeof manager.archiveConversation !== 'function'
  )
    throw unsupported();
  const readIdentity = () => [
    scope.get(accounts.chatGptAuthenticatedAccountId$),
    scope.get(accounts.chatGptAuthenticatedUserId$),
  ];
  const identity = readIdentity();
  const sameAccount = () => {
    const current = readIdentity();
    return identity.every((value, index) => value === current[index]);
  };
  return {
    identity,
    sameAccount,
    list: (cursor, externalOnly, archived = false) =>
      manager.sendRequest(
        'thread/list',
        {
          archived,
          // CodexHost 0.23 forwards an unrecognized currentAccountOnly to stock
          // Codex. Use a separate provider-only query for external chats.
          ...(externalOnly
            ? { modelProviders: ['codexhost'] }
            : { currentAccountOnly: true, modelProviders: [] }),
          limit: pageSize,
          cursor,
          sortKey: 'created_at',
        },
        { source: 'thread_list', timeoutMs: 8_000 },
      ),
    ownership: (threadIds) =>
      manager.sendRequest('codexhost/thread/ownership/list', { threadIds }, { timeoutMs: 8_000 }),
    async read(id) {
      const result = await manager.sendRequest(
        'thread/read',
        { threadId: id, includeTurns: false },
        { timeoutMs: 8_000 },
      );
      return result?.thread;
    },
    async projectMetadata() {
      if (
        typeof services?.projectCatalog?.readLocalProjects !== 'function' ||
        typeof services?.threadProjectAssignments?.readMemberships !== 'function' ||
        typeof readState !== 'function'
      )
        return null;
      const [local, membership, serverIds] = await Promise.all([
        services.projectCatalog.readLocalProjects(),
        services.threadProjectAssignments.readMemberships(),
        readState('app-server-project-id-by-legacy-project-id-by-host'),
      ]);
      if (
        !local ||
        typeof local !== 'object' ||
        Array.isArray(local) ||
        !membership?.assignments ||
        !Array.isArray(membership.projectlessThreadIds)
      )
        throw missingProjects();
      const projects = new Map();
      for (const project of Object.values(local)) {
        if (
          typeof project?.id !== 'string' ||
          !project.id ||
          project.id === NO_PROJECT ||
          typeof project.name !== 'string' ||
          !Array.isArray(project.rootPaths) ||
          project.rootPaths.some((root) => typeof root !== 'string' || !root.startsWith('/')) ||
          projects.has(project.id)
        )
          throw missingProjects();
        projects.set(project.id, { label: project.name || project.id, roots: project.rootPaths });
      }
      const aliases = new Map();
      for (const [id, server] of Object.entries(serverIds?.value?.local ?? {})) {
        if (!projects.has(id) || typeof server !== 'string') continue;
        if (aliases.has(server)) throw missingProjects();
        aliases.set(server, id);
      }
      return {
        projects,
        aliases,
        assignments: membership.assignments,
        projectless: new Set(membership.projectlessThreadIds),
      };
    },
    async pinned() {
      if (typeof services?.pinnedThreads?.list !== 'function') throw missingProtection();
      const pins = await services.pinnedThreads.list({
        useAppServerPins: scope.get(appServerPins),
      });
      if (!Array.isArray(pins?.threadIds) || pins.threadIds.some((id) => typeof id !== 'string'))
        throw missingProtection();
      return new Set(pins.threadIds);
    },
    async scheduled(protect = false) {
      const result = await scope.query.fetch(automations);
      if (!Array.isArray(result?.items)) throw unsupported();
      return new Set(
        result.items.flatMap((item) =>
          (item?.status === 'ACTIVE' || (protect && item?.status === 'PAUSED')) &&
          typeof item.targetThreadId === 'string'
            ? [item.targetThreadId]
            : [],
        ),
      );
    },
    active(thread) {
      const status = scope.get(runtimeStatus, thread.id);
      return status?.type === 'active' || thread.status?.type === 'active';
    },
    idle(thread) {
      const status = scope.get(runtimeStatus, thread.id) ?? thread.status;
      return ['idle', 'notLoaded'].includes(status?.type) && !status?.activeFlags?.length;
    },
    archive: (id) =>
      manager.archiveConversation(id, {
        useAppServerPins: scope.get(appServerPins),
        cleanupWorktree: false,
        source: 'project_archive',
      }),
  };
}

async function listThreads(host, current, externalOnly, archived = false) {
  const threads = new Map();
  const cursors = new Set();
  const started = Date.now();
  let cursor = null;
  do {
    if (!current()) throw changed();
    if (Date.now() - started > 20_000) throw Error('读取本地聊天超时，请重试。');
    const page = await host.list(cursor, externalOnly, archived);
    if (
      !Array.isArray(page?.data) ||
      (page.nextCursor != null &&
        (typeof page.nextCursor !== 'string' || !page.nextCursor || cursors.has(page.nextCursor)))
    )
      throw incomplete();
    for (const thread of page.data) {
      if (typeof thread?.id !== 'string' || !thread.id || threads.has(thread.id))
        throw incomplete();
      threads.set(thread.id, thread);
    }
    cursor = page.nextCursor ?? null;
    cursors.add(cursor);
  } while (cursor !== null);

  return threads;
}

const isExternal = (thread) =>
  thread.modelProvider === 'codexhost' && thread.cliVersion === 'codexhost';
const isMainChat = (thread) =>
  thread.ephemeral !== true &&
  thread.attachedToThreadId == null &&
  (!isExternal(thread) || thread.parentThreadId == null);

async function catalog(host, current) {
  const [native, external] = await Promise.all([
    listThreads(host, current, false),
    listThreads(host, current, true),
  ]);
  for (const [id, thread] of external) {
    if (!isExternal(thread)) continue;
    if (native.has(id) && !isExternal(native.get(id))) throw unknownOwner();
    native.set(id, thread);
  }
  const threads = Array.from(native.values()).filter(isMainChat);
  const ids = threads.filter(isExternal).map(({ id }) => id);
  const ownership = new Map();
  for (let start = 0; start < ids.length; start += pageSize) {
    if (!current()) throw changed();
    const threadIds = ids.slice(start, start + pageSize);
    const result = await host.ownership(threadIds).catch(() => {
      throw unknownOwner();
    });
    if (!Array.isArray(result?.threads) || result.threads.length !== threadIds.length)
      throw unknownOwner();
    const expected = new Set(threadIds);
    for (const record of result.threads) {
      const cli = record?.harnessId;
      if (
        !expected.delete(record?.threadId) ||
        record.owner !== 'external' ||
        typeof cli !== 'string' ||
        !cli.trim() ||
        cli.length > 256 ||
        cli === 'codex'
      )
        throw unknownOwner();
      ownership.set(record.threadId, cli);
    }
  }
  if (!current()) throw changed();
  return threads.map((thread) => ({ cli: ownership.get(thread.id) ?? 'codex', thread }));
}

function inventory(chats, metadata) {
  const counts = new Map();
  for (const { cli } of chats) counts.set(cli, (counts.get(cli) ?? 0) + 1);
  const projects = new Map();
  let unresolvedProjects = 0;
  for (const { project } of chats) {
    if (project != null) projects.set(project, (projects.get(project) ?? 0) + 1);
    else unresolvedProjects += 1;
  }
  return {
    total: chats.length,
    groups: Array.from(counts, ([cli, count]) => ({ cli, count })).sort((left, right) =>
      left.cli === 'codex' ? -1 : right.cli === 'codex' ? 1 : left.cli.localeCompare(right.cli),
    ),
    ...(metadata
      ? {
          unresolvedProjects,
          projects: Array.from(projects, ([id, count]) => ({
            id,
            count,
            label: metadata.projects.get(id)?.label ?? null,
          })),
        }
      : {}),
  };
}

async function snapshot(host, current, chats, cli, filters) {
  const { selected, groups, kept } = selectArchiveChats(chats, cli, filters);
  const [scheduled, pinned] = selected.length
    ? await Promise.all([
        host.scheduled(filters.protect),
        filters.protect ? host.pinned() : new Set(),
      ])
    : [new Set(), new Set()];
  if (!current()) throw changed();
  const threads = selected
    .map(({ thread, cli, project, updated }) => ({
      id: thread.id,
      cli,
      project,
      updated: updated ?? null,
      active: host.active(thread),
      scheduled: scheduled.has(thread.id),
      protected:
        filters.protect &&
        (pinned.has(thread.id) || thread.isPinned === true || !host.idle(thread)),
    }))
    .filter(
      (thread) => !filters.protect || (!thread.active && !thread.scheduled && !thread.protected),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const affected = new Set(threads.map(({ project }) => project));
  const retained = Array.from(groups, ([project, rows]) => ({
    project,
    ids: rows
      .filter(({ thread }) => kept.has(thread.id))
      .map(({ thread }) => thread.id)
      .sort(),
  }))
    .filter(({ project }) => affected.has(project))
    .sort((a, b) => a.project.localeCompare(b.project));
  return { threads, retained };
}

function previewSessions(threads, chats, metadata) {
  const byId = new Map(chats.map(({ thread }) => [thread.id, thread]));
  return threads
    .map(({ id, cli, project, updated, active, scheduled }) => {
      const thread = byId.get(id);
      const title = [thread.name, thread.title].find(
        (value) => typeof value === 'string' && value.trim(),
      );
      return {
        id,
        cli,
        title: title?.trim().slice(0, 500) ?? null,
        project,
        projectLabel: metadata?.projects.get(project)?.label ?? null,
        created: archiveTimestamp(thread.createdAt),
        updated,
        active,
        scheduled,
      };
    })
    .sort((left, right) => (right.updated ?? 0) - (left.updated ?? 0));
}

async function verifyProtectedArchive(host, current, successful, retained, cli) {
  const [active, archivedNative, archivedExternal, metadata] = await Promise.all([
    catalog(host, current),
    cli === null || cli === 'codex' ? listThreads(host, current, false, true) : new Map(),
    cli !== 'codex' ? listThreads(host, current, true, true) : new Map(),
    host.projectMetadata(),
  ]);
  if (!metadata || !current()) throw changed();
  const remaining = new Map(
    active
      .filter((chat) => cli === null || cli === chat.cli)
      .map(({ thread }) => [thread.id, resolveArchiveProject(thread, metadata)]),
  );
  const verified =
    successful.every(
      ({ id }) => !remaining.has(id) && (archivedNative.has(id) || archivedExternal.has(id)),
    ) && retained.every(({ project, ids }) => ids.every((id) => remaining.get(id) === project));
  const affected = new Set(successful.map(({ project }) => project));
  return {
    verified,
    projects: Array.from(affected, (id) => ({
      id,
      label: metadata.projects.get(id)?.label ?? null,
      remaining: Array.from(remaining.values()).filter((project) => project === id).length,
    })),
  };
}

async function stillEligible(host, current, candidate, filters) {
  const [thread, pinned, scheduled, projects, ownership] = await Promise.all([
    host.read(candidate.id),
    host.pinned(),
    host.scheduled(true),
    host.projectMetadata(),
    candidate.cli === 'codex' ? null : host.ownership([candidate.id]),
  ]);
  if (
    !current() ||
    thread?.id !== candidate.id ||
    !isMainChat(thread) ||
    isExternal(thread) !== (candidate.cli !== 'codex') ||
    pinned.has(candidate.id) ||
    thread.isPinned === true ||
    scheduled.has(candidate.id) ||
    host.active(thread) ||
    !host.idle(thread) ||
    !projects ||
    resolveArchiveProject(thread, projects) !== candidate.project
  )
    return false;
  if (candidate.cli !== 'codex') {
    const owner = ownership?.threads?.[0];
    if (
      ownership?.threads?.length !== 1 ||
      owner?.threadId !== candidate.id ||
      owner.owner !== 'external' ||
      owner.harnessId !== candidate.cli
    )
      return false;
  }
  const { selected } = selectArchiveChats(
    [{ thread, cli: candidate.cli, project: candidate.project }],
    candidate.cli,
    { ...filters, keepRecent: 0 },
  );
  return selected.length === 1 && selected[0].updated === candidate.updated;
}

export function createLocalChatArchive({ isCurrent, resolve = connect }) {
  let pending = null;
  let busy = false;
  return async (operation, id, cli = null, input, includeSessions = false) => {
    if (!['list', 'preview', 'apply'].includes(operation)) throw unsupported();
    if (busy) throw Error('正在处理本地聊天归档，请稍候。');
    busy = true;
    try {
      if (!isCurrent()) throw changed();
      const previous = pending;
      if (operation === 'apply' && (previous?.id !== id || Date.now() > previous.expires))
        throw Error('归档预览已失效，请重新预览。');
      if (operation !== 'list') pending = null;
      const host = await resolve();
      const current = () => isCurrent() && host.sameAccount();
      if (operation === 'apply') {
        if (previous.identity.some((value, index) => value !== host.identity[index]))
          throw changed();
        cli = previous.cli;
      }
      const filters = operation === 'apply' ? previous.filters : normalizeArchiveFilters(input);
      const [raw, metadata] = await Promise.all([
        catalog(host, current),
        host.projectMetadata?.().catch(() => null),
      ]);
      if (!current()) throw changed();
      if (
        (!metadata && (filters.project !== null || filters.keepRecent || filters.protect)) ||
        (filters.project &&
          filters.project !== NO_PROJECT &&
          !metadata.projects.has(filters.project))
      )
        throw missingProjects();
      const chats = raw.map((chat) => ({
        ...chat,
        project: metadata ? resolveArchiveProject(chat.thread, metadata) : null,
      }));
      if (operation === 'list') return inventory(chats, metadata);
      const { threads, retained } = await snapshot(host, current, chats, cli, filters);
      if (operation === 'preview') {
        const id = crypto.randomUUID();
        const expires = Date.now() + planLifetime;
        pending = { id, expires, threads, retained, cli, filters, identity: host.identity };
        return {
          id,
          cli,
          ...(input && {
            filters: {
              project: filters.project,
              dateField: filters.dateField,
              from: filters.from,
              through: filters.through,
              inactiveDays: filters.inactiveDays,
              keepRecent: filters.keepRecent,
              protect: filters.protect,
            },
          }),
          ...inventory(chats, metadata),
          count: threads.length,
          running: threads.filter((thread) => thread.active).length,
          scheduled: threads.filter((thread) => thread.scheduled).length,
          ...(includeSessions && { sessions: previewSessions(threads, chats, metadata) }),
        };
      }
      if (
        JSON.stringify(previous.threads) !== JSON.stringify(threads) ||
        JSON.stringify(previous.retained) !== JSON.stringify(retained)
      )
        throw changed();

      let archived = 0;
      let failed = 0;
      const successful = [];
      const size = filters.protect ? 1 : batchSize;
      const deadline = Date.now() + 120_000;
      for (let offset = 0; offset < threads.length; offset += size) {
        if (!current() || Date.now() > deadline) break;
        const batch = threads.slice(offset, offset + size);
        if (
          filters.protect &&
          !(await stillEligible(host, current, batch[0], filters).catch(() => false))
        )
          break;
        const results = await Promise.allSettled(batch.map(async ({ id }) => host.archive(id)));
        archived += results.filter(({ status }) => status === 'fulfilled').length;
        failed += results.filter(({ status }) => status === 'rejected').length;
        if (filters.protect) {
          if (failed) break;
          successful.push(batch[0]);
        }
      }
      const result = { archived, failed, skipped: threads.length - archived - failed };
      if (!filters.protect) return result;
      const verification = await verifyProtectedArchive(
        host,
        current,
        successful,
        retained,
        cli,
      ).catch(() => ({ verified: false }));
      return { ...result, ...verification };
    } finally {
      busy = false;
    }
  };
}
