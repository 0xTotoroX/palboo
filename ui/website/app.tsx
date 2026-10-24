/* [INPUT]: Scroll stories, shared brand/icons and isolated portfolio demonstrations.
 * [OUTPUT]: Feature, workspace, material and connection overview with truthful release entry.
 * [POS]: Independent website; only visitor theme persists, no business data or services.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { PalbooWordmark } from '../shared/brand';
import { BoardDemo, BotDemo, ComposerDemo, ModelDemo, SpeedDemo } from './demos';
import { OpeningStory, ReadingStory } from './story';
import { SurfaceStory, MaterialStory } from './workspace-demo';

const repository = 'https://github.com/0xTotoroX/palboo';
const themeKey = 'palboo.website.theme';
function initialTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* Private storage may be denied. */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function ToolDetails() {
  const [botDraft, setBotDraft] = useState('');
  const [prompt, setPrompt] = useState('帮我把这个作品集方案安排一下');
  return (
    <section className="tools-section page-width" aria-labelledby="tools-title">
      <h2 id="tools-title">
        模型、输入与 Bot，
        <br />
        都在对话里完成。
      </h2>
      <div className="tool-row">
        <div>
          <h3>模型快切</h3>
          <p>
            直接切换 Codex 当前可用的具体模型，同时选择推理强度与
            Fast。把常用组合存成预设，下次单击切换；也能查看 Codex 剩余额度。
          </p>
          <p>
            这里用 GPT-6.1-Sol 与 GPT-6-Astra 演示。实际模型和档位来自你的 Codex，额度为示例数值。
          </p>
        </div>
        <ModelDemo />
      </div>
      <div className="tool-row">
        <div>
          <h3>聊天测速</h3>
          <p>
            查看最近 3
            秒可见回复的估算速度，区分等待、思考、工具执行与生成状态。官方用量可用时，还能查看输入、缓存、输出和思考
            token。
          </p>
          <p>速度不包含隐藏思考与工具输出，开启后显示在模型快切底部。</p>
        </div>
        <SpeedDemo />
      </div>
      <div className="tool-row">
        <div>
          <h3>提示词优化</h3>
          <p>发送之前，把草稿表达得更清楚。改写后可以继续编辑，也可以还原。</p>
        </div>
        <ComposerDemo draft={prompt} onChange={setPrompt} label="提示词优化演示" optimize />
      </div>
      <div className="tool-row">
        <div>
          <h3>Grok Bot</h3>
          <p>
            选一个已有的 Bot，把咨询填入当前聊天。Bot 资料可自动同步、搜索和置顶整理；常用 Bot
            排在前面，只用分隔线区分。
          </p>
          <p>沿用你的 BDK、MCP 与 Skill 配置，由当前聊天里的 Agent 发起咨询。</p>
        </div>
        <div>
          <BotDemo
            onInsert={(value) => setBotDraft((draft) => (draft ? `${draft}\n${value}` : value))}
          />
          <ComposerDemo draft={botDraft} onChange={setBotDraft} label="Bot 咨询草稿" />
        </div>
      </div>
    </section>
  );
}
export function App() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.siteTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#19191b' : '#fdfcf9');
    try {
      localStorage.setItem(themeKey, theme);
    } catch {
      /* Keep the visit usable without storage. */
    }
  }, [theme]);
  return (
    <>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <main id="main">
        <OpeningStory />
        <ReadingStory />
        <section className="board-story page-width" aria-labelledby="board-title">
          <div className="section-intro">
            <h2 id="board-title">
              任务看板。
              <br />
              把聊过的事一件件做完。
            </h2>
            <p>
              把待办留在对话旁。添加任务、拖动整理，
              <br />
              从待办到进行中，再到完成。分组可自定义，窄侧栏按分组查看，贴边展开保留可读的卡片空间。
            </p>
          </div>
          <div className="board-stage">
            <div className="board-project">
              <Icon name="feature-board" />
              <span>个人作品集</span>
            </div>
            <BoardDemo />
          </div>
        </section>
        <ToolDetails />
        <SurfaceStory />
        <MaterialStory />
        <section className="connection-story page-width" aria-labelledby="connection-title">
          <div className="section-intro">
            <h2 id="connection-title">
              接入你的环境，
              <br />
              保留你的选择。
            </h2>
            <p>功能可以分别开关。日常操作留在工作台，模型服务、连接与高级偏好集中在设置。</p>
          </div>
          <div className="connection-details">
            <details>
              <summary>模型服务与 CodexHost</summary>
              <p>
                下一步、提示词优化和可选的术语识别使用已配置的模型服务。CodexHost
                可按需开启、更新或恢复版本，沿用各 Agent 原有的安装与登录环境。
              </p>
            </details>
            <details>
              <summary>启动与连接</summary>
              <p>
                Palboo 是独立 App，通过本机连接与 Codex
                协作。可查看连接状态、手动重连，并选择宿主重新打开时的处理方式。
              </p>
            </details>
            <details>
              <summary>性能与开关</summary>
              <p>
                可暂停与 Codex
                的连接，保留任务和功能配置；重新开启继续使用。性能监测默认关闭，开启后在设置里查看
                Palboo 后台的 CPU、内存与已测同步工作。
              </p>
            </details>
          </div>
        </section>
        <section id="install" className="install page-width" aria-labelledby="install-title">
          <div className="install-top">
            <div>
              <PalbooWordmark className="install-wordmark" />
              <h2 id="install-title">
                下一次对话，
                <br />让 Palboo 陪你一起。
              </h2>
              <p>1.0.0 安装包准备中</p>
            </div>
            <a
              className="release-link"
              href={`${repository}/releases`}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看发布版本
              <Icon name="feature-next" />
            </a>
          </div>
          <dl className="install-facts">
            <div>
              <dt>运行环境</dt>
              <dd>
                macOS 14+ · Apple Silicon
                <br />
                桌面浮窗需 macOS 15+，原生液态材质需 macOS 26。
              </dd>
            </div>
            <div>
              <dt>安装方式</dt>
              <dd>
                DMG 内含完整 App，无需 Node 或 Rust。
                <br />
                需已有 Codex；模型服务与可选 Agent 沿用你的环境。
              </dd>
            </div>
            <div>
              <dt>首次打开</dt>
              <dd>
                App 使用本地签名，尚未经过 Apple 公证。
                <br />
                如被系统拦截，请到“隐私与安全性”中允许打开。
              </dd>
            </div>
          </dl>
        </section>
      </main>
      <footer className="site-footer page-width">
        <a href={repository} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <span>GPL-3.0-only · 开源</span>
        <button
          className="icon-button"
          aria-label={theme === 'light' ? '切换到深色' : '切换到浅色'}
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        </button>
      </footer>
    </>
  );
}
