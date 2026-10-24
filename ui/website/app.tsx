/* [INPUT]: Original brand clip, shared modeled settings scene and isolated feature demos.
 * [OUTPUT]: A single-flow introduction without a navigation bar or decorative labels.
 * [POS]: Independent website; only visitor theme is persisted, no business data or services.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { BrandOpening } from './brand-opening';
import {
  FeatureDemo,
  SurfaceDemo,
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
  const [animateSurface, setAnimateSurface] = useState(true);
  useEffect(() => {
    document.documentElement.dataset.siteTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#19191b' : '#fdfcf9');
    try {
      localStorage.setItem(themeKey, theme);
    } catch {
      /* Keep this visit usable without storage. */
    }
  }, [theme]);
  return (
    <>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <main id="main" className="page-width">
        <section className="opening" aria-labelledby="page-title">
          <BrandOpening />
          <h1 id="page-title">把顺手的工具，放在对话旁。</h1>
        </section>
        <section className="modeled-demo" aria-label="窗口形态演示">
          <div
            className="surface-tabs"
            role="tablist"
            aria-label="窗口形态"
            onPointerDown={() => setAnimateSurface(true)}
            onKeyDown={(event) => {
              setAnimateSurface(false);
              tabKeys(event);
            }}
          >
            {surfaces.map((item) => (
              <button
                key={item.id}
                id={`surface-${item.id}`}
                role="tab"
                aria-selected={surface === item.id}
                aria-controls="surface-preview"
                tabIndex={surface === item.id ? 0 : -1}
                onClick={() => setSurface(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div id="surface-preview" role="tabpanel" aria-labelledby={`surface-${surface}`}>
            <SurfaceDemo surface={surface} animate={animateSurface} />
          </div>
        </section>
        <section className="feature-section" aria-label="功能交互演示">
          <FeatureDemo active={feature} onChange={setFeature} />
        </section>
        <section className="install" aria-labelledby="install-title">
          <div>
            <h2 id="install-title">Palboo for macOS</h2>
            <p>1.0.0 安装包准备中</p>
          </div>
          <a
            className="release-link"
            href={`${repository}/releases`}
            target="_blank"
            rel="noopener noreferrer"
          >
            查看发布版本 <Icon name="feature-next" />
          </a>
        </section>
      </main>
      <footer className="site-footer page-width">
        <a href={repository} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
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
