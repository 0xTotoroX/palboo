/* [INPUT]: Host name and the shared, synthetic portfolio conversation.
 * [OUTPUT]: A two-level host navigation with an icon rail, projects and recent chats.
 * [POS]: Decorative settings/website context; no real user history or host commands.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';

export const previewHostWidth = 142;
export function PreviewHostNavigation({ hostName }: { hostName: string }) {
  return (
    <div className="demo-host-navigation" aria-hidden="true">
      <div className="demo-host-rail">
        {['home', 'chats', 'history', 'more', 'catalog', 'folder'].map((name, index) => (
          <span className="demo-host-rail-item" data-active={index === 0} key={name}>
            <Icon name={name} />
          </span>
        ))}
        <span className="demo-host-avatar">P</span>
      </div>
      <div className="demo-host-sidebar">
        <div className="demo-host-heading">
          <strong>{hostName}</strong>
          <Icon name="chevron-down" />
          <span className="demo-host-heading-actions">
            <Icon name="notification" />
            <Icon name="search" />
          </span>
        </div>
        <div className="demo-host-row">
          <Icon name="compose" />
          <span>{tr('新聊天')}</span>
        </div>
        <p className="demo-host-section">{tr('项目')}</p>
        {[tr('个人作品集'), tr('阅读工具'), tr('活动报名页'), tr('记账应用')].map((name, index) => (
          <div className="demo-host-row" data-current={index === 0} key={name}>
            <Icon name="folder" />
            <span>{name}</span>
          </div>
        ))}
        <p className="demo-host-section demo-host-outside">
          {tr('项目之外')}
          <Icon name="chevron-right" />
        </p>
        <p className="demo-host-section demo-host-recents">
          {tr('最近')}
          <Icon name="more" />
        </p>
        {[tr('两天的作品集计划'), tr('整理三个代表作品'), tr('检查移动端')].map((name, index) => (
          <div className="demo-host-row demo-host-chat" data-current={index === 0} key={name}>
            <span>{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
