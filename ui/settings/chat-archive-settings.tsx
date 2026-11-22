/*
 * [INPUT]: 当前连接状态、认证归档接口与共享确认及反馈组件。
 * [OUTPUT]: 进入时自动读取的聊天分组、会话预览、显式确认与结果反馈。
 * [POS]: 功能 → 本地聊天归档，不保存配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { useEffect, useRef, useState } from 'react';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
import { request } from './api';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { useConfirmation } from './settings-confirmation';
import { ArchiveSessions, archiveCliLabel, type ArchiveSession } from './chat-archive-sessions';
import { Field, Toggle } from './settings-controls';

type ArchiveInventory = {
  total: number;
  groups: { cli: string; count: number }[];
  projects?: { id: string; label: string | null; count: number }[];
};
type ArchivePreview = ArchiveInventory & {
  id: string;
  cli: string | null;
  filters?: Record<string, unknown>;
  count: number;
  running: number;
  scheduled: number;
  sessions?: ArchiveSession[];
};
type ArchiveResult = { archived: number; failed: number; skipped: number; verified?: boolean };
const initialRule = {
  project: '',
  time: 'all',
  dateField: 'updated',
  from: '',
  through: '',
  inactiveDays: '7',
  keepRecent: '0',
  protect: false,
};
type RuleDraft = typeof initialRule;

export function ChatArchiveSettings({
  disabled,
  targetId,
  notify,
}: {
  disabled: boolean;
  targetId: string | null;
  notify: (text: string, failed?: boolean) => void;
}) {
  const [listing, setListing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ targetId: string | null; inventory: ArchiveInventory }>();
  const [cli, setCli] = useState<string>();
  const [rule, setRule] = useState(initialRule);
  const reading = useRef<Promise<void> | null>(null);
  const current = useRef({ disabled, targetId, notify });
  current.current = { disabled, targetId, notify };
  const loading = listing || previewing;
  const { confirm, confirmation } = useConfirmation(targetId ?? undefined, disabled || listing);
  const inventory = loaded?.targetId === targetId ? loaded.inventory : undefined;
  const project = inventory?.projects?.find(({ id }) => id === rule.project);
  const projectMissing = Boolean(rule.project && !project);
  const changeRule = (patch: Partial<RuleDraft>) =>
    setRule((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (disabled) return;
    let active = true;
    setListing(true);
    // Let an earlier request settle so a quick return does not hit the host's busy lock.
    const task = Promise.resolve(reading.current).then(async () => {
      if (!active) return;
      try {
        const inventory = await request<ArchiveInventory>('chat-archive', { op: 'list' });
        if (!active) return;
        setLoaded({ targetId, inventory });
        setCli((value) =>
          value && !inventory.groups.some((group) => group.cli === value) ? undefined : value,
        );
      } catch (error) {
        if (active) current.current.notify((error as Error).message, true);
      }
    });
    reading.current = task;
    void task.finally(() => {
      if (reading.current === task) reading.current = null;
      if (active) setListing(false);
    });
    return () => {
      active = false;
    };
  }, [disabled, targetId, refresh]);

  function read(action: () => Promise<void>) {
    if (disabled || reading.current) return;
    setPreviewing(true);
    const task = action()
      .catch((error: Error) => {
        if (!current.current.disabled && current.current.targetId === targetId)
          current.current.notify(error.message, true);
      })
      .finally(() => {
        if (reading.current === task) reading.current = null;
        setPreviewing(false);
      });
    reading.current = task;
    return task;
  }

  function preview() {
    if (cli === undefined || projectMissing) return;
    const filters = {
      ...(rule.project ? { project: rule.project } : {}),
      ...(rule.time === 'inactive' ? { inactiveDays: Number(rule.inactiveDays) } : {}),
      ...(rule.time === 'range'
        ? {
            dateField: rule.dateField,
            ...(rule.from ? { from: rule.from } : {}),
            ...(rule.through ? { through: rule.through } : {}),
          }
        : {}),
      ...(Number(rule.keepRecent) ? { keepRecent: Number(rule.keepRecent) } : {}),
      ...(rule.protect ? { protect: true } : {}),
    };
    const appliedRules = Object.entries(filters);
    return read(async () => {
      const { sessions, ...plan } = await request<ArchivePreview>('chat-archive', {
        op: 'preview',
        cli: cli || null,
        includeSessions: true,
        ...(appliedRules.length ? { filters } : {}),
      });
      if (current.current.disabled || current.current.targetId !== targetId) return;
      if (
        plan.cli !== (cli || null) ||
        appliedRules.some(([key, value]) => plan.filters?.[key] !== value)
      ) {
        throw Error(tr('当前 Palboo 连接未确认所选归档规则，请重新预览。'));
      }
      if (!Array.isArray(sessions) || sessions.length !== plan.count) {
        throw Error(tr('当前 Palboo 连接未返回完整的归档会话列表，请重新预览。'));
      }
      setLoaded({ targetId, inventory: plan });
      if (!plan.count) {
        notify(tr('没有符合条件的本地聊天。'));
        return;
      }
      const cliCounts = new Map<string, number>();
      for (const session of sessions)
        cliCounts.set(session.cli, (cliCounts.get(session.cli) ?? 0) + 1);
      const cliSummary =
        !plan.cli && cliCounts.size
          ? [...cliCounts.entries()].map(([id, count]) =>
              cliCounts.size > 1 ? `${archiveCliLabel(id)} ${count}` : archiveCliLabel(id),
            )
          : [];
      const uniqueProjects = new Set(sessions.map((session) => session.projectLabel ?? ''));
      const singleProject =
        !project && uniqueProjects.size === 1 ? sessions[0]?.projectLabel : null;
      const dateSummary = filters.inactiveDays
        ? tr('超过 {{days}} 天未活动', { days: filters.inactiveDays })
        : filters.from && filters.through
          ? tr(
              filters.dateField === 'created'
                ? '创建日期 {{from}} 至 {{through}}'
                : '最近活动 {{from}} 至 {{through}}',
              { from: filters.from, through: filters.through },
            )
          : filters.from
            ? tr(filters.dateField === 'created' ? '创建日期自 {{date}}' : '最近活动自 {{date}}', {
                date: filters.from,
              })
            : filters.through
              ? tr(
                  filters.dateField === 'created' ? '创建日期至 {{date}}' : '最近活动至 {{date}}',
                  { date: filters.through },
                )
              : tr('不限时间');
      const scopeSummary = [
        ...cliSummary,
        project
          ? tr('项目：{{project}}', { project: project.label ?? tr('项目外') })
          : singleProject
            ? tr('项目：{{project}}', { project: singleProject })
            : plan.projects
              ? tr('全部项目')
              : '',
        dateSummary,
        filters.keepRecent ? tr('每项目保留最近 {{count}} 条', { count: filters.keepRecent }) : '',
        filters.protect ? tr('保护置顶、进行中与计划任务') : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const impact = [
        plan.running ? tr('将停止 {{running}} 个进行中的聊天。', plan) : '',
        plan.scheduled ? tr('将移除 {{scheduled}} 个聊天关联的计划任务。', plan) : '',
      ]
        .filter(Boolean)
        .join(' ');
      confirm({
        title: plan.cli
          ? tr('归档 {{label}} 的 {{count}} 个本地聊天？', {
              label: archiveCliLabel(plan.cli),
              count: plan.count,
            })
          : tr('归档 {{count}} 个本地聊天？', plan),
        description: scopeSummary,
        notice: impact ? (
          <div className="archive-confirm-impact" role="note">
            <Icon name="warning" className="archive-confirm-impact-icon" />
            <span>{impact}</span>
          </div>
        ) : undefined,
        details: (
          <ArchiveSessions
            sessions={sessions}
            dateField={filters.dateField === 'created' ? 'created' : 'updated'}
          />
        ),
        footerNote: tr('可在 ChatGPT 的「设置 → 已归档的聊天」中恢复。'),
        confirmLabel: tr(plan.cli || appliedRules.length ? '确认归档' : '全部归档'),
        action: async () => {
          const result = await request<ArchiveResult>('chat-archive', { op: 'apply', id: plan.id });
          setLoaded(undefined);
          setRefresh((value) => value + 1);
          const incomplete = result.failed > 0 || result.skipped > 0;
          notify(
            tr(
              incomplete
                ? '已归档 {{archived}} 个聊天，失败 {{failed}} 个，未处理 {{skipped}} 个。'
                : '已归档 {{archived}} 个本地聊天。',
              result,
            ) +
              (result.verified === false
                ? ` ${tr('归档结果复核未通过，请查看已归档的聊天。')}`
                : ''),
            incomplete || result.verified === false,
          );
        },
      });
    });
  }

  return (
    <Card id="chat-archive">
      <h2>{tr('本地聊天')}</h2>
      {inventory && (
        <div
          className="settings-control-group"
          data-settings-navigation
          onChange={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
              event.preventDefault();
          }}
        >
          <Field id="chat-archive-scope" label={tr('归档范围')}>
            <NativeSelect
              id="chat-archive-scope"
              value={cli === undefined ? '' : cli ? `cli:${cli}` : 'all'}
              disabled={disabled || loading}
              onChange={(event) => {
                const value = event.target.value;
                setCli(value === 'all' ? '' : value.slice('cli:'.length));
              }}
            >
              <option value="" disabled>
                {tr('选择归档范围')}
              </option>
              <option value="all">
                {tr('全部本地聊天（{{count}}）', { count: inventory.total })}
              </option>
              {inventory.groups.map(({ cli, count }) => (
                <option key={cli} value={`cli:${cli}`}>
                  {tr('{{label}}（{{count}}）', { label: archiveCliLabel(cli), count })}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {inventory.projects && (
            <Field id="chat-archive-project" label={tr('项目')}>
              <NativeSelect
                id="chat-archive-project"
                value={rule.project}
                disabled={disabled || loading}
                onChange={(event) => changeRule({ project: event.target.value })}
              >
                <option value="">{tr('全部项目')}</option>
                {projectMissing && (
                  <option value={rule.project} disabled>
                    {tr('所选项目暂无可归档聊天')}
                  </option>
                )}
                {inventory.projects.map(({ id, label, count }) => (
                  <option key={id} value={id}>
                    {tr('{{label}}（{{count}}）', { label: label ?? tr('项目外'), count })}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field id="chat-archive-time" label={tr('时间条件')}>
            <NativeSelect
              id="chat-archive-time"
              value={rule.time}
              disabled={disabled || loading}
              onChange={(event) => changeRule({ time: event.target.value })}
            >
              <option value="all">{tr('不限时间')}</option>
              <option value="inactive">{tr('按未活动天数')}</option>
              <option value="range">{tr('按日期区间')}</option>
            </NativeSelect>
          </Field>
          {rule.time === 'inactive' && (
            <Field id="chat-archive-days" label={tr('未活动超过（天）')}>
              <Input
                id="chat-archive-days"
                type="number"
                min={1}
                step={1}
                value={rule.inactiveDays}
                disabled={disabled || loading}
                onChange={(event) => changeRule({ inactiveDays: event.target.value })}
              />
            </Field>
          )}
          {rule.time === 'range' && (
            <>
              <Field id="chat-archive-date-field" label={tr('日期依据')}>
                <NativeSelect
                  id="chat-archive-date-field"
                  value={rule.dateField}
                  disabled={disabled || loading}
                  onChange={(event) => changeRule({ dateField: event.target.value })}
                >
                  <option value="updated">{tr('最近活动日期')}</option>
                  <option value="created">{tr('创建日期')}</option>
                </NativeSelect>
              </Field>
              <Field id="chat-archive-from" label={tr('起始日期')}>
                <Input
                  id="chat-archive-from"
                  type="date"
                  value={rule.from}
                  max={rule.through || undefined}
                  disabled={disabled || loading}
                  onChange={(event) => changeRule({ from: event.target.value })}
                />
              </Field>
              <Field id="chat-archive-through" label={tr('结束日期')}>
                <Input
                  id="chat-archive-through"
                  type="date"
                  value={rule.through}
                  min={rule.from || undefined}
                  disabled={disabled || loading}
                  onChange={(event) => changeRule({ through: event.target.value })}
                />
              </Field>
            </>
          )}
          {inventory.projects && (
            <>
              <Field id="chat-archive-keep" label={tr('每个项目保留最近（条）')}>
                <Input
                  id="chat-archive-keep"
                  type="number"
                  min={0}
                  step={1}
                  value={rule.keepRecent}
                  disabled={disabled || loading}
                  onChange={(event) => changeRule({ keepRecent: event.target.value })}
                />
              </Field>
              <Toggle
                id="chat-archive-protect"
                label={tr('保留置顶、进行中和有计划任务的聊天')}
                checked={rule.protect}
                disabled={disabled || loading}
                onChange={(protect) => changeRule({ protect })}
              />
            </>
          )}
        </div>
      )}
      {!disabled && !inventory && listing && (
        <p className="settings-help" role="status">
          {tr('正在读取本地聊天…')}
        </p>
      )}
      {!disabled && inventory?.total === 0 && (
        <p className="settings-help" role="status">
          {tr('没有可归档的本地聊天。')}
        </p>
      )}
      <div className="settings-actions" data-settings-navigation>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled || loading}
          aria-busy={listing}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {tr('刷新')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            disabled ||
            loading ||
            !inventory?.total ||
            cli === undefined ||
            projectMissing ||
            (rule.time === 'inactive' && Number(rule.inactiveDays) < 1) ||
            (rule.time === 'range' && !rule.from && !rule.through)
          }
          aria-busy={previewing}
          onClick={() => void preview()}
        >
          {tr(previewing ? '正在读取本地聊天…' : '预览归档')}
        </Button>
      </div>
      {confirmation}
    </Card>
  );
}
