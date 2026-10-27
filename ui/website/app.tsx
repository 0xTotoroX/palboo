import { SiteLanguage } from './language';
import { SiteTheme } from './theme';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Scroll stories, shared brand/icons and isolated portfolio demonstrations.
 * [OUTPUT]: Feature overview, installation conditions and an accessible return to the opening.
 * [POS]: Independent website; local language/appearance, no business data or services.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useState } from 'react';
import { Icon } from '../shared/icons/react';
import { PalbooWordmark } from '../shared/brand';
import { BoardDemo, BotDemo, ComposerDemo, ModelDemo, SpeedDemo, botSampleNames } from './demos';
import { OpeningStory, ReadingStory } from './story';
import { ScrollDemo } from './scroll-tour';
import type { GithubLinkVariant } from './github-link';
import { PromptDemo } from './prompt-demo';

function ToolDetails() {
  useLocale();
  const [botDraft, setBotDraft] = useState<string | null>(null);
  return (
    <section className="tools-section page-width" aria-labelledby="tools-title">
      <h2 id="tools-title">
        {tr('常用操作，')}
        <br />
        {tr('不必离开对话。')}
      </h2>
      <ScrollDemo steps={3} className="model-tour">
        {(step) => (
          <div className="tool-row">
            <div>
              <h3>{tr('模型快切')}</h3>
              <p>
                {tr(
                  'Codex 模型、推理强度和 Fast，在同一处切换。把常用组合存成预设，随时查看剩余额度。',
                )}
              </p>
              <p>{tr('模型与额度为示例，实际选项以你的 Codex 为准。')}</p>
            </div>
            <ModelDemo tourStep={step} />
          </div>
        )}
      </ScrollDemo>
      <ScrollDemo steps={5} className="speed-tour">
        {(step) => (
          <div className="tool-row">
            <div>
              <h3>{tr('聊天测速')}</h3>
              <p>
                {tr(
                  '保留当前模型最近一次测速，在思考、调用工具或切换聊天时仍能查看。状态放在括号里，测到新速度再更新。',
                )}
              </p>
              <p>{tr('显示在模型快切底部。速度只统计可见回复，不含隐藏思考和工具输出。')}</p>
            </div>
            <SpeedDemo tourStep={step} />
          </div>
        )}
      </ScrollDemo>
      <ScrollDemo steps={2} className="prompt-tour">
        {(step) => (
          <div className="tool-row">
            <div>
              <h3>{tr('提示词优化')}</h3>
              <p>{tr('发送之前，把草稿表达得更清楚。改写后可以继续编辑，也可以还原。')}</p>
            </div>
            <PromptDemo tourStep={step} />
          </div>
        )}
      </ScrollDemo>
      <ScrollDemo steps={3} className="bot-tour">
        {(step) => (
          <div className="tool-row">
            <div>
              <h3>Grok Bot</h3>
              <p>
                {tr(
                  '找到合适的 Bot，把咨询带进当前聊天。头像与徽章展示状态，移入鼠标后查看进度、追问或停止，最近消息按需打开。',
                )}
              </p>
              <p>{tr('沿用你的 BDK、MCP 与 Skill 配置，由当前聊天里的 Agent 发起咨询。')}</p>
            </div>
            <div>
              <BotDemo
                tourStep={step}
                onInsert={(value) => setBotDraft((draft) => (draft ? `${draft}\n${value}` : value))}
              />
              <ComposerDemo
                draft={
                  botDraft ??
                  (step === undefined
                    ? ''
                    : tr('请问「{{name}}」：帮我检查作品集方案。', {
                        name: botSampleNames()[step],
                      }))
                }
                onChange={setBotDraft}
                label={tr('Bot 咨询草稿')}
              />
            </div>
          </div>
        )}
      </ScrollDemo>
    </section>
  );
}
export function App({ githubVariant }: { githubVariant?: GithubLinkVariant }) {
  useLocale();
  return (
    <>
      <div className="site-utilities">
        <SiteLanguage />
        <SiteTheme />
      </div>
      <a className="skip-link" href="#main">
        {tr('跳到正文')}
      </a>
      <main id="main" tabIndex={-1}>
        <OpeningStory githubVariant={githubVariant} />
        <ReadingStory />
        <ScrollDemo steps={3} className="board-story page-width" labelledBy="board-title">
          {(step) => (
            <>
              <div className="section-intro">
                <h2 id="board-title">
                  {tr('任务看板。')}
                  <br />
                  {tr('把聊过的事一件件做完。')}
                </h2>
                <p>
                  {tr(
                    '把聊到的事情留在手边。添加任务，拖动到进行中，再逐项完成。分组按需自定义，窄侧栏与贴边也能清楚查看。',
                  )}
                </p>
              </div>
              <div className="board-stage">
                <div className="board-project">
                  <Icon name="feature-board" />
                  <span>{tr('个人作品集')}</span>
                </div>
                <BoardDemo tourStatus={step} />
              </div>
            </>
          )}
        </ScrollDemo>
        <ToolDetails />
        <section className="connection-story page-width" aria-labelledby="connection-title">
          <div className="section-intro">
            <h2 id="connection-title">
              {tr('接入你的环境，')}
              <br />
              {tr('保留你的选择。')}
            </h2>
            <p>
              {tr('功能可以分别开关。日常操作留在工作台，模型服务、连接与高级偏好集中在设置。')}
            </p>
          </div>
          <div className="connection-details">
            <details>
              <summary>
                {tr('模型服务与 CodexHost')}
                <Icon name="chevron-down" />
              </summary>
              <p>
                {tr(
                  '下一步、提示词优化和可选的术语识别使用已配置的模型服务。CodexHost 可按需开启、更新或恢复版本，沿用各 Agent 原有的安装与登录环境。',
                )}
              </p>
            </details>
            <details>
              <summary>
                {tr('启动与连接')}
                <Icon name="chevron-down" />
              </summary>
              <p>
                {tr(
                  'Palboo 是独立 App，通过本机连接与 Codex 协作。可查看连接状态、手动重连，并选择宿主重新打开时的处理方式。',
                )}
              </p>
            </details>
            <details>
              <summary>
                {tr('性能与开关')}
                <Icon name="chevron-down" />
              </summary>
              <p>
                {tr(
                  '可暂停与 Codex 的连接，保留任务和功能配置；重新开启继续使用。性能监测默认关闭，需要时在设置中查看 Palboo 后台的 CPU 和内存。',
                )}
              </p>
            </details>
          </div>
        </section>
        <section id="install" className="install page-width" aria-labelledby="install-title">
          <div className="install-top">
            <div>
              <PalbooWordmark className="install-wordmark" />
              <h2 id="install-title">
                {tr('下一次对话，')}
                <br />
                {tr('让 Palboo 陪你一起。')}
              </h2>
            </div>
            <a
              className="back-to-top"
              href="#main"
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                history.replaceState(history.state, '', '#main');
                document.getElementById('main')?.focus({ preventScroll: true });
                scrollTo({
                  top: 0,
                  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'instant'
                    : 'smooth',
                });
              }}
            >
              {tr('回到顶部')}
              <Icon name="arrow-up" />
            </a>
          </div>
          <dl className="install-facts">
            <div>
              <dt>{tr('运行环境')}</dt>
              <dd>
                macOS 14+ · Apple Silicon
                <br />
                {tr('桌面浮窗需 macOS 15+，原生液态材质需 macOS 26。')}
              </dd>
            </div>
            <div>
              <dt>{tr('安装方式')}</dt>
              <dd>
                {tr('DMG 内含完整 App，无需 Node 或 Rust。')}
                <br />
                {tr('需已有 Codex；模型服务与可选 Agent 沿用你的环境。')}
              </dd>
            </div>
            <div>
              <dt>{tr('首次打开')}</dt>
              <dd>{tr('如被系统拦截，请到“隐私与安全性”中允许打开。')}</dd>
            </div>
          </dl>
        </section>
      </main>
    </>
  );
}
