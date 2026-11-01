/* [INPUT]: CodexHost's public Agent catalog, bundled identity icons and settings colors.
 * [OUTPUT]: Content-sized Agent picker preview with selection, More Agents and add states.
 * [POS]: Isolated presentation state; no host commands, installation or persisted preferences.
 * [PROTOCOL]: Keep settings/AGENTS.md and asset attribution in sync. */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
import { PreviewFrame } from './preview-frame';
import { codexHostAgents } from './codex-host-agents';

type Agent = (typeof codexHostAgents)[number];

export function CodexHostPreview() {
  useLocale();
  const [selected, setSelected] = useState('antigravity');
  const [expanded, setExpanded] = useState(true);
  const [enabled, setEnabled] = useState(
    () => new Set(['codex', 'antigravity', 'opencode', 'claude-code', 'workbuddy', 'grok']),
  );
  const moreId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const row = (agent: Agent) => {
    const ready = enabled.has(agent.id);
    return (
      <div className="compatibility-agent-row" key={agent.id}>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={selected === agent.id}
          disabled={!ready}
          className="compatibility-agent-choice"
          onClick={() => setSelected(agent.id)}
        >
          <img src={agent.icon} alt="" width="22" height="22" draggable={false} />
          <span>{agent.label}</span>
          {selected === agent.id && <Icon name="check" />}
        </button>
        {!ready && agent.id !== 'zcode' && (
          <button
            type="button"
            className="compatibility-agent-add"
            aria-label={tr('预览添加 {{agent}}', { agent: agent.label })}
            title={tr('预览添加 {{agent}}', { agent: agent.label })}
            onClick={() => {
              setEnabled((current) => new Set([...current, agent.id]));
              setSelected(agent.id);
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
      <PreviewFrame title={tr('兼容集成预览')}>
        <div
          className="compatibility-agent-menu"
          role="menu"
          aria-label={tr('Agent 菜单预览')}
          ref={menu}
          onKeyDown={navigate}
        >
          {codexHostAgents.slice(0, 2).map(row)}
          <button
            type="button"
            className="compatibility-agent-more"
            aria-expanded={expanded}
            aria-controls={moreId}
            onClick={() => setExpanded((value) => !value)}
          >
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
            <span>{tr('更多 Agent ({{count}})', { count: codexHostAgents.length - 2 })}</span>
          </button>
          <div id={moreId} hidden={!expanded} role="group">
            {codexHostAgents.slice(2).map(row)}
          </div>
        </div>
      </PreviewFrame>
    </div>
  );
}
