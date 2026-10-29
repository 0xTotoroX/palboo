/* [INPUT]: Current main window, checked layout snapshots and existing pin/settings callbacks.
 * [OUTPUT]: Accessible window menu with pin, named layouts and draft-preserving save.
 * [POS]: Desktop chrome only; preset persistence belongs to the features service.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { tr } from '../../shared/i18n.js';
import { iconSvg } from '../../shared/icons/index.js';
import { errorMessage } from '../../shared/text.js';
import { mainFeatureIds, layoutSnapshot, matchesLayoutPreset } from './layout-presets.js';

export function installWindowMenu(
  container,
  { request, lease, layout, pin, settings, refresh, isBusy },
) {
  container.innerHTML = `<div class="csw-window-menu"><button type="button" class="csw-icon" data-window-menu aria-haspopup="menu" aria-expanded="false">${iconSvg('more')}</button><div class="csw-window-menu-panel" role="menu" hidden><button type="button" role="menuitemcheckbox" data-menu-pin aria-checked="true">${iconSvg('pin')}<span data-copy="窗口置顶"></span><span class="csw-menu-check">${iconSvg('check')}</span></button><div class="csw-menu-divider"></div><div class="csw-menu-caption" data-copy="布局预设"></div><div data-presets></div><div class="csw-menu-empty" data-empty data-copy="暂无布局预设"></div><button type="button" role="menuitem" data-save-preset>${iconSvg('plus')}<span data-copy="保存当前布局…"></span></button><button type="button" role="menuitem" data-manage-presets>${iconSvg('settings')}<span data-copy="管理布局预设…"></span></button></div><form class="csw-window-menu-panel csw-preset-save" hidden><label><span data-copy="预设名称"></span><input name="name" maxlength="40" autocomplete="off" required></label><div class="csw-preset-save-actions"><button type="button" data-cancel-save data-copy="取消"></button><button type="submit" data-copy="保存"></button></div></form><p class="csw-window-menu-error" role="alert" hidden></p></div>`;
  const root = container.firstElementChild;
  const trigger = root.querySelector('[data-window-menu]');
  const menu = root.querySelector('[role=menu]');
  const form = root.querySelector('form');
  const name = form.querySelector('input');
  const message = root.querySelector('[role=alert]');
  const presets = root.querySelector('[data-presets]');
  const events = new AbortController();
  let state,
    pinned = true,
    pending = false,
    signature = '',
    saveContext;
  const busy = () => pending || isBusy();
  const context = () => ({
    placement: state.mainPlacement,
    lease,
    expectedRevision: state.layoutPresetsRevision || 0,
    expectedLayout: structuredClone(state.layouts?.desktop ?? null),
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
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    container.dataset.menuOpen = 'true';
    menu.querySelector('button:not(:disabled)')?.focus();
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
    trigger.setAttribute('aria-label', tr('窗口操作'));
    menu.setAttribute('aria-label', tr('窗口操作'));
    root.querySelectorAll('[data-copy]').forEach((node) => {
      node.textContent = tr(node.dataset.copy);
    });
    root.querySelector('[data-menu-pin]').setAttribute('aria-checked', String(pinned));
    const entries = state?.layoutPresets || [];
    const next = JSON.stringify(entries.map((preset) => [preset.id, preset.name]));
    if (signature !== next) {
      signature = next;
      presets.replaceChildren(
        ...entries.map((preset) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', 'menuitemradio');
          button.dataset.preset = preset.id;
          const label = document.createElement('span');
          label.textContent = preset.name;
          const check = document.createElement('span');
          check.className = 'csw-menu-check';
          check.innerHTML = iconSvg('check');
          button.append(label, check);
          return button;
        }),
      );
    }
    root.querySelector('[data-empty]').hidden = !!entries.length;
    const current = layout();
    for (const button of presets.querySelectorAll('button')) {
      const preset = entries.find((entry) => entry.id === button.dataset.preset);
      button.setAttribute(
        'aria-checked',
        String(
          !!preset && !!current && matchesLayoutPreset(preset, current, mainFeatureIds(state)),
        ),
      );
    }
    root.querySelectorAll('button,input').forEach((node) => {
      node.disabled = busy() || !state;
    });
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
      if (!button || busy()) return;
      if (button.hasAttribute('data-menu-pin')) void run(() => pin(!pinned));
      else if (button.dataset.preset)
        void run(() =>
          request({ op: 'main-preset-apply', ...context(), id: button.dataset.preset }),
        );
      else if (button.hasAttribute('data-manage-presets')) void run(settings);
      else if (button.hasAttribute('data-save-preset')) {
        saveContext = { ...context(), layout: layoutSnapshot(layout(), mainFeatureIds(state)) };
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
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
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
