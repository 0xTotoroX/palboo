/* [INPUT]: Original opening, one settings-based feature showcase and shared brand controls.
 * [OUTPUT]: A compact scroll-linked feature journey with one installation destination.
 * [POS]: Independent website; all product examples and visitor edits stay in memory.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { SiteLanguage } from './language';
import { SiteTheme } from './theme';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
import { ClosingWordmark } from './closing-wordmark';
import { BrandJourney } from './brand-journey';
import './brand-journey.css';
import { OpeningStory } from './story';
import { GithubLink, type GithubLinkVariant } from './github-link';
import { FeatureShowcase } from './feature-showcase';

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
        <FeatureShowcase />
        <section id="install" className="install is-compact" aria-labelledby="install-title">
          <div className="install-inner page-width">
            <div>
              <ClosingWordmark />
              <h2 id="install-title">{tr('下一次对话，让 Palboo 陪你一起。')}</h2>
              <p className="install-platform">macOS 14+ · Apple Silicon</p>
            </div>
            <div className="install-actions">
              <GithubLink variant={githubVariant} />
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
          </div>
        </section>
        <BrandJourney />
      </main>
    </>
  );
}
