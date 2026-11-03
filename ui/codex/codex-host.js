/* [INPUT]: CodexHost 0.10.2 的版本化只读探针、输入框附近的 Agent 控件与外部模型菜单。
 * [OUTPUT]: window.__palbooHostCompatibility，按输入框判断官方/外部模型与新会话 Agent 切换能力，并只读回读或触发上游既有菜单项。
 * [POS]: 上游适配边界；缺失或未知协议拒绝模型写入，不覆盖上游实现。
 * [PROTOCOL]: 变更时同步 codex/AGENTS.md。 */
(() => {
  // Remains a standalone CDP script; the mounted workspace supplies UI localization.
  const tr = (source, values = {}) =>
    window['__companionFloatingPanel']?.translate?.(source, values) ??
    source.replace(/\{\{(\w+)\}\}/g, (match, key) => String(values[key] ?? match));

  /** @param {Element | null | undefined} node */
  const clean = (node) =>
    String(node?.getAttribute?.('aria-label') || node?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

  /** @param {Element | null | undefined} node */
  const isButtonEnabled = (node) =>
    node instanceof HTMLButtonElement &&
    !node.disabled &&
    node.getAttribute('aria-disabled') !== 'true';

  const esc = (value) =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(String(value))
      : String(value).replace(/["\\]/g, '\\$&');

  const canonicalThinking = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase();

  function normalizeExternalReasoning(list) {
    if (!Array.isArray(list)) return [];
    const items = [...new Set(list.map(canonicalThinking).filter(Boolean))];
    return items.length === 0 || (items.length === 1 && items[0] === 'off') ? [] : items;
  }

  function findAgentScope(composer) {
    let scope = composer?.parentElement;
    while (scope && scope !== document.body) {
      const controls = scope.querySelectorAll('[data-codexhost-agent-control]');
      if (controls.length) return { scope, controls };
      // Do not borrow controls from another composer's ancestor.
      if (scope.querySelectorAll('.ProseMirror,textarea,[contenteditable="true"]').length > 1)
        break;
      scope = scope.parentElement;
    }
    return { scope: null, controls: [] };
  }

  function externalModelDom(scope, composerId) {
    if (!composerId) return null;
    const selector = `[data-codexhost-model-control="${esc(composerId)}"]`;
    const control = scope?.querySelector(selector) || document.querySelector(selector);
    const trigger = control?.querySelector(
      'button[aria-haspopup="menu"],[role="button"][aria-haspopup="menu"]',
    );
    const menu = document.getElementById(`${composerId}-model-menu`);
    const submenu = document.getElementById(`${composerId}-model-submenu`);
    return control && trigger && (menu || submenu) ? { control, trigger, menu, submenu } : null;
  }

  function readAgentInfo(composerId, status, selection, control) {
    const menu = document.getElementById(`${composerId}-agent-menu`);
    const buttons = menu
      ? [...menu.querySelectorAll('button[data-agent][role="menuitemradio"]')]
      : [];
    const options = [];
    const seen = new Set();
    for (const button of buttons) {
      const id = String(button.getAttribute('data-agent') || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const labelNode = button.querySelector('.codexhost-agent-picker__item-label');
      const label = clean(labelNode) || clean(button) || id;
      const available = isButtonEnabled(button);
      options.push({ id, label, available });
    }
    if (!options.length && Array.isArray(status?.enabledAgents)) {
      for (const raw of status.enabledAgents) {
        const id = String(raw || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const availability = status?.availability?.[id];
        options.push({
          id,
          label: id === 'codex' ? 'Codex' : id,
          available: id === 'codex' || !availability || availability === 'ready',
        });
      }
    }
    const current = String(selection?.agent || '').trim();
    const triggerLabel = clean(control?.querySelector('.codexhost-agent-picker__label'));
    const matched = options.find((item) => item.id === current);
    return {
      current,
      label: matched?.label || triggerLabel || (current === 'codex' ? 'Codex' : current),
      locked: selection?.phase === 'locked',
      options,
    };
  }

  /** @param {Element | null | undefined} composer */
  function capability(composer) {
    const probe = window.__codexhostRendererBindingProbeV1;
    const { scope, controls } = findAgentScope(composer);
    if (controls.length) {
      if (controls.length !== 1)
        return {
          officialModel: false,
          externalModel: false,
          message: tr('无法确认当前 CodexHost Agent'),
          agent: null,
        };
      const control = controls[0];
      const id = control.getAttribute('data-codexhost-agent-control');
      if (!probe)
        return {
          officialModel: false,
          externalModel: false,
          message: tr('CodexHost 状态接口尚未就绪'),
          agent: null,
        };
      let selection, agentInfo;
      try {
        const status = probe.status();
        if (status?.version !== 2)
          return {
            officialModel: false,
            externalModel: false,
            message: tr('当前 CodexHost 版本尚未适配模型切换'),
            agent: null,
          };
        const selections = Array.isArray(status.selections)
          ? status.selections.filter((item) => item.composerId === id)
          : null;
        if (!id || selections?.length !== 1 || !selections[0]?.agent)
          return {
            officialModel: false,
            externalModel: false,
            message: tr('无法确认当前 CodexHost Agent'),
            agent: null,
          };
        selection = selections[0];
        agentInfo = readAgentInfo(id, status, selection, control);
      } catch {
        return {
          officialModel: false,
          externalModel: false,
          message: tr('无法读取 CodexHost Agent 状态'),
          agent: null,
        };
      }
      if (selection.agent === 'codex') {
        return {
          officialModel: true,
          externalModel: false,
          message: '',
          composerId: id,
          agent: agentInfo,
        };
      }
      const ext = externalModelDom(scope, id);
      if (ext) {
        return {
          officialModel: false,
          externalModel: true,
          message: '',
          composerId: id,
          agent: agentInfo,
        };
      }
      return {
        officialModel: false,
        externalModel: false,
        message: tr('当前使用 {{agent}}，请通过 CodexHost 切换模型', { agent: selection.agent }),
        composerId: id,
        agent: agentInfo,
      };
    }
    return probe || document.querySelector('[data-codexhost-agent-control]')
      ? {
          officialModel: false,
          externalModel: false,
          message: tr('CodexHost 输入框尚未就绪'),
          agent: null,
        }
      : { officialModel: true, externalModel: false, message: '', agent: null };
  }

  /** @param {Element | null | undefined} composer */
  function readExternal(composer) {
    const cap = capability(composer);
    if (!cap.externalModel || !cap.composerId) {
      return {
        status: 'unavailable',
        message:
          cap.message ||
          tr('当前使用 {{agent}}，请通过 CodexHost 切换模型', {
            agent: cap.agent?.current || 'Agent',
          }),
        models: [],
        current: null,
        stamp: '',
        agent: cap.agent || null,
      };
    }
    const { scope } = findAgentScope(composer);
    const ext = externalModelDom(scope, cap.composerId);
    if (!ext) {
      return {
        status: 'unavailable',
        message: tr('CodexHost 模型菜单尚未就绪'),
        models: [],
        current: null,
        stamp: '',
        agent: cap.agent,
      };
    }
    const rawSig = ext.control.getAttribute('data-catalog-signature') || '';
    let parsed = null;
    if (rawSig) {
      try {
        parsed = JSON.parse(rawSig);
      } catch {}
    }
    const models = [];
    const seen = new Set();
    if (Array.isArray(parsed?.models)) {
      for (const item of parsed.models) {
        const id = String(item?.ref?.id ?? item?.id ?? '').trim();
        const baseLabel = String(item?.label || id).trim();
        const resolved = String(item?.resolvedModelLabel || '').trim();
        if (!id || !baseLabel || seen.has(id)) continue;
        seen.add(id);
        const label =
          resolved && resolved.toLowerCase() !== baseLabel.toLowerCase()
            ? `${baseLabel} · ${resolved}`
            : baseLabel;
        models.push({
          id,
          label,
          reasoning: normalizeExternalReasoning(item?.supportedThinkingOptionIds),
          fast: false,
        });
      }
    }
    const modelButtons = ext.submenu
      ? [...ext.submenu.querySelectorAll('button[data-model-id][role="menuitemradio"]')]
      : [];
    if (!models.length && modelButtons.length) {
      const fallbackThinking = ext.menu
        ? [
            ...ext.menu.querySelectorAll('button[data-thinking-option-id][role="menuitemradio"]'),
          ].map((btn) => btn.getAttribute('data-thinking-option-id'))
        : [];
      const reasoning = normalizeExternalReasoning(fallbackThinking);
      for (const button of modelButtons) {
        const id = String(button.getAttribute('data-model-id') || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const mainText =
          clean(button.querySelector('.codexhost-model-picker__item-main')) || clean(button) || id;
        const subText = clean(button.querySelector('.codexhost-model-picker__item-sub'));
        const label =
          subText && subText.toLowerCase() !== mainText.toLowerCase()
            ? `${mainText} · ${subText}`
            : mainText;
        models.push({ id, label, reasoning, fast: false });
      }
    }
    const checkedModelBtn = modelButtons.find((btn) => btn.getAttribute('aria-checked') === 'true');
    const checkedModelId = String(checkedModelBtn?.getAttribute('data-model-id') || '').trim();
    const selectedModel =
      models.find((m) => m.id === checkedModelId) ||
      (parsed?.modelLabel
        ? models.find(
            (m) =>
              m.label === parsed.modelLabel ||
              m.label.split(' · ')[0] === parsed.modelLabel ||
              m.id === parsed.modelLabel,
          )
        : null) ||
      null;
    const thinkingButtons = ext.menu
      ? [...ext.menu.querySelectorAll('button[data-thinking-option-id][role="menuitemradio"]')]
      : [];
    const checkedThinkingBtn = thinkingButtons.find(
      (btn) => btn.getAttribute('aria-checked') === 'true',
    );
    const checkedThinkingId = canonicalThinking(
      checkedThinkingBtn?.getAttribute('data-thinking-option-id'),
    );
    let current = null;
    if (selectedModel) {
      const reasoning = selectedModel.reasoning.length
        ? selectedModel.reasoning.includes(checkedThinkingId)
          ? checkedThinkingId
          : selectedModel.reasoning[0]
        : '';
      current = { model: selectedModel.id, reasoning, speed: 'standard' };
    }
    const busy = ext.trigger.getAttribute('aria-busy') === 'true';
    const agentLabel = cap.agent?.label || cap.agent?.current || 'Agent';
    let status = 'ready';
    let message = '';
    if (!models.length) {
      status = 'waiting';
      message = busy
        ? tr('正在读取 {{agent}} 可用模型…', { agent: agentLabel })
        : tr('当前 {{agent}} 暂无可切换的模型', { agent: agentLabel });
    } else if (!current) {
      status = 'waiting';
    }
    const stamp = JSON.stringify([
      cap.composerId,
      cap.agent?.current,
      cap.agent?.locked,
      cap.agent?.options,
      rawSig,
      current,
      busy,
    ]);
    return { status, message, models, current, stamp, agent: cap.agent };
  }

  async function waitCondition(
    fn,
    signal,
    timeoutMs = 4500,
    timeoutMessage = '等待 CodexHost 响应超时',
  ) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (signal?.aborted) throw new Error(String(signal.reason || tr('操作已取消')));
      const value = fn();
      if (value) return value;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, 25);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error(String(signal.reason || tr('操作已取消'))));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    throw new Error(tr(timeoutMessage));
  }

  async function selectExternal(composer, selection, signal) {
    const state = await waitCondition(
      () => {
        const current = readExternal(composer);
        return current.models.length ? current : null;
      },
      signal,
      4500,
      '等待 CLI 模型列表超时',
    );
    const cap = capability(composer);
    const { scope } = findAgentScope(composer);
    const ext = externalModelDom(scope, cap.composerId);
    if (!ext) throw new Error(tr('CodexHost 模型菜单尚未就绪'));
    const targetModel = state.models.find((m) => m.id === selection?.model);
    const validReasoning = targetModel
      ? targetModel.reasoning.length
        ? targetModel.reasoning.includes(selection?.reasoning)
        : !selection?.reasoning
      : false;
    if (!targetModel || !validReasoning || selection?.speed !== 'standard') {
      throw new Error(tr('完整配置不受当前 CLI 支持，未做任何修改'));
    }
    if (state.current?.model !== selection.model) {
      const btn = ext.submenu?.querySelector(
        `button[data-model-id="${esc(selection.model)}"][role="menuitemradio"]`,
      );
      if (!(btn instanceof HTMLButtonElement) || !isButtonEnabled(btn)) {
        throw new Error(tr('当前 CLI 模型选项不可用'));
      }
      btn.click();
      await waitCondition(
        () => {
          const next = readExternal(composer);
          const liveExt = externalModelDom(scope, cap.composerId);
          return liveExt?.trigger.getAttribute('aria-busy') !== 'true' &&
            next.current?.model === selection.model
            ? next
            : null;
        },
        signal,
        5000,
        'CLI 模型切换未生效',
      );
    }
    const afterModel = readExternal(composer);
    const refreshedModel = afterModel.models.find((m) => m.id === selection.model);
    if (
      refreshedModel?.reasoning.length &&
      selection.reasoning &&
      afterModel.current?.reasoning !== selection.reasoning
    ) {
      const liveExt = externalModelDom(scope, cap.composerId);
      const tBtn = liveExt?.menu?.querySelector(
        `button[data-thinking-option-id="${esc(selection.reasoning)}"][role="menuitemradio"]`,
      );
      if (!(tBtn instanceof HTMLButtonElement) || !isButtonEnabled(tBtn)) {
        throw new Error(tr('当前 CLI 思考强度选项不可用'));
      }
      tBtn.click();
      await waitCondition(
        () => {
          const next = readExternal(composer);
          const nowExt = externalModelDom(scope, cap.composerId);
          return nowExt?.trigger.getAttribute('aria-busy') !== 'true' &&
            next.current?.model === selection.model &&
            next.current?.reasoning === selection.reasoning
            ? next
            : null;
        },
        signal,
        5000,
        'CLI 思考强度切换未生效',
      );
    }
    return readExternal(composer);
  }

  async function selectAgent(composer, targetAgent, signal) {
    const cap = capability(composer);
    if (!cap.agent || !cap.composerId) {
      throw new Error(cap.message || tr('无法确认当前 CodexHost Agent'));
    }
    if (cap.agent.locked) {
      throw new Error(tr('当前会话已锁定 CLI，请新建聊天后再切换'));
    }
    const desired = String(targetAgent || '').trim();
    const option = cap.agent.options?.find((item) => item.id === desired);
    if (!option || !option.available) {
      throw new Error(tr('目标 CLI 当前不可用'));
    }
    if (cap.agent.current === desired) return cap;
    const menu = document.getElementById(`${cap.composerId}-agent-menu`);
    const btn = menu?.querySelector(`button[data-agent="${esc(desired)}"][role="menuitemradio"]`);
    if (!(btn instanceof HTMLButtonElement) || !isButtonEnabled(btn)) {
      throw new Error(tr('目标 CLI 切换入口不可用'));
    }
    btn.click();
    await waitCondition(
      () => {
        const next = capability(composer);
        if (next.agent?.current !== desired) return null;
        if (desired === 'codex') return next.officialModel ? next : null;
        return next.externalModel || next.agent?.current === desired ? next : null;
      },
      signal,
      5000,
      'CLI 切换未生效',
    );
    if (desired !== 'codex') {
      try {
        await waitCondition(
          () => {
            const ext = readExternal(composer);
            return ext.models.length ? ext : null;
          },
          signal,
          1200,
        );
      } catch {}
    }
    return capability(composer);
  }

  window.__palbooHostCompatibility = {
    capability,
    readExternal,
    selectExternal,
    selectAgent,
  };
})();
