/* [INPUT]: The exact preview candidates or isolated website examples.
 * [OUTPUT]: A scrollable list of session titles, chat IDs and archive context.
 * [POS]: Read-only presentation shared with the website; never reads chat turns.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useId } from 'react';
import { tr } from '../shared/i18n.js';
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
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <section className="archive-sessions" data-settings-search-ignore>
      <h4 id={label}>{tr('待归档会话')}</h4>
      <ul aria-labelledby={label} className="archive-session-list" tabIndex={0}>
        {sessions.map((session) => {
          const timestamp = session[dateField];
          const project =
            session.projectLabel ??
            tr(session.project === 'projectless' ? '项目外' : '项目归属不明');
          return (
            <li key={session.id}>
              <strong>{session.title || tr('未命名聊天')}</strong>
              <span className="archive-session-meta">
                {archiveCliLabel(session.cli)} · {project}
                {timestamp !== null && (
                  <>
                    {' · '}
                    <time dateTime={new Date(timestamp).toISOString()}>
                      {tr(dateField === 'created' ? '创建于 {{date}}' : '最近活动 {{date}}', {
                        date: date.format(timestamp),
                      })}
                    </time>
                  </>
                )}
                {session.active && ` · ${tr('进行中')}`}
                {session.scheduled && ` · ${tr('有关联计划任务')}`}
              </span>
              <code>{session.id}</code>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
