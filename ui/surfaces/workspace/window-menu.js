/* [INPUT]: Current main window, checked layout snapshots and existing pin/settings callbacks.
 * [OUTPUT]: Accessible window menu with pin, named layouts and draft-preserving save.
 * [POS]: Shared sidebar/overlay/desktop chrome; only desktop receives pin/lease capabilities.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { tr } from '../../shared/i18n.js';
import { iconSvg } from '../../shared/icons/index.js';
import { errorMessage } from '../../shared/text.js';
import {
  mainFeatureIds,
  layoutSnapshot,
  matchesLayoutPreset,
  sortedLayoutPresets,
  layoutPresetLabel,
  builtinLayout,
  builtinLayoutAvailable,
  builtinLayoutPresets,
  matchingBuiltinLayout,
} from './layout-presets.js';

export function installWindowMenu(
  container,
  {
    request,
    lease = null,
    layout,
    pin = null,
    settings,
    refresh,
    isBusy,
    canUndo = () => false,
    undo,
  },
) {
  container.innerHTML = `<div class="csw-window-menu"><button type="button" class="csw-icon" data-window-menu aria-haspopup="menu" aria-expanded="false">${iconSvg('more')}</button><div class="csw-window-menu-panel" role="menu" hidden><button type="button" role="menuitemcheckbox" data-menu-pin aria-checked="true">${iconSvg('pin')}<span data-copy="窗口置顶"></span><span class="csw-menu-check">${iconSvg('check')}</span></button><div class="csw-menu-divider"></div><div class="csw-menu-caption" data-copy="布局预设"></div><div data-presets></div><button type="button" role="menuitem" data-undo-layout><span data-copy="撤销布局更改"></span></button><button type="button" role="menuitem" data-save-preset>${iconSvg('plus')}<span data-copy="保存当前布局…"></span></button><button type="button" role="menuitem" data-manage-presets>${iconSvg('settings')}<span data-copy="管理布局预设…"></span></button></div><form class="csw-window-menu-panel csw-preset-save" hidden><label><span data-copy="预设名称"></span><input name="name" maxlength="40" autocomplete="off" required></label><div class="csw-preset-save-actions"><button type="button" data-cancel-save data-copy="取消"></button><button type="submit" data-copy="保存"></button></div></form><p class="csw-window-menu-error" role="alert" hidden></p></div>`;
  const root = container.firstElementChild;
  const trigger = root.querySelector('[data-window-menu]');
  const menu = root.querySelector('[role=menu]');
  const form = root.querySelector('form');
  const name = form.querySelector('input');
  const message = root.querySelector('[role=alert]');
  const presets = root.querySelector('[data-presets]');
  const undoButton = root.querySelector('[data-undo-layout]');
  root.querySelector('[data-menu-pin]').hidden = !pin;
  root.querySelector('.csw-menu-divider').hidden = !pin;
  const events = new AbortController();
  let state,
    pinned = true,
    pending = false,
    signature = '',
    saveContext;
  const busy = () => pending || isBusy();
  const context = () => ({
    placement: state.mainPlacement,
    ...(lease ? { lease } : {}),
    expectedRevision: state.layoutPresetsRevision || 0,
    expectedLayout: structuredClone(state.layouts?.[state.mainPlacement] ?? null),
  });
  function close(focus = false) {
    menu.hidden = form.hidden = true;
    message.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    delete container.dataset.menuOpen;
    if (focus) trigger.focus();
  }
  function open() {
    if (!state || busy()) return;
    message.hidden = true;
    form.hidden = true;
    render();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    container.dataset.menuOpen = 'true';
    menu.querySelector('button:not(:disabled):not([hidden])')?.focus();
  }
  async function run(action, onSuccess = () => close(true)) {
    if (busy()) return;
    pending = true;
    message.hidden = true;
    render();
    try {
      await action();
      await refresh();
      onSuccess();
    } catch (error) {
      message.textContent = errorMessage(error);
      (form.hidden ? menu : form).append(message);
      message.hidden = false;
    } finally {
      pending = false;
      render();
    }
  }
  function render() {
    trigger.setAttribute('aria-label', tr(pin ? '窗口操作' : '布局预设'));
    menu.setAttribute('aria-label', tr(pin ? '窗口操作' : '布局预设'));
    root.querySelectorAll('[data-copy]').forEach((node) => {
      node.textContent = tr(node.dataset.copy);
    });
    root.querySelector('[data-menu-pin]').setAttribute('aria-checked', String(pinned));
    const entries = sortedLayoutPresets(
      state?.layoutPresets || [],
      state?.mainPlacement || 'sidebar',
    );
    const options = [
      ...builtinLayoutPresets(),
      ...entries.map((preset) => ({ id: preset.id, label: layoutPresetLabel(preset) })),
    ];
    const next = JSON.stringify(options);
    if (signature !== next) {
      signature = next;
      presets.replaceChildren(
        ...options.map((preset) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', 'menuitemradio');
          button.dataset.preset = preset.id;
          const label = document.createElement('span');
          label.textContent = preset.label;
          const check = document.createElement('span');
          check.className = 'csw-menu-check';
          check.innerHTML = iconSvg('check');
          button.append(label, check);
          return button;
        }),
      );
    }
    const current = layout();
    const ids = state ? mainFeatureIds(state) : [];
    const selected =
      current &&
      (entries.find((preset) => matchesLayoutPreset(preset, current, ids))?.id ||
        matchingBuiltinLayout(current, ids));
    root.querySelectorAll('button,input').forEach((node) => {
      node.disabled = busy() || !state;
    });
    undoButton.hidden = !canUndo();
    for (const button of presets.querySelectorAll('button')) {
      button.setAttribute('aria-checked', String(button.dataset.preset === selected));
      button.disabled ||= !builtinLayoutAvailable(button.dataset.preset, ids);
    }
  }
  trigger.addEventListener(
    'click',
    () => (trigger.getAttribute('aria-expanded') === 'true' ? close(true) : open()),
    { signal: events.signal },
  );
  trigger.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        open();
      }
    },
    { signal: events.signal },
  );
  menu.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('button');
      if (!button || button.disabled || busy()) return;
      if (button === undoButton && canUndo()) void run(undo);
      else if (button.hasAttribute('data-menu-pin')) void run(() => pin(!pinned));
      else if (builtinLayoutPresets().some(({ id }) => id === button.dataset.preset)) {
        const ids = mainFeatureIds(state);
        const entry = state.features.find(({ id }) => ids.includes(id));
        const current = layout();
        if (entry && current)
          void run(() =>
            request({
              op: 'layout',
              id: entry.id,
              owner: entry.owner,
              placement: state.mainPlacement,
              expectedLayout: context().expectedLayout,
              layout: builtinLayout(button.dataset.preset, current, ids, state.activeFeature),
            }),
          );
      } else if (button.dataset.preset)
        void run(() =>
          request({ op: 'main-preset-apply', ...context(), id: button.dataset.preset }),
        );
      else if (button.hasAttribute('data-manage-presets')) void run(settings);
      else if (button.hasAttribute('data-save-preset')) {
        saveContext = {
          ...context(),
          scope: state.mainPlacement,
          layout: layoutSnapshot(layout(), mainFeatureIds(state)),
        };
        menu.hidden = true;
        form.hidden = false;
        name.focus();
      }
    },
    { signal: events.signal },
  );
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      if (!name.value.trim()) {
        name.focus();
        return;
      }
      void run(
        () =>
          request({
            op: 'main-preset-save',
            ...saveContext,
            expectedRevision: state.layoutPresetsRevision || 0,
            name: name.value.trim(),
          }),
        () => {
          name.value = '';
          close(true);
        },
      );
    },
    { signal: events.signal },
  );
  root
    .querySelector('[data-cancel-save]')
    .addEventListener('click', () => close(true), { signal: events.signal });
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
      if (menu.hidden || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...menu.querySelectorAll('button:not(:disabled):not([hidden])')];
      const current = buttons.indexOf(document.activeElement);
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    },
    { signal: events.signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!root.contains(event.target)) close();
    },
    { signal: events.signal },
  );
  root.addEventListener(
    'focusout',
    (event) => {
      if (event.relatedTarget && !root.contains(event.relatedTarget) && !pending) close();
    },
    { signal: events.signal },
  );
  return {
    update(next, alwaysOnTop) {
      state = next;
      pinned = alwaysOnTop;
      render();
    },
    destroy() {
      events.abort();
      root.remove();
    },
  };
}
