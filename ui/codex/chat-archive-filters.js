/*
 * [INPUT]: 宿主项目目录、归属、聊天时间及本地归档筛选条件。
 * [OUTPUT]: 归档条件校验、项目归属、候选和每项目保留快照。
 * [POS]: 纯规则计算，设置和定时任务共享，不读写宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

export const NO_PROJECT = 'projectless';
const DAY_MS = 86_400_000;
const invalid = () => Error('归档规则无效，请检查项目、日期和保留数量。');

function dateBoundary(value, end) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split('-').map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day)
    throw invalid();
  if (end) date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function normalizeArchiveFilters(input = {}, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const {
    project = null,
    dateField = 'updated',
    from = null,
    through = null,
    inactiveDays = null,
    keepRecent = 0,
    protect = false,
  } = input;
  if (project !== null && (typeof project !== 'string' || !project.trim())) throw invalid();
  if (
    !['updated', 'created'].includes(dateField) ||
    typeof protect !== 'boolean' ||
    !Number.isSafeInteger(keepRecent) ||
    keepRecent < 0
  )
    throw invalid();
  if (
    inactiveDays !== null &&
    (!Number.isSafeInteger(inactiveDays) ||
      inactiveDays < 1 ||
      inactiveDays > now / DAY_MS ||
      dateField !== 'updated' ||
      from !== null ||
      through !== null)
  )
    throw invalid();
  const start = dateBoundary(from, false);
  const end = dateBoundary(through, true);
  if (start !== null && end !== null && start >= end) throw invalid();
  return {
    project,
    dateField,
    from,
    through,
    inactiveDays,
    keepRecent,
    protect,
    start,
    end,
    cutoff: inactiveDays === null ? null : now - inactiveDays * DAY_MS,
  };
}

function timestamp(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value < 100_000_000_000 ? value * 1000 : value;
}

export function resolveArchiveProject(thread, { projects, assignments, aliases, projectless }) {
  const actual = (id) => (projects.has(id) ? id : aliases.get(id));
  const assignment = Object.hasOwn(assignments, thread.id) ? assignments[thread.id] : null;
  if (
    assignment &&
    (assignment.projectKind !== 'local' || typeof assignment.projectId !== 'string')
  )
    return null;
  const recorded = new Set([thread.projectId, assignment?.projectId].filter((id) => id != null));
  if (recorded.size) {
    const resolved = new Set(Array.from(recorded, actual));
    return resolved.size === 1 && !projectless.has(thread.id)
      ? (resolved.values().next().value ?? null)
      : null;
  }
  if (projectless.has(thread.id)) return NO_PROJECT;
  if (typeof thread.cwd !== 'string' || !thread.cwd.startsWith('/')) return null;
  const matches = [];
  for (const [id, project] of projects) {
    for (const raw of project.roots) {
      const root = raw.replace(/\/+$/, '');
      if (root && (thread.cwd === root || thread.cwd.startsWith(`${root}/`)))
        matches.push({ id, length: root.length });
    }
  }
  if (!matches.length) return null;
  const longest = Math.max(...matches.map(({ length }) => length));
  const best = new Set(matches.filter(({ length }) => length === longest).map(({ id }) => id));
  return best.size === 1 ? best.values().next().value : null;
}

export function selectArchiveChats(chats, cli, filters) {
  const groups = new Map();
  const matches = [];
  for (const chat of chats) {
    if (cli !== null && cli !== chat.cli) continue;
    if (filters.project !== null && filters.project !== chat.project) continue;
    const updated = timestamp(chat.thread.updatedAt);
    const record = { ...chat, updated };
    if (chat.project && chat.project !== NO_PROJECT) {
      const group = groups.get(chat.project) ?? [];
      group.push(record);
      groups.set(chat.project, group);
    }
    matches.push(record);
  }
  const kept = new Set();
  if (filters.keepRecent) {
    for (const group of groups.values()) {
      if (group.some(({ updated }) => updated === null)) {
        for (const { thread } of group) kept.add(thread.id);
        continue;
      }
      group.sort(
        (left, right) =>
          right.updated - left.updated || left.thread.id.localeCompare(right.thread.id),
      );
      for (const { thread } of group.slice(0, filters.keepRecent)) kept.add(thread.id);
    }
  }
  const selected = matches.filter(({ thread, project, updated }) => {
    if (kept.has(thread.id) || ((filters.keepRecent || filters.protect) && project == null))
      return false;
    if (filters.protect && updated === null) return false;
    if (filters.cutoff !== null) return updated !== null && updated < filters.cutoff;
    if (filters.start === null && filters.end === null) return true;
    const date = filters.dateField === 'created' ? timestamp(thread.createdAt) : updated;
    return (
      date !== null &&
      (filters.start === null || date >= filters.start) &&
      (filters.end === null || date < filters.end)
    );
  });
  return { selected, groups, kept };
}
