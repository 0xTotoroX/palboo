/* [INPUT]: Scroll stories, shared brand/icons and isolated portfolio demonstrations.
 * [OUTPUT]: Seven-part public introduction, compatibility and truthful release entry.
 * [POS]: Independent website; only visitor theme persists, no business data or services.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { PalbooWordmark } from '../shared/brand';
import { BoardDemo, BotDemo, ComposerDemo, ModelDemo } from './demos';
import { OpeningStory, ReadingStory, SurfaceStory } from './story';

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
        还有这些，
        <br />
        用起来更顺手。
      </h2>
      <div className="tool-row">
        <div>
          <h3>模型切换</h3>
          <p>把当前宿主可用的模型与推理档位放在手边，按任务选择。</p>
        </div>
        <ModelDemo />
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
          <p>接入你已有的 Bot，把咨询填入当前聊天。需要另行配置 BDK、MCP 与 Skill。</p>
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
              聊过的事，
              <br />
              一件件做完。
            </h2>
            <p>
              把待办留在对话旁。添加任务、拖动整理，
              <br />
              从待办到进行中，再到完成。
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
        <SurfaceStory />
        <ToolDetails />
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
