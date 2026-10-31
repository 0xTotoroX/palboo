/* [INPUT]: CodexHost upstream README capabilities and shared product icons.
 * [OUTPUT]: Compact compatibility-layer diagram and capability overview.
 * [POS]: Read-only explanation of the currently supported integration; no simulated conversations or service calls.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';

export function CodexHostPreview() {
  useLocale();
  return (
    <div className="compatibility-overview">
      <figure className="compatibility-flow" aria-label={tr('CodexHost 兼容层示意')}>
        <div className="compatibility-flow-host">{tr('ChatGPT / Codex 桌面')}</div>
        <Icon name="feature-next" />
        <strong className="compatibility-flow-layer">CodexHost</strong>
        <Icon name="feature-next" />
        <div className="compatibility-flow-agents">
          <span>Claude Code</span>
          <span>Pi</span>
          <span>OpenCode</span>
        </div>
      </figure>
      <dl className="compatibility-capabilities">
        <div>
          <dt>{tr('多 Agent 接入')}</dt>
          <dd>{tr('共用桌面界面与会话列表。')}</dd>
        </div>
        <div>
          <dt>{tr('跨 Agent 协作')}</dt>
          <dd>{tr('委派任务，查看独立会话的进度。')}</dd>
        </div>
        <div>
          <dt>{tr('代码与项目')}</dt>
          <dd>{tr('代码差异审查、会话分支与远程开发。')}</dd>
        </div>
      </dl>
    </div>
  );
}
