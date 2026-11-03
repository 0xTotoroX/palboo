/* [INPUT]: CodexHost 0.10.2 的版本化只读探针、输入框附近的 Agent 控件、外部模型菜单与当前聊天上下文。
 * [OUTPUT]: window.__palbooHostCompatibility，按输入框判断官方/外部模型与 Agent 切换能力，支持外部 CLI 模型快切、新会话直接切换 CLI，以及已锁定会话新建聊天并携带上下文交接切换 CLI。
 * [POS]: 上游适配边界；缺失或未知协议拒绝模型写入，不覆盖上游实现。
 * [PROTOCOL]: 变更时同步 codex/AGENTS.md。 */
(() => {
  // Remains a standalone CDP script; the mounted workspace supplies UI localization.
  const tr = (source, values = {}) =>
    window['__companionFloatingPanel']?.translate?.(source, values) ??
    source.replace(/\{\{(\w+)\}\}/g, (match, key) => String(values[key] ?? match));

  const OWN_UI =
    '[data-companion-stepwise-root],[data-palboo-dock],[data-codexpp-qmp-root],[data-palboo-prompt],[data-palboo-features-root],[data-palboo-launcher]';

  /** @param {Element | null | undefined} node */
  const clean = (node) =>
    String(node?.getAttribute?.('aria-label') || node?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

  /** @param {Element | null | undefined} node */
  const isVisible = (node) =>
    node instanceof HTMLElement &&
    node.isConnected &&
    !node.closest('[hidden],[inert],[aria-hidden="true"]') &&
    getComputedStyle(node).visibility === 'visible' &&
    node.getBoundingClientRect().width > 0 &&
    node.getBoundingClientRect().height > 0;

  /** @param {Element | null | undefined} node */
  const isButtonEnabled = (node) =>
    node instanceof HTMLButtonElement &&
    !node.disabled &&
    node.getAttribute('aria-disabled') !== 'true';

  /**
   * @param {Element | null | undefined} node
   * @returns {node is HTMLElement}
   */
  const isActionable = (node) =>
    node instanceof HTMLElement &&
    isVisible(node) &&
    !node.closest(OWN_UI) &&
    !(node instanceof HTMLButtonElement && node.disabled) &&
    node.getAttribute('aria-disabled') !== 'true' &&
    !node.hasAttribute('data-disabled');

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

  /** @param {Element | null | undefined} target */
  function readDraftText(target) {
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      return target.value;
    }
    const isBlock = (node) =>
      node instanceof Element && /^(P|DIV|LI|UL|OL|PRE|BLOCKQUOTE|H[1-6])$/.test(node.tagName);
    const readNode = (node, trailingBreak = null) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (!(node instanceof Element)) return '';
      if (node.tagName === 'BR') return node === trailingBreak ? '' : '\n';
      if (node === target || isBlock(node)) {
        let tail = node.lastChild;
        while (tail instanceof Element && !isBlock(tail) && tail.lastChild) tail = tail.lastChild;
        trailingBreak = tail instanceof Element && tail.tagName === 'BR' ? tail : null;
      }
      let value = '';
      let previousBlock = false;
      let seen = false;
      for (const child of node.childNodes) {
        const block = isBlock(child);
        const text = readNode(child, trailingBreak);
        if (!block && !text) continue;
        if (seen && (previousBlock || (block && !value.endsWith('\n')))) value += '\n';
        value += text;
        previousBlock = block;
        seen = true;
      }
      return value;
    };
    return target ? readNode(target) : '';
  }

  /** @param {Element | null | undefined} node */
  function extractReadableText(node) {
    if (!(node instanceof Element)) return '';
    const clone = /** @type {Element} */ (node.cloneNode(true));
    clone
      .querySelectorAll(`h4.sr-only,button,[role="button"],svg,[aria-hidden="true"],${OWN_UI}`)
      .forEach((item) => item.remove());
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    clone
      .querySelectorAll('p,li,pre,h1,h2,h3,h4,h5,h6,blockquote,tr')
      .forEach((block) => block.append('\n\n'));
    return String(clone.textContent || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** @param {Element | null | undefined} composer @param {Element | null | undefined} scope */
  function findThreadScroll(composer, scope) {
    const inScope = scope?.querySelector?.('.thread-scroll-container');
    if (inScope) return inScope;
    let cur = composer?.parentElement;
    while (cur && cur !== document.body) {
      const list = cur.querySelectorAll('.thread-scroll-container');
      if (list.length === 1) return list[0];
      if (list.length > 1) break;
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * @param {Element | null | undefined} composer
   * @param {Element | null | undefined} [scope]
   * @param {{ id?: string, title?: string } | null} [target]
   */
  function collectHandoffContext(composer, scope, target = null) {
    const cap = capability(composer);
    const resolvedScope = scope || findAgentScope(composer).scope;
    const scroll = findThreadScroll(composer, resolvedScope);
    const turns = [];
    if (scroll) {
      const turnNodes = [...scroll.querySelectorAll('[data-content-search-turn-key]')];
      for (const turn of turnNodes) {
        const readRole = (role) => {
          const labels = [...turn.querySelectorAll('h4.sr-only')];
          const label = labels.find((item) => {
            const explicit = String(item.getAttribute('data-conversation-role') || '')
              .trim()
              .toLowerCase();
            if (explicit) return explicit === role;
            const txt = String(item.textContent || '').trim();
            return role === 'user'
              ? /^(你说|you said|user)/i.test(txt)
              : /^(chatgpt|assistant|codex)/i.test(txt);
          });
          let text = extractReadableText(label?.parentElement);
          if (role === 'user') text = text.replace(/\s*\b\d{1,2}:\d{2}$/, '').trim();
          return text;
        };
        const user = readRole('user');
        const assistant = readRole('assistant');
        if (user || assistant) turns.push({ user, assistant });
      }
      if (!turns.length) {
        const roleNodes = [...scroll.querySelectorAll('[data-message-author-role]')];
        let pendingUser = '';
        for (const item of roleNodes) {
          const role = String(item.getAttribute('data-message-author-role') || '')
            .trim()
            .toLowerCase();
          const content = extractReadableText(item);
          if (!content) continue;
          if (role === 'user') {
            if (pendingUser) turns.push({ user: pendingUser, assistant: '' });
            pendingUser = content.replace(/\s*\b\d{1,2}:\d{2}$/, '').trim();
          } else if (role === 'assistant') {
            turns.push({ user: pendingUser, assistant: content });
            pendingUser = '';
          }
        }
        if (pendingUser) turns.push({ user: pendingUser, assistant: '' });
      }
    }
    const draft = readDraftText(composer).trim();
    return {
      locked: Boolean(cap?.agent?.locked),
      sourceAgent: cap?.agent?.label || cap?.agent?.current || 'CLI',
      title: String(target?.title || clean(resolvedScope?.querySelector?.('header')) || '').trim(),
      targetId: String(target?.id || '').trim(),
      turns,
      draft,
    };
  }

  function visibleComposers() {
    return [...document.querySelectorAll('.ProseMirror,[contenteditable="true"],textarea')].filter(
      (node) =>
        isVisible(node) &&
        !node.closest(OWN_UI) &&
        !node.closest('.messaging-root.messaging-embedded'),
    );
  }

  /** @param {Element | null | undefined} composer @param {Element | null | undefined} scope */
  function findNewChatButton(composer, scope) {
    const explicit = [
      ...document.querySelectorAll(
        '[data-codexhost-new-thread],[data-testid*="new-chat" i],[data-testid*="new-thread" i]',
      ),
    ].find(isActionable);
    if (explicit) return explicit;

    const leftPanel = document.querySelector('aside.app-shell-left-panel');
    if (leftPanel) {
      const convId =
        scope
          ?.querySelector?.('[data-above-composer-conversation-id]')
          ?.getAttribute('data-above-composer-conversation-id') ||
        composer
          ?.closest?.('[data-conversation-id],[data-thread-id],[data-session-id]')
          ?.getAttribute('data-conversation-id') ||
        '';
      const rows = [...leftPanel.querySelectorAll('[data-app-action-sidebar-thread-row]')];
      const activeRow =
        (convId &&
          rows.find((r) =>
            String(r.getAttribute('data-app-action-sidebar-thread-id') || '').includes(convId),
          )) ||
        rows.find(
          (r) =>
            r.getAttribute('data-app-action-sidebar-thread-selected') === 'true' ||
            r.getAttribute('aria-current') === 'page',
        );
      if (activeRow) {
        let cur = activeRow.parentElement;
        while (cur && cur !== leftPanel && cur !== document.body) {
          const btns = [...cur.querySelectorAll('button')].filter(
            (b) =>
              isActionable(b) &&
              /开始新聊天|创建新聊天|new chat in|start a new chat/i.test(
                b.getAttribute('aria-label') || b.getAttribute('title') || '',
              ),
          );
          if (btns.length === 1) return btns[0];
          cur = cur.parentElement;
        }
      }
      const pageRoot =
        composer?.closest?.('[data-app-shell-active-page]') || scope || composer?.parentElement;
      const headings = pageRoot
        ? [...pageRoot.querySelectorAll('header,[role="heading"],h1,h2')]
            .map((h) =>
              String(h.textContent || '')
                .trim()
                .toLowerCase(),
            )
            .filter(Boolean)
        : [];
      if (headings.length) {
        const projectBtn = [...leftPanel.querySelectorAll('button')].find((b) => {
          if (!isActionable(b)) return false;
          const label = String(b.getAttribute('aria-label') || '')
            .trim()
            .toLowerCase();
          return headings.some(
            (name) =>
              label === `在 ${name} 中开始新聊天` ||
              label === `start a new chat in ${name}` ||
              label === `new chat in ${name}`,
          );
        });
        if (projectBtn) return projectBtn;
      }
    }

    const candidates = [
      ...document.querySelectorAll(
        'aside.app-shell-left-panel button, aside.app-shell-left-panel a, nav button, nav a, button, a, [role="button"]',
      ),
    ];
    return (
      candidates.find((node) => {
        if (!isActionable(node)) return false;
        const label = String(
          node.getAttribute('aria-label') || node.textContent || node.getAttribute('title') || '',
        )
          .replace(/\s+/g, ' ')
          .trim();
        return /^(?:新聊天|新建聊天|新线程|新建线程|new chat|new thread|start new chat)$/i.test(
          label,
        );
      }) || null
    );
  }

  /** @param {Element} target @param {string} prompt */
  function fillComposerPrompt(target, prompt) {
    if (!(target instanceof HTMLElement)) return;
    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const proto = Object.getPrototypeOf(target);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && typeof desc.set === 'function') desc.set.call(target, prompt);
      else target.value = prompt;
      target.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }),
      );
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const selection = window.getSelection?.();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    let inserted = false;
    try {
      inserted = document.execCommand?.('insertText', false, prompt) === true;
    } catch {
      inserted = false;
    }
    if (!inserted || !readDraftText(target).trim()) {
      if (target.classList.contains('ProseMirror')) {
        target.innerHTML = '';
        for (const line of String(prompt).split('\n')) {
          const p = document.createElement('p');
          if (line) p.textContent = line;
          else p.appendChild(document.createElement('br'));
          target.appendChild(p);
        }
      } else {
        target.textContent = prompt;
      }
    }
    target.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }),
    );
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function switchDraftAgent(composer, desired, signal) {
    const cap = capability(composer);
    if (!cap.agent || !cap.composerId) {
      throw new Error(cap.message || tr('无法确认当前 CodexHost Agent'));
    }
    if (cap.agent.locked) {
      throw new Error(tr('当前会话已锁定 CLI，请新建聊天后再切换'));
    }
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

  async function selectAgent(composer, targetAgent, signal, options = {}) {
    const cap = capability(composer);
    if (!cap.agent || !cap.composerId) {
      throw new Error(cap.message || tr('无法确认当前 CodexHost Agent'));
    }
    const desired = String(targetAgent || '').trim();
    const option = cap.agent.options?.find((item) => item.id === desired);
    if (!option || !option.available) {
      throw new Error(tr('目标 CLI 当前不可用'));
    }
    const handoffPrompt =
      typeof options?.handoffPrompt === 'string' ? options.handoffPrompt.trim() : '';
    if (!cap.agent.locked) {
      const next = await switchDraftAgent(composer, desired, signal);
      if (handoffPrompt && composer instanceof HTMLElement) {
        fillComposerPrompt(composer, handoffPrompt);
      }
      return next;
    }
    if (!handoffPrompt) {
      throw new Error(tr('当前会话已锁定 CLI，请新建聊天后再切换'));
    }
    const { scope } = findAgentScope(composer);
    const priorDrafts = new Set(
      visibleComposers().filter((node) => {
        const c = capability(node);
        return c.agent && !c.agent.locked;
      }),
    );
    const newChatBtn = findNewChatButton(composer, scope);
    if (!(newChatBtn instanceof HTMLElement)) {
      throw new Error(tr('未找到宿主新聊天入口，请手动新建聊天后切换 CLI'));
    }
    newChatBtn.click();
    const newComposer = await waitCondition(
      () => {
        const drafts = visibleComposers().filter((node) => {
          const c = capability(node);
          return c.agent && !c.agent.locked;
        });
        return drafts.find((node) => !priorDrafts.has(node)) || drafts[0] || null;
      },
      signal,
      5000,
      '等待新聊天输入框就绪超时',
    );
    const nextCap = await switchDraftAgent(newComposer, desired, signal);
    fillComposerPrompt(newComposer, handoffPrompt);
    return { ...nextCap, composer: newComposer };
  }

  window.__palbooHostCompatibility = {
    capability,
    readExternal,
    selectExternal,
    selectAgent,
    collectHandoffContext,
  };
})();
