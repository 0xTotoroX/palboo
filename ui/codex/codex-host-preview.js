/* [INPUT]: Connected CodexHost v2 status probe, unique input target and mounted Agent menu.
 * [OUTPUT]: Read-only Agent names/order/groups, availability and current selection, without chat data.
 * [POS]: On-demand CDP expression for settings; never opens menus, installs Agents or changes selection.
 * [PROTOCOL]: Keep codex/AGENTS.md and shared/codex-host.ts in sync. */
(() => {
  const unavailable = (message) => ({ status: 'unavailable', message, current: null, agents: [] });
  const probe = window.__codexhostRendererBindingProbeV1;
  if (!probe) return unavailable('当前宿主未接入 CodexHost');
  try {
    const status = probe.status();
    if (status?.version !== 2) return unavailable('当前 CodexHost 版本暂不支持 Agent 预览');
    if (!Array.isArray(status.selections) || !Array.isArray(status.enabledAgents))
      return unavailable('CodexHost Agent 状态尚未就绪');
    const controls = [...document.querySelectorAll('[data-codexhost-agent-control]')];
    const target = window.__palbooModelControl?.inputTarget();
    let matches = [];
    if (target?.composer?.isConnected) {
      const boundary = target.composer.closest(
        '[data-codex-composer-root],[data-chatgpt-composer]',
      );
      let scope = target.composer.parentElement;
      while (scope && scope !== document.body) {
        if (scope.querySelectorAll('.ProseMirror,textarea,[contenteditable="true"]').length > 1)
          break;
        matches = controls.filter((control) => scope.contains(control));
        if (matches.length || scope === boundary) break;
        scope = scope.parentElement;
      }
    } else if (status.selections.length === 1) {
      matches = controls.filter(
        (control) =>
          control.getAttribute('data-codexhost-agent-control') === status.selections[0].composerId,
      );
    } else {
      // Settings may be in front of the chat. Only use an unambiguous visible Agent control.
      matches = controls.filter((control) => {
        const rect = control.getBoundingClientRect();
        return (
          !control.closest('[hidden],[inert],[aria-hidden="true"]') &&
          getComputedStyle(control).visibility === 'visible' &&
          rect.width > 0 &&
          rect.height > 0 &&
          status.selections.some(
            (selection) =>
              selection.composerId === control.getAttribute('data-codexhost-agent-control'),
          )
        );
      });
      if (matches.length !== 1 && status.selections.length > 1)
        return unavailable('请先选定聊天以读取当前 Agent');
    }
    if (!matches.length) return unavailable('当前输入框未接入 CodexHost');
    if (matches.length > 1) return unavailable('当前输入框对应多个 CodexHost 控件');
    const id = matches[0].getAttribute('data-codexhost-agent-control');
    const selections = status.selections.filter((selection) => selection.composerId === id);
    if (selections.length !== 1 || typeof selections[0].agent !== 'string')
      return unavailable('无法确认当前 CodexHost Agent');
    const menu = document.getElementById(`${id}-agent-menu`);
    if (!menu || menu.getAttribute('role') !== 'menu')
      return unavailable('CodexHost Agent 菜单尚未就绪');
    const enabled = new Set(status.enabledAgents.filter((value) => typeof value === 'string'));
    const selectedButtons = [...menu.querySelectorAll('button[data-agent][aria-checked="true"]')];
    if (
      selectedButtons.length !== 1 ||
      selectedButtons[0].getAttribute('data-agent') !== selections[0].agent
    )
      return unavailable('CodexHost Agent 状态正在同步');
    const seen = new Set();
    const agents = [];
    for (const button of menu.querySelectorAll('button[data-agent][role="menuitemradio"]')) {
      const agent = button.getAttribute('data-agent');
      if (!enabled.has(agent) || seen.has(agent)) continue;
      seen.add(agent);
      const labelNode =
        button.querySelector('.codexhost-agent-picker__item-label') || button.lastElementChild;
      const label = (labelNode?.textContent || button.textContent || agent).trim();
      const action = button.parentElement?.querySelector('button[data-mode="install"]');
      const availability = status.availability?.[agent];
      agents.push({
        id: agent,
        label,
        group: menu.firstElementChild?.contains(button) ? 'main' : 'more',
        availability:
          agent === 'codex' ? 'ready' : typeof availability === 'string' ? availability : 'unknown',
        // A locked chat disables every menu option but does not make installed Agents unavailable.
        available: agent === 'codex' || availability === 'ready',
        canAdd:
          action instanceof HTMLButtonElement &&
          !action.disabled &&
          !action.hidden &&
          action.getAttribute('aria-hidden') !== 'true' &&
          action.style.visibility !== 'hidden',
      });
    }
    if (!agents.length || !seen.has(selections[0].agent))
      return unavailable('CodexHost Agent 菜单尚未就绪');
    return { status: 'ready', message: '', current: selections[0].agent, agents };
  } catch {
    return unavailable('无法读取 CodexHost Agent 状态');
  }
})();
