/* [INPUT]: 搜索查询、关闭回调及可选的共用标题操作槽。
 * [OUTPUT]: 标题行内的轻量搜索、焦点与取消操作；不占正文行。
 * [POS]: Board/Checklist 共用，样式随操作槽进入对应文档或 Shadow DOM。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useLayoutEffect, useRef } from 'react';
import { tr } from '../../shared/i18n.js';
import { Icon } from '../../shared/icons/react';

const styles = `
[data-board-search-open], .csw-feature-header-actions:has(> [data-board-search-open]:not([hidden])) { flex: 0 1 240px; min-width: 0; max-width: 100%; }
.board-search-control { box-sizing: border-box; display: flex; align-items: center; gap: 4px; width: 240px; max-width: 100%; min-width: 0; margin: 0; color: inherit; }
.board-search-control > .buddy-icon { margin-inline: 5px; opacity: .65; }
.board-search-control .board-search { box-sizing: border-box; flex: 1; width: 0; min-width: 0; height: max(28px, calc(1.4em + 5px)); min-height: 0; padding: 2px 4px; margin: 0; font: inherit; line-height: 1.4; color: inherit; caret-color: currentColor; border: 0; border-bottom: 1px solid transparent; border-radius: 0; background: transparent; box-shadow: none; outline: none; }
.board-search-control .board-search:focus-visible { outline: none; border-bottom-color: color-mix(in srgb, currentColor 65%, transparent); }
.board-search-control .board-search::placeholder { color: inherit; opacity: .6; }
.board-search-control .board-search::-webkit-search-decoration,
.board-search-control .board-search::-webkit-search-cancel-button { -webkit-appearance: none; }
.board-search-control button { display: grid; place-items: center; flex: none; width: 28px; height: 28px; min-width: 28px; padding: 5px; border: 0; background: transparent; color: inherit; opacity: 1; }
`;

export function TaskSearch({
  value,
  change,
  close,
  slot,
}: {
  value: string;
  change: (value: string) => void;
  close: () => void;
  slot?: HTMLElement;
}) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const actions = slot ?? input.current?.closest<HTMLElement>('.board-tools');
    if (actions) actions.dataset.boardSearchOpen = '';
    input.current?.focus({ preventScroll: true });
    return () => {
      if (actions) delete actions.dataset.boardSearchOpen;
    };
  }, [slot]);
  return (
    <>
      <style>{styles}</style>
      <form className="board-search-control" role="search" onSubmit={(e) => e.preventDefault()}>
        <Icon name="search" />
        <input
          ref={input}
          className="board-search"
          type="search"
          aria-label={tr('搜索任务')}
          placeholder={tr('搜索')}
          value={value}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
            e.stopPropagation();
            close();
          }}
        />
        <button type="button" aria-label={tr('关闭搜索')} title={tr('关闭搜索')} onClick={close}>
          <Icon name="close" />
        </button>
      </form>
    </>
  );
}
