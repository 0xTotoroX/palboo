/* [INPUT]: Button presentation preset and the project's public release URL.
 * [OUTPUT]: Accessible GitHub entry shared by the hero and local comparison.
 * [POS]: Website-only call to action; no release lookup or download side effects.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { Icon } from '../shared/icons/react';
import githubMark from './media/github-mark.svg?raw';

export type GithubLinkVariant = 'text' | 'outline' | 'solid' | 'install';

export function GithubLink({ variant = 'install' }: { variant?: GithubLinkVariant }) {
  const install = variant === 'install';
  return (
    <a
      className={`github-link github-link--${install ? 'outline github-link--install' : variant}`}
      href="https://github.com/0xTotoroX/palboo/releases"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={install ? '安装，前往 GitHub 发布页面' : '前往 GitHub 发布页面'}
    >
      {install ? (
        <>
          <span
            className="github-mark"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: githubMark }}
          />
          安装
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
