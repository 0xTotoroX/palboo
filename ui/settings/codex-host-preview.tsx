/* [INPUT]: Authenticated current CodexHost Agent snapshot, bundled identity icons and settings colors.
 * [OUTPUT]: Content-sized Agent picker that follows host changes and isolates temporary selection/add states.
 * [POS]: Visible-page read-only polling; no host commands, installation or persisted preferences.
 * [PROTOCOL]: Keep settings/AGENTS.md and asset attribution in sync. */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
import { PreviewFrame } from './preview-frame';
import { codexHostAgents } from './codex-host-agents';
import type { CodexHostAgentSnapshot } from '../shared/codex-host';
import { request } from './api';
import { Button } from './components/ui/button';

type Agent = CodexHostAgentSnapshot['agents'][number];
const availabilityLabels: Record<string, string> = {
  ready: '可用',
  notInstalled: '未安装',
  unavailable: '暂不可用',
  error: '连接异常',
  checking: '正在检查…',
  installing: '正在安装…',
  updating: '正在更新…',
  unknown: '状态未知',
};

export function CodexHostPreview({ live }: { live: boolean }) {
  useLocale();
  const [snapshot, setSnapshot] = useState<CodexHostAgentSnapshot | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState<{ source: string; selected: string; added: string[] } | null>(
    null,
  );
  useEffect(() => {
    setSnapshot(null);
    setError('');
    if (!live) return;
    const controller = new AbortController();
    let reading = false;
    async function load(initial = false) {
      if (reading || (!initial && document.hidden)) return;
      reading = true;
      try {
        const value = await request<CodexHostAgentSnapshot>(
          'codex-host/agents',
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setSnapshot((current) =>
            JSON.stringify(current) === JSON.stringify(value) ? current : value,
          );
          setError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSnapshot(null);
          setError(String(error));
        }
      } finally {
        reading = false;
      }
    }
    const refresh = () => void load();
    void load(true);
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [live]);
  const source = JSON.stringify(snapshot);
  useEffect(() => setDraft(null), [source]);
  const local = draft?.source === source ? draft : null;
  const selected = local?.selected ?? snapshot?.current;
  const added = local?.added ?? [];
  const agents = snapshot?.status === 'ready' ? snapshot.agents : [];
  const main = agents.filter((agent) => agent.group === 'main');
  const more = agents.filter((agent) => agent.group === 'more');
  const message = !live
    ? tr('尚未连接 Codex')
    : error || (snapshot ? tr(snapshot.message) : tr('正在读取…'));
  const moreId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const row = (agent: Agent) => {
    const ready = agent.available || added.includes(agent.id);
    const icon = codexHostAgents.find((item) => item.id === agent.id)?.icon;
    const availability = added.includes(agent.id) ? 'ready' : agent.availability;
    const status = tr(availabilityLabels[availability] || availabilityLabels.unknown);
    return (
      <div className="compatibility-agent-row" key={agent.id} data-availability={availability}>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={selected === agent.id}
          aria-description={status}
          title={status}
          disabled={!ready}
          className="compatibility-agent-choice"
          onClick={() => setDraft({ source, selected: agent.id, added })}
        >
          {icon ? (
            <img src={icon} alt="" width="22" height="22" draggable={false} />
          ) : (
            <span className="compatibility-agent-fallback" aria-hidden="true">
              {agent.label.slice(0, 1)}
            </span>
          )}
          <span>{agent.label}</span>
          {selected === agent.id && <Icon name="check" />}
        </button>
        {!ready && agent.canAdd && (
          <button
            type="button"
            className="compatibility-agent-add"
            aria-label={tr('预览添加 {{agent}}', { agent: agent.label })}
            title={tr('预览添加 {{agent}}', { agent: agent.label })}
            onClick={() => {
              setDraft({ source, selected: agent.id, added: [...added, agent.id] });
              requestAnimationFrame(() => {
                menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
              });
            }}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
    );
  };
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ).filter((button) => button.getClientRects().length > 0);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  }
  return (
    <div className="settings-local-preview compatibility-preview">
      <PreviewFrame
        title={tr('兼容集成预览')}
        after={
          local ? (
            <div className="settings-actions">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {tr('恢复当前配置')}
              </Button>
            </div>
          ) : undefined
        }
      >
        {message ? (
          <p className="compatibility-preview-status" role="status">
            {message}
          </p>
        ) : (
          <div
            className="compatibility-agent-menu"
            role="menu"
            aria-label={tr('Agent 菜单预览')}
            ref={menu}
            onKeyDown={navigate}
          >
            {main.map(row)}
            {more.length > 0 && (
              <>
                <button
                  type="button"
                  className="compatibility-agent-more"
                  aria-expanded={expanded}
                  aria-controls={moreId}
                  onClick={() => setExpanded((value) => !value)}
                >
                  <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
                  <span>{tr('更多 Agent ({{count}})', { count: more.length })}</span>
                </button>
                <div id={moreId} hidden={!expanded} role="group">
                  {more.map(row)}
                </div>
              </>
            )}
          </div>
        )}
      </PreviewFrame>
    </div>
  );
}
