/* [INPUT]: The exact preview candidates or isolated website examples.
 * [OUTPUT]: A compact scrollable session list with on-demand full ID, source, project and date inspection.
 * [POS]: Read-only presentation shared with the website; never reads chat turns.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
import { useLocale } from '../shared/use-locale';
import { codexHostAgents } from './codex-host-agents';

export type ArchiveSession = {
  id: string;
  cli: string;
  title: string | null;
  project: string | null;
  projectLabel: string | null;
  created: number | null;
  updated: number | null;
  active: boolean;
  scheduled: boolean;
};

export const archiveCliLabel = (cli: string) =>
  codexHostAgents.find((agent) => agent.id === cli)?.label ?? cli;

export function ArchiveSessions({
  sessions,
  dateField = 'updated',
}: {
  sessions: ArchiveSession[];
  dateField?: 'created' | 'updated';
}) {
  const locale = useLocale();
  const label = useId();
  const panelPrefix = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const currentYear = new Date().getFullYear();
  const sameYearDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const otherYearDate = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const hasDates = sessions.some((session) => session[dateField] !== null);
  const currentActive = sessions.length ? Math.min(activeIndex, sessions.length - 1) : 0;

  useEffect(() => {
    listRef.current?.scrollTo(0, 0);
  }, [sessions]);

  function toggle(id: string, index: number) {
    setActiveIndex(index);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || sessions.length < 2) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sessions.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + sessions.length) % sessions.length;
    setActiveIndex(next);
    const button =
      listRef.current?.querySelectorAll<HTMLButtonElement>('.archive-session-row')[next];
    button?.focus();
    button?.scrollIntoView({ block: 'nearest' });
  }

  return (
    <section className="archive-sessions" data-settings-search-ignore>
      <div className="archive-sessions-header">
        <h4 id={label}>{tr('待归档会话')}</h4>
        {hasDates && (
          <span className="archive-sessions-column">
            {tr(dateField === 'created' ? '创建日期' : '最近活动')}
          </span>
        )}
      </div>
      <ul ref={listRef} aria-labelledby={label} className="archive-session-list">
        {sessions.map((session, index) => {
          const timestamp = session[dateField];
          const project =
            session.projectLabel ??
            tr(session.project === 'projectless' ? '项目外' : '项目归属不明');
          const isOpen = expanded.has(session.id);
          const panelId = `${panelPrefix}-${index}`;
          const compactDate =
            timestamp === null
              ? null
              : (new Date(timestamp).getFullYear() === currentYear
                  ? sameYearDate
                  : otherYearDate
                ).format(timestamp);
          return (
            <li key={session.id} data-expanded={isOpen ? 'true' : undefined}>
              <button
                type="button"
                className="archive-session-row"
                aria-expanded={isOpen}
                aria-controls={panelId}
                tabIndex={index === currentActive ? 0 : -1}
                onClick={() => toggle(session.id, index)}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <span className="archive-session-title">{session.title || tr('未命名聊天')}</span>
                {(session.active || session.scheduled || compactDate !== null) && (
                  <span className="archive-session-meta">
                    {session.active && <span className="archive-session-flag">{tr('进行中')}</span>}
                    {session.scheduled && (
                      <span className="archive-session-flag">{tr('计划任务')}</span>
                    )}
                    {timestamp !== null && compactDate !== null && (
                      <time
                        className="archive-session-date"
                        dateTime={new Date(timestamp).toISOString()}
                      >
                        {compactDate}
                      </time>
                    )}
                  </span>
                )}
                <Icon name="chevron-down" className="archive-session-chevron" />
              </button>
              {isOpen && (
                <dl id={panelId} className="archive-session-details">
                  <div>
                    <dt>{tr('来源')}</dt>
                    <dd>{archiveCliLabel(session.cli)}</dd>
                  </div>
                  <div>
                    <dt>{tr('所属项目')}</dt>
                    <dd>{project}</dd>
                  </div>
                  {timestamp !== null && (
                    <div>
                      <dt>{tr(dateField === 'created' ? '创建日期' : '最近活动')}</dt>
                      <dd>
                        <time dateTime={new Date(timestamp).toISOString()}>
                          {fullDate.format(timestamp)}
                        </time>
                      </dd>
                    </div>
                  )}
                  {(session.active || session.scheduled) && (
                    <div>
                      <dt>{tr('状态')}</dt>
                      <dd>
                        {[
                          session.active ? tr('进行中') : '',
                          session.scheduled ? tr('有关联计划任务') : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{tr('会话 ID')}</dt>
                    <dd>
                      <code>{session.id}</code>
                    </dd>
                  </div>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
