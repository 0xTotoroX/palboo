/* [INPUT]: Direction catalog, built-in identities, selected IDs and the existing selection callback.
 * [OUTPUT]: Searchable, categorized local picker that follows its trigger while scrolling; selection only adds an existing direction.
 * [POS]: Stepwise selection presentation, independent of library editing and persistence.
 * [PROTOCOL]: Keep settings/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { EditableSettings } from '../shared/contracts';
import { Icon } from '../shared/icons/react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';

type Library = EditableSettings['directionLibrary'];

export function DirectionPicker({
  library,
  builtIns,
  selected,
  onSelect,
}: {
  library: Library;
  builtIns: ReadonlyArray<{ id: string }>;
  selected: string[];
  onSelect: (id: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<'custom' | 'builtin'>('builtin');
  const [active, setActive] = useState<string | null>(null);
  const [placement, setPlacement] = useState({ above: false, height: 320 });
  const originals = new Set(builtIns.map((item) => item.id));
  const available = library.filter((item) => !selected.includes(item.id));
  const term = query.trim().toLocaleLowerCase();
  const matches = available.filter((item) =>
    term
      ? `${item.name} ${item.instruction}`.toLocaleLowerCase().includes(term)
      : originals.has(item.id) === (group === 'builtin'),
  );
  const activeIndex = matches.findIndex((item) => item.id === active);
  const disabled = selected.length >= 6 || !available.length;
  const expanded = open && !disabled;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function position() {
    const rect = trigger.current!.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      close();
      return;
    }
    const below = window.innerHeight - rect.bottom;
    const above = below < 320 && rect.top > below;
    const height = Math.max(0, (above ? rect.top : below) - 12);
    setPlacement((current) =>
      current.above === above && current.height === height ? current : { above, height },
    );
  }
  function show() {
    if (disabled) return;
    position();
    setQuery('');
    setGroup(available.some((item) => !originals.has(item.id)) ? 'custom' : 'builtin');
    setActive(null);
    setOpen(true);
  }
  function choose(directionId: string) {
    if (disabled || !available.some((item) => item.id === directionId)) return;
    close(true);
    onSelect(directionId);
  }
  useLayoutEffect(() => {
    if (expanded) input.current?.focus({ preventScroll: true });
  }, [expanded]);
  useLayoutEffect(() => {
    const container = list.current;
    const option = container?.children[activeIndex] as HTMLElement | undefined;
    if (!expanded || !container || !option) return;
    const row = option.getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    if (row.top < viewport.top) container.scrollTop -= viewport.top - row.top;
    else if (row.bottom > viewport.bottom) container.scrollTop += row.bottom - viewport.bottom;
  }, [expanded, activeIndex]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      position();
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('hashchange', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('hashchange', dismiss);
    };
  }, [expanded]);

  return (
    <div
      ref={root}
      className="direction-picker"
      data-settings-navigation
      data-settings-search-ignore
      onKeyDown={(event) => {
        if (expanded && event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="direction-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={`${id}-panel`}
        disabled={disabled}
        title={selected.length >= 6 ? '最多选择 6 个方向' : undefined}
        onClick={() => (expanded ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            show();
          }
        }}
      >
        <Icon name="plus" />
        选择方向
      </Button>
      <div
        id={`${id}-panel`}
        role="dialog"
        aria-label="选择方向"
        className="direction-picker-panel settings-menu-motion"
        hidden={!expanded}
        inert={!expanded}
        aria-hidden={!expanded}
        data-above={placement.above}
        style={{ maxHeight: placement.height }}
      >
        <div className="direction-picker-search">
          <Icon name="search" />
          <Input
            ref={input}
            role="combobox"
            aria-label="搜索方向"
            placeholder="搜索所有方向…"
            autoComplete="off"
            value={query}
            aria-expanded={expanded}
            aria-autocomplete="list"
            aria-controls={`${id}-list`}
            aria-activedescendant={activeIndex < 0 ? undefined : `${id}-option-${activeIndex}`}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(null);
              if (list.current) list.current.scrollTop = 0;
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!matches.length) return;
                const index =
                  event.key === 'ArrowDown'
                    ? (activeIndex + 1) % matches.length
                    : activeIndex < 0
                      ? matches.length - 1
                      : (activeIndex - 1 + matches.length) % matches.length;
                setActive(matches[index].id);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (activeIndex >= 0) choose(matches[activeIndex].id);
              }
            }}
          />
        </div>
        <nav className="direction-library-nav" aria-label="选择方向分类" hidden={!!term}>
          {(['custom', 'builtin'] as const).map((key) => (
            <Button
              key={key}
              type="button"
              variant="ghost"
              aria-pressed={group === key}
              onClick={() => {
                setGroup(key);
                setActive(null);
                if (list.current) list.current.scrollTop = 0;
              }}
            >
              {key === 'custom' ? '我的方向' : '内置方向'}
            </Button>
          ))}
        </nav>
        <ul
          ref={list}
          id={`${id}-list`}
          className="direction-picker-options"
          role="listbox"
          aria-label="可选方向"
        >
          {matches.map((item, index) => (
            <li
              key={item.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onPointerMove={(event) => {
                if (event.pointerType === 'mouse') setActive(item.id);
              }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(item.id)}
            >
              {item.name || '未命名方向'}
            </li>
          ))}
        </ul>
        {!matches.length && (
          <p className="direction-picker-empty" role="status">
            {term ? '没有匹配的方向' : '暂无可选方向'}
          </p>
        )}
      </div>
    </div>
  );
}
