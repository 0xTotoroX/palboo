/* [INPUT]: CodexHost upstream README capabilities and local demonstration state.
 * [OUTPUT]: A multi-Agent workspace example with delegation and Diff review, plus upstream attribution.
 * [POS]: Presentation only; never starts an Agent, changes a real session or calls a service.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
import { NativeSelect } from './components/ui/native-select';
import { PreviewFrame } from './preview-frame';

export function CodexHostPreview() {
  useLocale();
  const [agent, setAgent] = useState('Claude Code');
  const delegated = agent === 'Pi' ? 'Claude Code' : 'Pi';
  return (
    <PreviewFrame
      title={tr('兼容集成预览')}
      className="preview-compatibility"
      after={
        <div className="compatibility-introduction">
          <p>
            {tr(
              'CodexHost 让 Claude Code、Pi、OpenCode 等 Agent 在 Codex 桌面中运行，共用会话列表与原生界面。',
            )}
          </p>
          <p>
            {tr('支持跨 Agent 协作、代码差异审查、会话分支与远程开发；具体能力取决于所选 Agent。')}
          </p>
          <a
            href="https://github.com/BytePioneer-AI/codex-host"
            target="_blank"
            rel="noopener noreferrer"
          >
            {tr('CodexHost 原版 GitHub 仓库')}
          </a>
        </div>
      }
    >
      <header className="compatibility-preview-header">
        <strong>Codex Desktop</strong>
        <span>{tr('交互示例')}</span>
      </header>
      <div className="compatibility-preview-conversation">
        <p className="compatibility-preview-request">{tr('整理设置页，并检查边界情况。')}</p>
        <div className="compatibility-preview-response">
          <strong>{agent}</strong>
          <p>{tr('我来检查实现，并将测试交给另一个 Agent。')}</p>
        </div>
        <details className="compatibility-preview-task">
          <summary>
            <span>{tr('委派给 {{agent}}', { agent: delegated })}</span>
            <Icon name="chevron-right" />
          </summary>
          <p>{tr('在独立会话中运行测试，可从同一侧栏查看进度与结果。')}</p>
        </details>
        <details className="compatibility-preview-review" open>
          <summary>
            <span>{tr('查看更改')}</span>
            <Icon name="chevron-right" />
          </summary>
          <pre aria-label={tr('代码差异示例')}>
            <code>
              <span>- const label = "Options";</span>
              {'\n'}
              <span>+ const label = "Features";</span>
            </code>
          </pre>
        </details>
      </div>
      <footer className="compatibility-preview-composer">
        <p>{tr('给所选 Agent 分配任务…')}</p>
        <div className="compatibility-preview-agent">
          <label htmlFor="preview-compatibility-agent">Agent</label>
          <NativeSelect
            id="preview-compatibility-agent"
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            controlWidth="short"
          >
            <option>Codex</option>
            <option>Claude Code</option>
            <option>Pi</option>
            <option>OpenCode</option>
          </NativeSelect>
        </div>
      </footer>
    </PreviewFrame>
  );
}
