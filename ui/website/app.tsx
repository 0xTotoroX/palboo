/* [INPUT]: Shared brand/icons, isolated demos and browser color preference.
 * [OUTPUT]: Chinese Palboo introduction with one-shot OO animation and honest release links.
 * [POS]: Public website only; no application configuration, telemetry or network API.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useState } from 'react';
import { PalbooWordmark } from '../shared/brand';
import { Icon } from '../shared/icons/react';
import {
  FeatureDemo,
  SurfaceDemo,
  features,
  surfaces,
  tabKeys,
  type FeatureId,
  type SurfaceId,
} from './demos';

const repository = 'https://github.com/0xTotoroX/palboo';
const themeKey = 'palboo.website.theme';

function initialTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* Browser privacy modes can deny storage. */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [feature, setFeature] = useState<FeatureId>('next');
  const [surface, setSurface] = useState<SurfaceId>('sidebar');
  const [replay, setReplay] = useState(0);
  const currentFeature = features.find((item) => item.id === feature)!;
  const currentSurface = surfaces.find((item) => item.id === surface)!;

  useEffect(() => {
    document.documentElement.dataset.siteTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#19191b' : '#fafafa');
    try {
      localStorage.setItem(themeKey, theme);
    } catch {
      /* Theme still works for this visit. */
    }
  }, [theme]);

  return (
    <>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <header className="site-header">
        <a className="brand-link" href="#" aria-label="Palboo 首页">
          <PalbooWordmark />
        </a>
        <nav aria-label="主导航">
          <a href="#workspace">功能</a>
          <a href="#surfaces">窗口形态</a>
          <a href="#install">开始使用</a>
        </nav>
        <div className="header-actions">
          <a href={repository} className="repo-link" target="_blank" rel="noopener noreferrer">
            GitHub <Icon name="feature-next" className="external-arrow" />
          </a>
          <button
            className="icon-button theme-button"
            aria-label={theme === 'light' ? '切换到深色' : '切换到浅色'}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} />
          </button>
        </div>
      </header>

      <main id="main">
        <section className="hero page-width" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div>
              <p className="eyebrow">
                <span /> 为 Codex 而作
              </p>
              <h1 id="hero-title">
                让对话继续，
                <br />
                也让事情向前<span className="hero-period">。</span>
              </h1>
            </div>
            <div className="hero-intro">
              <p>
                从理清思路，到下一步行动。
                <br />
                把顺手的工具，放在对话旁。
              </p>
              <a className="button button-primary" href="#workspace">
                试试 Palboo <Icon name="feature-next" />
              </a>
              <a className="text-link" href="#install">
                安装与使用 <Icon name="chevron-right" />
              </a>
            </div>
          </div>
          <div className="brand-opening">
            <div
              className="animated-wordmark"
              key={replay}
              role="img"
              aria-label="PALBOO 的两个 O 变成一双眼睛"
            >
              <PalbooWordmark />
            </div>
            <div className="brand-caption">
              <span>对话旁，下一步。</span>
              <button
                className="icon-button"
                aria-label="重播品牌动画"
                onClick={() => setReplay((value) => value + 1)}
              >
                <Icon name="refresh" />
              </button>
            </div>
          </div>
        </section>

        <section
          id="workspace"
          className="workspace-section page-width"
          aria-labelledby="workspace-title"
        >
          <div className="feature-showcase">
            <div className="showcase-stage">
              <FeatureDemo active={feature} onChange={setFeature} />
            </div>
            <div className="section-heading">
              <p className="section-index">01 — 随手可用</p>
              <h2 id="workspace-title">一个工作台，六个顺手工具。</h2>
              <p>大纲、建议、任务和常用工具，在同一个工作台里接上。</p>
            </div>
            <div className="showcase-bottom">
              <div className="feature-picker" aria-label="选择功能演示">
                {features.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={feature === item.id}
                    onClick={() => setFeature(item.id)}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <div className="feature-caption" aria-live="polite">
                <h3>{currentFeature.title}</h3>
                <p>{currentFeature.description}</p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="surfaces"
          className="surface-section page-width"
          aria-labelledby="surface-title"
        >
          <div className="surface-copy">
            <p className="section-index">02 — 待在顺手的地方</p>
            <h2 id="surface-title">
              你的桌面，
              <br />
              你的工作方式。
            </h2>
            <p>
              在对话旁并排展开，或独立成窗。
              <br />
              同一套工具，换个位置继续。
            </p>
            <div className="surface-tabs" role="tablist" aria-label="窗口形态" onKeyDown={tabKeys}>
              {surfaces.map((item, index) => (
                <button
                  key={item.id}
                  role="tab"
                  id={`surface-${item.id}`}
                  aria-selected={surface === item.id}
                  aria-controls="surface-preview"
                  tabIndex={surface === item.id ? 0 : -1}
                  onClick={() => setSurface(item.id)}
                >
                  <span>0{index + 1}</span>
                  {item.label}
                  <Icon name="feature-next" />
                </button>
              ))}
            </div>
          </div>
          <div
            id="surface-preview"
            className="surface-preview"
            role="tabpanel"
            aria-labelledby={`surface-${surface}`}
          >
            <SurfaceDemo surface={surface} />
            <p className="surface-caption" aria-live="polite">
              {currentSurface.description}
            </p>
          </div>
        </section>

        <section className="principles page-width" aria-label="项目理念">
          <div>
            <span>01</span>
            <h3>接入，不接管。</h3>
            <p>
              通过本机连接与 Codex 协作，
              <br />
              不修改官方应用包。
            </p>
          </div>
          <div>
            <span>02</span>
            <h3>顺手，也自由。</h3>
            <p>
              按你的习惯选择功能、方向和布局，
              <br />
              不必适应另一套工作流程。
            </p>
          </div>
          <div>
            <span>03</span>
            <h3>开放，才走得远。</h3>
            <p>
              源码开放，采用 GPL-3.0-only。
              <br />
              欢迎使用、研究与改进。
            </p>
          </div>
        </section>

        <section
          id="install"
          className="install-section page-width"
          aria-labelledby="install-title"
        >
          <div className="install-main">
            <p className="section-index">03 — 开始下一步</p>
            <h2 id="install-title">
              让 Palboo，
              <br />
              陪你把想法做下去。
            </h2>
            <p className="release-state">1.0.0 安装包正在准备中</p>
            <div className="install-actions">
              <a
                className="button button-primary"
                href={`${repository}/releases`}
                target="_blank"
                rel="noopener noreferrer"
              >
                查看发布版本 <Icon name="feature-next" />
              </a>
              <a
                className="text-link"
                href={`${repository}/blob/main/README.zh-CN.md`}
                target="_blank"
                rel="noopener noreferrer"
              >
                使用说明 <Icon name="feature-next" className="external-arrow" />
              </a>
            </div>
            <p className="system-requirement">
              Apple Silicon · macOS 14+
              <br />
              桌面独立窗口需要 macOS 15+
            </p>
          </div>
          <div className="install-faq">
            <h3>开始之前</h3>
            <details>
              <summary>
                安装时需要敲命令吗？
                <Icon name="plus" />
              </summary>
              <p>
                准备中的 DMG 会包含完整 Palboo App。下载后拖入“应用程序”，再双击打开，无需安装
                Node.js 或 Rust。首次启动可能需要在 macOS“隐私与安全性”中允许打开。
              </p>
            </details>
            <details>
              <summary>
                需要提前安装什么？
                <Icon name="plus" />
              </summary>
              <p>
                Palboo 与 Mac 上的 Codex 配合使用，需要先安装 Codex。额外接入的 Agent、Grok Bot
                和模型服务，沿用各自的安装、登录与配置。
              </p>
            </details>
            <details>
              <summary>
                对话内容会去哪里？
                <Icon name="plus" />
              </summary>
              <p>
                Palboo
                的连接服务只监听本机。启用建议生成、术语补全等模型功能时，相关内容会发给你配置的服务。这个介绍页的演示使用独立示例，不连接你的聊天。
              </p>
            </details>
            <details>
              <summary>
                浅色和深色都支持吗？
                <Icon name="plus" />
              </summary>
              <p>
                工作台跟随 Codex
                的明暗与语义颜色，设置页也可以单独选择主题。哑光、磨砂与液态外观适应不同的窗口形式。
              </p>
            </details>
          </div>
        </section>
      </main>
      <footer className="site-footer page-width">
        <a className="brand-link" href="#" aria-label="返回 Palboo 页首">
          <PalbooWordmark />
        </a>
        <p>对话旁，下一步。</p>
        <div>
          <a href={`${repository}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
            GPL-3.0-only
          </a>
          <a href={repository} target="_blank" rel="noopener noreferrer">
            GitHub <Icon name="feature-next" className="external-arrow" />
          </a>
        </div>
        <span className="affiliation">独立开源项目，与 OpenAI 无隶属关系。</span>
      </footer>
    </>
  );
}
