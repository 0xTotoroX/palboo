/*
 * [INPUT]: 当前连接状态、认证归档接口与共享确认及反馈组件。
 * [OUTPUT]: 本地聊天的 CLI 分组计数、指定范围预览、显式确认与结果反馈。
 * [POS]: Codex 连接页中的聊天管理，不保存配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { useRef, useState } from 'react';
import { tr } from '../shared/i18n.js';
import { request } from './api';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { NativeSelect } from './components/ui/native-select';
import { codexHostAgents } from './codex-host-agents';
import { useConfirmation } from './settings-confirmation';
import { Field } from './settings-controls';

type ArchiveInventory = { total: number; groups: { cli: string; count: number }[] };
type ArchivePreview = ArchiveInventory & {
  id: string;
  cli: string | null;
  count: number;
  running: number;
  scheduled: number;
};
type ArchiveResult = { archived: number; failed: number; skipped: number };
const cliLabel = (cli: string) => codexHostAgents.find((agent) => agent.id === cli)?.label ?? cli;

export function ChatArchiveSettings({
  disabled,
  targetId,
  notify,
}: {
  disabled: boolean;
  targetId: string | null;
  notify: (text: string, failed?: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<{ targetId: string | null; inventory: ArchiveInventory }>();
  const [cli, setCli] = useState<string>();
  const reading = useRef(false);
  const { confirm, confirmation } = useConfirmation(targetId ?? undefined, disabled);
  const inventory = loaded?.targetId === targetId ? loaded.inventory : undefined;

  async function read(action: () => Promise<void>) {
    if (disabled || reading.current) return;
    reading.current = true;
    setLoading(true);
    try {
      await action();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      reading.current = false;
      setLoading(false);
    }
  }

  function load() {
    return read(async () => {
      const inventory = await request<ArchiveInventory>('chat-archive', { op: 'list' });
      setLoaded({ targetId, inventory });
      if (cli && !inventory.groups.some((group) => group.cli === cli)) setCli(undefined);
    });
  }

  function preview() {
    if (cli === undefined) return;
    return read(async () => {
      const plan = await request<ArchivePreview>('chat-archive', {
        op: 'preview',
        cli: cli || null,
      });
      setLoaded({ targetId, inventory: plan });
      if (!plan.count) {
        if (cli) setCli(undefined);
        notify(tr(cli ? '所选 CLI 已没有可归档的本地聊天。' : '没有可归档的本地聊天。'));
        return;
      }
      const description = [
        tr('可在 ChatGPT 的「设置 → 已归档的聊天」中恢复。'),
        plan.running ? tr('将停止 {{running}} 个进行中的聊天。', plan) : '',
        plan.scheduled ? tr('将移除 {{scheduled}} 个聊天关联的计划任务。', plan) : '',
      ]
        .filter(Boolean)
        .join(' ');
      confirm({
        title: plan.cli
          ? tr('归档 {{label}} 的 {{count}} 个本地聊天？', {
              label: cliLabel(plan.cli),
              count: plan.count,
            })
          : tr('归档 {{count}} 个本地聊天？', plan),
        description,
        confirmLabel: tr(plan.cli ? '确认归档' : '全部归档'),
        action: async () => {
          const result = await request<ArchiveResult>('chat-archive', { op: 'apply', id: plan.id });
          setLoaded(undefined);
          const incomplete = result.failed > 0 || result.skipped > 0;
          notify(
            tr(
              incomplete
                ? '已归档 {{archived}} 个聊天，失败 {{failed}} 个，未处理 {{skipped}} 个。'
                : '已归档 {{archived}} 个本地聊天。',
              result,
            ),
            incomplete,
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
                  {tr('{{label}}（{{count}}）', { label: cliLabel(cli), count })}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}
      <div className="settings-actions" data-settings-navigation>
        {inventory && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || loading}
            onClick={() => void load()}
          >
            {tr('刷新')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={
            disabled || loading || (!!inventory && (inventory.total === 0 || cli === undefined))
          }
          aria-busy={loading}
          onClick={() => void (inventory ? preview() : load())}
        >
          {tr(loading ? '正在读取本地聊天…' : inventory ? '预览归档' : '查看可归档聊天')}
        </Button>
      </div>
      {confirmation}
    </Card>
  );
}
