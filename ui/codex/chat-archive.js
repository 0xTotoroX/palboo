/*
 * [INPUT]: 本机宿主的聊天分页、CodexHost 持久 CLI 归属、运行状态与原生归档接口。
 * [OUTPUT]: 各 CLI 数量、指定范围的短时归档预览及实际结果统计。
 * [POS]: 当前桌面连接内的批量归档，不读聊天正文或直接操作宿主存储。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { loadedRuntime, nativeScope } from './side-chat-native.js';

const unsupported = () => Error('当前 ChatGPT 桌面版无法批量归档本地聊天。');
const changed = () => Error('本地聊天或连接已变化，请重新预览。');
const incomplete = () => Error('无法完整读取本地聊天，请重试。');
const unknownOwner = () => Error('无法确认 CodexHost 聊天的 CLI 归属，请重试。');
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
    list: (cursor, externalOnly) =>
      manager.sendRequest(
        'thread/list',
        {
          archived: false,
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
    async scheduled() {
      const result = await scope.query.fetch(automations);
      if (!Array.isArray(result?.items)) throw unsupported();
      return new Set(
        result.items.flatMap((item) =>
          item?.status === 'ACTIVE' && typeof item.targetThreadId === 'string'
            ? [item.targetThreadId]
            : [],
        ),
      );
    },
    active(thread) {
      const status = scope.get(runtimeStatus, thread.id);
      return status?.type === 'active' || thread.status?.type === 'active';
    },
    archive: (id) =>
      manager.archiveConversation(id, {
        useAppServerPins: scope.get(appServerPins),
        cleanupWorktree: false,
        source: 'project_archive',
      }),
  };
}

async function listThreads(host, current, externalOnly) {
  const threads = new Map();
  const cursors = new Set();
  const started = Date.now();
  let cursor = null;
  do {
    if (!current()) throw changed();
    if (Date.now() - started > 20_000) throw Error('读取本地聊天超时，请重试。');
    const page = await host.list(cursor, externalOnly);
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

function inventory(chats) {
  const counts = new Map();
  for (const { cli } of chats) counts.set(cli, (counts.get(cli) ?? 0) + 1);
  return {
    total: chats.length,
    groups: Array.from(counts, ([cli, count]) => ({ cli, count })).sort((left, right) =>
      left.cli === 'codex' ? -1 : right.cli === 'codex' ? 1 : left.cli.localeCompare(right.cli),
    ),
  };
}

async function snapshot(host, current, chats, cli) {
  const selected = cli == null ? chats : chats.filter((chat) => chat.cli === cli);
  const scheduled = selected.length ? await host.scheduled() : new Set();
  if (!current()) throw changed();
  return selected
    .map(({ thread, cli }) => ({
      id: thread.id,
      cli,
      active: host.active(thread),
      scheduled: scheduled.has(thread.id),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function createLocalChatArchive({ isCurrent, resolve = connect }) {
  let pending = null;
  let busy = false;
  return async (operation, id, cli = null) => {
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
      const chats = await catalog(host, current);
      if (operation === 'list') return inventory(chats);
      const threads = await snapshot(host, current, chats, cli);
      if (operation === 'preview') {
        const id = crypto.randomUUID();
        const expires = Date.now() + planLifetime;
        pending = { id, expires, threads, cli, identity: host.identity };
        return {
          id,
          cli,
          ...inventory(chats),
          count: threads.length,
          running: threads.filter((thread) => thread.active).length,
          scheduled: threads.filter((thread) => thread.scheduled).length,
        };
      }
      if (JSON.stringify(previous.threads) !== JSON.stringify(threads)) throw changed();

      let archived = 0;
      let failed = 0;
      const deadline = Date.now() + 120_000;
      for (let offset = 0; offset < threads.length; offset += batchSize) {
        if (!current() || Date.now() > deadline) break;
        const results = await Promise.allSettled(
          threads.slice(offset, offset + batchSize).map(async ({ id }) => host.archive(id)),
        );
        archived += results.filter(({ status }) => status === 'fulfilled').length;
        failed += results.filter(({ status }) => status === 'rejected').length;
      }
      return { archived, failed, skipped: threads.length - archived - failed };
    } finally {
      busy = false;
    }
  };
}
