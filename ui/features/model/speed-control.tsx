/* [INPUT]: Current chat revision, confirmed speed, model capabilities and the existing Fast animation.
 * [OUTPUT]: Single/double-click arbitration, speed menu and compact speed icons shared by presets.
 * [POS]: Model matrix header; delegates the only write to ModelView's serialized action.
 * [PROTOCOL]: Keep model/AGENTS.md in sync. */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { tr } from '../../shared/i18n.js';
import { iconSvg } from '../../shared/icons/index.js';
import {
  modelSpeedLabel,
  modelSpeeds,
  supportsModelSpeed,
  type Model,
  type ModelSpeed,
} from './catalog';
import type { useSpeedMotion } from './speed-motion';

const doubleClickMs = 320;

function collectAncestors(node: Node): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement) ancestors.push(current);
    current = current instanceof ShadowRoot ? current.host : current.parentNode;
  }
  return ancestors;
}

function collectScrollRoots(node: Node): EventTarget[] {
  const roots = new Set<EventTarget>();
  if (node.ownerDocument) {
    roots.add(node.ownerDocument);
    if (node.ownerDocument.defaultView) roots.add(node.ownerDocument.defaultView);
  }
  let current: Node | null = node;
  while (current) {
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      roots.add(root);
      current = root.host;
    } else {
      break;
    }
  }
  return [...roots];
}

function isAnchorInactive(anchor: HTMLElement): boolean {
  if (!anchor.isConnected) return true;
  const view = anchor.ownerDocument.defaultView;
  for (const el of collectAncestors(anchor)) {
    if (el.inert || el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const style = view?.getComputedStyle(el);
    if (style && (style.display === 'none' || style.visibility !== 'visible')) return true;
  }
  const rect = anchor.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0;
}

function containsAnchor(target: EventTarget | null, anchor: HTMLElement): boolean {
  if (!target) return false;
  const doc = anchor.ownerDocument;
  if (target === doc || target === doc.defaultView) return true;
  if (!(target instanceof Node)) return false;
  let current: Node | null = anchor;
  while (current) {
    if (current === target) return true;
    current = current instanceof ShadowRoot ? current.host : current.parentNode;
  }
  return false;
}

export function ModelSpeedIcon({
  speed,
  glyphRef,
}: {
  speed: string;
  glyphRef?: Ref<HTMLSpanElement>;
}) {
  if (speed !== 'ultrafast') {
    return (
      <span
        ref={glyphRef}
        dangerouslySetInnerHTML={{ __html: iconSvg(speed === 'fast' ? 'bolt-filled' : 'bolt') }}
      />
    );
  }
  return (
    <span ref={glyphRef}>
      <svg aria-hidden="true" data-icon="bolt-ultrafast" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10.5 3.1 2.2 12a.8.8 0 0 0 .6 1.3h4.5l-1.4 5.6a.6.6 0 0 0 1 .6l8.3-8.9a.8.8 0 0 0-.6-1.3h-4.4l1.3-5.6a.6.6 0 0 0-1-.6ZM17.9 6.2a.6.6 0 0 1 1 .6l-1.3 5.6h3.6a.8.8 0 0 1 .6 1.3l-7.7 8.2a.6.6 0 0 1-1-.6l1.3-5.6h-2.1l4.7-5a2.3 2.3 0 0 0 .3-2.9l.6-1.6Z" />
      </svg>
    </span>
  );
}

export function ModelSpeedControl({
  model,
  active,
  revision,
  nameWidth,
  disabled,
  surfaceActive = true,
  motion,
  select,
}: {
  model: Model | undefined;
  active: string | undefined;
  revision: string;
  nameWidth: number;
  disabled: boolean;
  surfaceActive?: boolean;
  motion: ReturnType<typeof useSpeedMotion>;
  select: (speed: ModelSpeed, doubleClick?: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const pendingClick = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openedOrigin = useRef<{ left: number; top: number } | null>(null);
  const menuId = useId();
  const [expanded, setExpanded] = useState(false);
  const { button, fill, phase } = motion;
  const canUltra = supportsModelSpeed(model, 'ultrafast');
  const canFast = supportsModelSpeed(model, 'fast');
  const speed = modelSpeeds.find((speed) => speed === active && supportsModelSpeed(model, speed));
  const hint = canUltra ? tr('双击切换超快，右键或向下键选择速度') : tr('右键或向下键选择速度');

  function cancelClick() {
    clearTimeout(pendingClick.current);
    pendingClick.current = undefined;
  }

  function hideMenu(restoreFocus = false) {
    const popover = menu.current;
    const anchor = button.current;
    const doc = anchor?.ownerDocument;
    if (popover?.matches(':popover-open')) {
      let activeNode: Element | null = doc?.activeElement ?? null;
      while (activeNode?.shadowRoot?.activeElement)
        activeNode = activeNode.shadowRoot.activeElement;
      if (!restoreFocus && activeNode instanceof HTMLElement && popover.contains(activeNode)) {
        activeNode.blur();
      }
      popover.hidePopover();
    }
    openedOrigin.current = null;
    setExpanded(false);
    if (restoreFocus && anchor && !isAnchorInactive(anchor)) {
      anchor.focus({ preventScroll: true });
    }
  }

  useLayoutEffect(() => {
    const popover = menu.current;
    if (disabled || !surfaceActive) {
      cancelClick();
      if (popover?.matches(':popover-open')) popover.hidePopover();
      setExpanded(false);
    }
    return () => {
      cancelClick();
      if (popover?.matches(':popover-open')) popover.hidePopover();
    };
  }, [revision, speed, disabled, surfaceActive, canUltra, canFast]);

  useEffect(() => {
    const anchor = button.current;
    if (!anchor) return;
    const document = anchor.ownerDocument;
    const cancelOutside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (path.includes(anchor)) return;
      cancelClick();
      const popover = menu.current;
      if (popover?.matches(':popover-open') && !path.includes(popover)) hideMenu(false);
    };
    const onVisibility = () => {
      cancelClick();
      if (document.hidden) hideMenu(false);
    };
    document.addEventListener('pointerdown', cancelOutside, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('pointerdown', cancelOutside, true);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [button]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const anchor = button.current;
    const popover = menu.current;
    if (!anchor || !popover) return;
    const doc = anchor.ownerDocument;
    const view = doc.defaultView;
    const closeIfInactive = () => {
      if (isAnchorInactive(anchor)) hideMenu(false);
    };
    if (isAnchorInactive(anchor)) {
      hideMenu(false);
      return;
    }
    const onScroll = (event: Event) => {
      if (!popover.matches(':popover-open')) return;
      const target = event.target;
      if (target instanceof Node && (target === popover || popover.contains(target))) return;
      if (!containsAnchor(target, anchor)) return;
      const origin = openedOrigin.current;
      if (origin) {
        const next = anchor.getBoundingClientRect();
        if (Math.abs(next.left - origin.left) < 0.5 && Math.abs(next.top - origin.top) < 0.5) {
          return;
        }
      }
      hideMenu(false);
    };
    const onResize = () => {
      if (popover.matches(':popover-open')) hideMenu(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || !popover.matches(':popover-open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hideMenu(true);
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const options = [...popover.querySelectorAll<HTMLButtonElement>('button:enabled')];
      if (!options.length) return;
      let activeNode: Element | null = doc.activeElement;
      while (activeNode?.shadowRoot?.activeElement)
        activeNode = activeNode.shadowRoot.activeElement;
      if (activeNode && activeNode !== doc.body && !popover.contains(activeNode)) return;
      let index = options.indexOf(activeNode as HTMLButtonElement);
      if (index < 0) {
        index = options.findIndex((item) => item.getAttribute('aria-checked') === 'true');
      }
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : (index + options.length + (event.key === 'ArrowUp' ? -1 : 1)) % options.length;
      event.preventDefault();
      event.stopPropagation();
      options[next]?.focus({ preventScroll: true });
    };
    const scrollRoots = collectScrollRoots(anchor);
    for (const root of scrollRoots) root.addEventListener('scroll', onScroll, true);
    view?.addEventListener('resize', onResize);
    doc.addEventListener('keydown', onKeyDown, true);

    const mutation = new MutationObserver(closeIfInactive);
    for (const ancestor of collectAncestors(anchor)) {
      mutation.observe(ancestor, {
        attributes: true,
        attributeFilter: ['inert', 'hidden', 'aria-hidden', 'data-active', 'style', 'class'],
      });
    }
    const resizeObserver = new ResizeObserver(closeIfInactive);
    resizeObserver.observe(anchor);
    const intersection = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => !entry.isIntersecting)) hideMenu(false);
      },
      { threshold: 0 },
    );
    intersection.observe(anchor);

    return () => {
      for (const root of scrollRoots) root.removeEventListener('scroll', onScroll, true);
      view?.removeEventListener('resize', onResize);
      doc.removeEventListener('keydown', onKeyDown, true);
      mutation.disconnect();
      resizeObserver.disconnect();
      intersection.disconnect();
    };
  }, [expanded, button]);

  function showMenu() {
    cancelClick();
    const popover = menu.current;
    const anchor = button.current;
    const window = anchor?.ownerDocument.defaultView;
    if (
      disabled ||
      !surfaceActive ||
      !popover ||
      !anchor ||
      !window ||
      isAnchorInactive(anchor) ||
      popover.matches(':popover-open')
    )
      return;
    popover.showPopover();
    setExpanded(true);
    const rect = anchor.getBoundingClientRect();
    openedOrigin.current = { left: rect.left, top: rect.top };
    const { offsetWidth: width, offsetHeight: height } = popover;
    const margin = 6;
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    const below = rect.bottom + 4;
    const top = below + height <= window.innerHeight - margin ? below : rect.top - height - 4;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(margin, top)}px`;
    (
      popover.querySelector<HTMLButtonElement>('[aria-checked="true"]:enabled') ??
      popover.querySelector<HTMLButtonElement>('button:enabled')
    )?.focus({ preventScroll: true });
  }

  function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      hideMenu(true);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled')];
    const index = options.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (index + options.length + (event.key === 'ArrowUp' ? -1 : 1)) % options.length;
    event.preventDefault();
    event.stopPropagation();
    options[next]?.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        type="button"
        ref={button}
        className="model-icon-button model-fast"
        aria-label={canUltra && speed ? `${tr('速度')} · ${modelSpeedLabel(speed)}` : 'Fast'}
        aria-description={hint}
        aria-pressed={speed === 'fast' || speed === 'ultrafast'}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={expanded}
        title={hint}
        data-phase={phase}
        data-filled={speed === 'fast'}
        data-tier={speed}
        style={{ left: nameWidth - 6 }}
        disabled={disabled || (!canFast && !canUltra)}
        onClick={(event) => {
          const single = () => {
            if (speed !== 'standard') select('standard');
            else if (canFast) select('fast');
          };
          if (!canUltra || event.detail === 0) {
            cancelClick();
            single();
          } else if (pendingClick.current !== undefined) {
            cancelClick();
            select('ultrafast', true);
          } else {
            pendingClick.current = setTimeout(() => {
              pendingClick.current = undefined;
              if (!button.current?.disabled) single();
            }, doubleClickMs);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showMenu();
        }}
        onKeyDown={(event) => {
          if (!(
            event.key === 'ArrowDown' ||
            event.key === 'ContextMenu' ||
            (event.shiftKey && event.key === 'F10')
          ))
            return;
          event.preventDefault();
          event.stopPropagation();
          showMenu();
        }}
      >
        <ModelSpeedIcon
          speed={speed === 'ultrafast' ? speed : 'standard'}
          glyphRef={motion.glyph}
        />
        <span
          ref={fill}
          className="model-fast-fill"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconSvg('bolt-filled') }}
        />
      </button>
      <div
        ref={menu}
        id={menuId}
        className="model-speed-menu"
        role="menu"
        aria-label={tr('速度')}
        popover="manual"
        onToggle={(event) => setExpanded(event.currentTarget.matches(':popover-open'))}
        onMouseDown={(event) => {
          if (!(event.target instanceof Element && event.target.closest('button:enabled'))) {
            event.preventDefault();
          }
        }}
        onKeyDown={moveMenuFocus}
      >
        {modelSpeeds.map((option) => (
          <button
            type="button"
            role="menuitemradio"
            tabIndex={-1}
            key={option}
            aria-checked={speed === option}
            disabled={disabled || !supportsModelSpeed(model, option)}
            onClick={() => {
              hideMenu(true);
              select(option);
            }}
          >
            <span>{modelSpeedLabel(option)}</span>
            {speed === option && <span dangerouslySetInnerHTML={{ __html: iconSvg('check') }} />}
          </button>
        ))}
      </div>
    </>
  );
}
