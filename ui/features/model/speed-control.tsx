/* [INPUT]: Current chat revision, confirmed speed, model capabilities and the existing Fast animation.
 * [OUTPUT]: Single/double-click arbitration, speed menu and compact speed icons shared by presets.
 * [POS]: Model matrix header; delegates the only write to ModelView's serialized action.
 * [PROTOCOL]: Keep model/AGENTS.md in sync. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tr } from '../../shared/i18n.js';
import { iconSvg } from '../../shared/icons/index.js';
import {
  modelSpeedLabel,
  modelSpeeds,
  supportsModelSpeed,
  type Model,
  type ModelSpeed,
} from './catalog';
import type { useFastMotion } from './fast-motion';

const doubleClickMs = 320;

export function ModelSpeedIcon({ speed }: { speed: string }) {
  if (speed !== 'ultrafast') {
    return (
      <span
        dangerouslySetInnerHTML={{ __html: iconSvg(speed === 'fast' ? 'bolt-filled' : 'bolt') }}
      />
    );
  }
  return (
    <span>
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
  motion,
  select,
}: {
  model: Model | undefined;
  active: string | undefined;
  revision: string;
  nameWidth: number;
  disabled: boolean;
  motion: ReturnType<typeof useFastMotion>;
  select: (speed: ModelSpeed) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const pendingClick = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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

  useLayoutEffect(() => {
    const popover = menu.current;
    return () => {
      cancelClick();
      if (popover?.matches(':popover-open')) popover.hidePopover();
    };
  }, [revision, speed, disabled, canUltra, canFast]);

  useEffect(() => {
    const anchor = button.current;
    if (!anchor) return;
    const document = anchor.ownerDocument;
    const cancelOutside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (path.includes(anchor)) return;
      cancelClick();
      const popover = menu.current;
      if (popover?.matches(':popover-open') && !path.includes(popover)) popover.hidePopover();
    };
    document.addEventListener('pointerdown', cancelOutside, true);
    document.addEventListener('visibilitychange', cancelClick);
    return () => {
      document.removeEventListener('pointerdown', cancelOutside, true);
      document.removeEventListener('visibilitychange', cancelClick);
    };
  }, [button]);

  function showMenu() {
    cancelClick();
    const popover = menu.current;
    const anchor = button.current;
    const window = anchor?.ownerDocument.defaultView;
    if (disabled || !popover || !anchor || !window || popover.matches(':popover-open')) return;
    popover.showPopover();
    const rect = anchor.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = popover;
    const margin = 6;
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    const below = rect.bottom + 4;
    const top = below + height <= window.innerHeight - margin ? below : rect.top - height - 4;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(margin, top)}px`;
    popover
      .querySelector<HTMLButtonElement>('[aria-checked="true"]:enabled')
      ?.focus({ preventScroll: true });
  }

  function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      menu.current?.hidePopover();
      button.current?.focus({ preventScroll: true });
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
            select('ultrafast');
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
        <ModelSpeedIcon speed={speed === 'ultrafast' ? speed : 'standard'} />
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
              menu.current?.hidePopover();
              button.current?.focus({ preventScroll: true });
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
