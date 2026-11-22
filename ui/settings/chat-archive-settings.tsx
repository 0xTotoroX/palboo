/*
 * [INPUT]: 当前连接状态、认证归档接口与共享确认及反馈组件。
 * [OUTPUT]: 全部本地聊天的预览、显式确认和结果反馈。
 * [POS]: Codex 连接页中的聊天管理，不保存配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { useRef, useState } from 'react';
import { tr } from '../shared/i18n.js';
import { request } from './api';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { useConfirmation } from './settings-confirmation';

type ArchivePreview = { id: string; count: number; running: number; scheduled: number };
type ArchiveResult = { archived: number; failed: number; skipped: number };

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
  const reading = useRef(false);
  const { confirm, confirmation } = useConfirmation(targetId ?? undefined, disabled);

  async function preview() {
    if (disabled || reading.current) return;
    reading.current = true;
    setLoading(true);
    try {
      const plan = await request<ArchivePreview>('chat-archive', { op: 'preview' });
      if (!plan.count) {
        notify(tr('没有可归档的本地聊天。'));
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
        title: tr('归档 {{count}} 个本地聊天？', plan),
        description,
        confirmLabel: tr('全部归档'),
        action: async () => {
          const result = await request<ArchiveResult>('chat-archive', { op: 'apply', id: plan.id });
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
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      reading.current = false;
      setLoading(false);
    }
  }

  return (
    <Card id="chat-archive">
      <h2>{tr('本地聊天')}</h2>
      <div className="settings-actions" data-settings-navigation>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || loading}
          aria-busy={loading}
          onClick={() => void preview()}
        >
          {tr(loading ? '正在读取本地聊天…' : '归档所有本地聊天')}
        </Button>
      </div>
      {confirmation}
    </Card>
  );
}
