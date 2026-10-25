import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Button presentation preset and the project's public release URL.
 * [OUTPUT]: Accessible GitHub entry shared by the hero and local comparison.
 * [POS]: Website-only call to action; no release lookup or download side effects.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { Icon } from '../shared/icons/react';
import githubMark from './media/github-mark.svg?raw';

export type GithubLinkVariant = 'text' | 'outline' | 'solid' | 'download';

export function GithubLink({ variant = 'download' }: { variant?: GithubLinkVariant }) {
  useLocale();
  const download = variant === 'download';
  return (
    <a
      className={`github-link github-link--${download ? 'outline github-link--download' : variant}`}
      href="https://github.com/0xTotoroX/palboo/releases"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={download ? tr('下载，前往 GitHub 发布页面') : tr('前往 GitHub 发布页面')}
    >
      {download ? (
        <>
          <span
            className="github-mark"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: githubMark }}
          />
          {tr('下载')}
        </>
      ) : (
        <>
          GitHub
          <Icon name="feature-next" />
        </>
      )}
    </a>
  );
}
