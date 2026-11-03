/* [INPUT]: 上游探针契约、合成多输入框 DOM、外部 CLI 模型菜单、多轮对话与新聊天按钮和实际适配脚本。
 * [OUTPUT]: Agent 隔离、缺失/未知/异常协议拒绝、外部 CLI 模型/思考快切、新会话 CLI 切换、已锁定会话新建聊天上下文交接切换及官方目录隔离。
 * [POS]: 不调用真实 CodexHost、不写聊天或模型。
 * [PROTOCOL]: 变更时同步 tests/AGENTS.md。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { records, installModelControlFixture } from './model-control-fixture.mjs';
const source = readFileSync(new URL('../ui/codex/codex-host.js', import.meta.url), 'utf8');
test('CodexHost adapter keeps Agent capability scoped to each composer', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PALBOO_CHROME_BIN || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<section><textarea id="a"></textarea><button data-codexhost-agent-control="a"><i data-agent="codex"></i></button></section><section><textarea id="b"></textarea><button data-codexhost-agent-control="b"><i data-agent="claude"></i></button></section>',
    );
    await page.addScriptTag({ content: source });
    const check = (id) =>
      page.evaluate(
        (id) => window.__palbooHostCompatibility.capability(document.getElementById(id)),
        id,
      );
    assert.equal((await check('a')).officialModel, false);
    assert.equal((await check('b')).officialModel, false);
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1 = {
        status: () => ({
          version: 2,
          selections: [
            { composerId: 'a', agent: 'codex', phase: 'draft' },
            { composerId: 'b', agent: 'claude', phase: 'locked' },
          ],
        }),
      };
    });
    assert.equal((await check('a')).officialModel, true);
    assert.equal((await check('b')).officialModel, false);
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1 = { status: () => ({ version: 3, selections: [] }) };
    });
    assert.equal((await check('a')).officialModel, false);
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1 = {
        status: () => {
          throw new Error('unavailable');
        },
      };
    });
    assert.equal((await check('a')).officialModel, false);
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1 = { status: () => ({ version: 2, selections: {} }) };
    });
    assert.equal((await check('a')).officialModel, false);
    // An unmounted composer must not inherit an ordinary-Codex fallback from another Agent.
    await page.evaluate(() => {
      delete window.__codexhostRendererBindingProbeV1;
      document.querySelector('[data-codexhost-agent-control="a"]').remove();
    });
    assert.equal((await check('a')).officialModel, false);
    await page.evaluate(() => {
      document.querySelector('[data-codexhost-agent-control="b"]').remove();
    });
    assert.equal((await check('a')).officialModel, true);
  } finally {
    await browser.close();
  }
});

test('official model adapter refuses external Agent without touching its menus', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PALBOO_CHROME_BIN || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.route('http://model-host.test/**', (route) =>
      route.fulfill({ body: '<!doctype html><body></body>', contentType: 'text/html' }),
    );
    await page.goto('http://model-host.test/c/chat-a');
    await page.evaluate(installModelControlFixture, { records, options: {} });
    await page.addScriptTag({ content: source });
    await page.addScriptTag({
      content: readFileSync(new URL('../ui/codex/model.js', import.meta.url), 'utf8'),
    });
    await page.evaluate(() => {
      capability();
      const control = document.createElement('button');
      control.setAttribute('data-codexhost-agent-control', 'external');
      control.innerHTML = '<i data-agent="claude"></i>';
      document.querySelector('.ProseMirror').parentElement.append(control);
      window.__codexhostRendererBindingProbeV1 = {
        status: () => ({
          version: 2,
          selections: [{ composerId: 'external', agent: 'claude', phase: 'locked' }],
        }),
      };
    });
    const value = await page.evaluate(() => window.__palbooModelControl.snapshot(true));
    assert.equal(value.status, 'unavailable');
    assert.match(value.message, /claude/);
    const result = await page.evaluate(
      (state) =>
        window.__palbooModelControl.apply({
          target: state.target,
          expectedRevision: state.revision,
          selection: { model: 'beta', reasoning: 'high', speed: 'standard' },
        }),
      value,
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.snapshot.status, 'unavailable');
    assert.match(result.message, /claude/);
    assert.equal(await page.evaluate(() => host.triggerEvents), 0);
    // A visible Codex label alone cannot authorize writes while the upstream API is absent.
    await page.evaluate(() => {
      delete window.__codexhostRendererBindingProbeV1;
      document.querySelector('[data-agent]').setAttribute('data-agent', 'codex');
    });
    const unavailable = await page.evaluate(() => window.__palbooModelControl.snapshot(true));
    const refused = await page.evaluate(
      (state) =>
        window.__palbooModelControl.apply({
          target: state.target,
          expectedRevision: state.revision,
          selection: { model: 'beta', reasoning: 'high', speed: 'standard' },
        }),
      unavailable,
    );
    assert.equal(refused.status, 'failed');
    assert.match(refused.message, /状态接口尚未就绪/);
    assert.equal(await page.evaluate(() => host.triggerEvents), 0);
  } finally {
    await browser.close();
  }
});

test('external CLI model picker and draft CLI switcher work through CodexHost DOM', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PALBOO_CHROME_BIN || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.route('http://model-host.test/**', (route) =>
      route.fulfill({ body: '<!doctype html><body></body>', contentType: 'text/html' }),
    );
    await page.goto('http://model-host.test/c/chat-a');
    await page.evaluate(installModelControlFixture, { records, options: {} });
    await page.addScriptTag({ content: source });
    await page.addScriptTag({
      content: readFileSync(new URL('../ui/codex/model.js', import.meta.url), 'utf8'),
    });
    await page.evaluate(() => {
      capability();
      const composer = document.querySelector('.ProseMirror');
      const container = composer.parentElement;
      const officialTrigger = container.querySelector('#trigger');
      const state = {
        agent: 'antigravity',
        phase: 'draft',
        composerId: 'ext-1',
        model: 'gemini-3-1-pro',
        thinking: 'high',
        models: [
          {
            ref: { id: 'gemini-3-1-pro' },
            label: 'Gemini 3.1 Pro',
            supportedThinkingOptionIds: ['low', 'high'],
          },
          {
            ref: { id: 'gemini-2-5-flash' },
            label: 'Gemini 2.5 Flash',
            supportedThinkingOptionIds: ['off'],
          },
        ],
      };

      const agentControl = document.createElement('div');
      agentControl.setAttribute('data-codexhost-agent-control', 'ext-1');
      agentControl.innerHTML =
        '<button type="button" aria-haspopup="menu" aria-controls="ext-1-agent-menu"><span class="codexhost-agent-picker__label">Antigravity</span></button>';
      container.append(agentControl);

      const agentMenu = document.createElement('div');
      agentMenu.id = 'ext-1-agent-menu';
      agentMenu.setAttribute('role', 'menu');
      agentMenu.innerHTML = [
        '<button type="button" role="menuitemradio" data-agent="codex"><span class="codexhost-agent-picker__item-label">Codex</span></button>',
        '<button type="button" role="menuitemradio" data-agent="antigravity"><span class="codexhost-agent-picker__item-label">Antigravity</span></button>',
      ].join('');
      document.body.append(agentMenu);

      const modelControl = document.createElement('div');
      modelControl.setAttribute('data-codexhost-model-control', 'ext-1');
      modelControl.innerHTML =
        '<button type="button" aria-haspopup="menu" aria-controls="ext-1-model-menu" aria-busy="false">Gemini 3.1 Pro</button>';
      container.append(modelControl);

      const modelMenu = document.createElement('div');
      modelMenu.id = 'ext-1-model-menu';
      modelMenu.setAttribute('role', 'menu');
      document.body.append(modelMenu);

      const modelSubmenu = document.createElement('div');
      modelSubmenu.id = 'ext-1-model-submenu';
      modelSubmenu.setAttribute('role', 'menu');
      document.body.append(modelSubmenu);

      function syncExternalDom() {
        const isExternal = state.agent !== 'codex';
        if (officialTrigger) officialTrigger.hidden = isExternal;
        modelControl.hidden = !isExternal;
        modelControl.style.display = isExternal ? 'inline-flex' : 'none';
        const selected = state.models.find((m) => m.ref.id === state.model) || state.models[0];
        const thinkingOptions = (selected?.supportedThinkingOptionIds || []).map((id) => ({
          id,
          label: id,
        }));
        modelControl.setAttribute(
          'data-catalog-signature',
          JSON.stringify({
            models: state.models,
            thinkingOptions,
            showThinkingSection: thinkingOptions.some((t) => t.id !== 'off'),
            modelLabel: selected?.label || '',
          }),
        );
        modelSubmenu.innerHTML = state.models
          .map(
            (m) =>
              `<button type="button" role="menuitemradio" data-model-id="${m.ref.id}" aria-checked="${
                m.ref.id === state.model ? 'true' : 'false'
              }"><span class="codexhost-model-picker__item-main">${m.label}</span></button>`,
          )
          .join('');
        modelMenu.innerHTML = thinkingOptions
          .map(
            (t) =>
              `<button type="button" role="menuitemradio" data-thinking-option-id="${t.id}" aria-checked="${
                t.id === state.thinking ? 'true' : 'false'
              }">${t.label}</button>`,
          )
          .join('');
        modelSubmenu.querySelectorAll('button[data-model-id]').forEach((btn) => {
          btn.onclick = () => {
            state.model = btn.getAttribute('data-model-id');
            const m = state.models.find((item) => item.ref.id === state.model);
            if (!m?.supportedThinkingOptionIds?.includes(state.thinking)) {
              state.thinking = m?.supportedThinkingOptionIds?.[0] || 'off';
            }
            syncExternalDom();
          };
        });
        modelMenu.querySelectorAll('button[data-thinking-option-id]').forEach((btn) => {
          btn.onclick = () => {
            state.thinking = btn.getAttribute('data-thinking-option-id');
            syncExternalDom();
          };
        });
      }

      agentMenu.querySelectorAll('button[data-agent]').forEach((btn) => {
        btn.onclick = () => {
          if (state.phase === 'locked') return;
          state.agent = btn.getAttribute('data-agent');
          syncExternalDom();
        };
      });

      window.__extState = state;
      window.__syncExternalDom = syncExternalDom;
      window.__codexhostRendererBindingProbeV1 = {
        status: () => ({
          version: 2,
          enabledAgents: ['codex', 'antigravity'],
          availability: { codex: 'ready', antigravity: 'ready' },
          selections: [
            { composerId: state.composerId, agent: state.agent, phase: state.phase },
            { composerId: 'unrelated-draft', agent: 'codex', phase: 'draft' },
          ],
        }),
      };
      syncExternalDom();
    });

    const initial = await page.evaluate(() => window.__palbooModelControl.snapshot(false));
    assert.equal(initial.status, 'ready');
    assert.equal(initial.agent.current, 'antigravity');
    assert.equal(initial.agent.locked, false);
    assert.deepEqual(
      initial.models.map((m) => ({ id: m.id, reasoning: m.reasoning })),
      [
        { id: 'gemini-3-1-pro', reasoning: ['low', 'high'] },
        { id: 'gemini-2-5-flash', reasoning: [] },
      ],
    );
    assert.deepEqual(initial.current, {
      model: 'gemini-3-1-pro',
      reasoning: 'high',
      speed: 'standard',
    });

    // Official Codex catalog remains isolated for /settings/models even while on external CLI.
    const officialCatalog = await page.evaluate(() => window.__palbooModelControl.codexCatalog());
    assert.deepEqual(
      officialCatalog.models.map((m) => m.id),
      ['alpha', 'beta'],
    );

    // Switch thinking level on external CLI model.
    const switchedThinking = await page.evaluate(
      (s) =>
        window.__palbooModelControl.apply({
          target: s.target,
          expectedRevision: s.revision,
          selection: { model: 'gemini-3-1-pro', reasoning: 'low', speed: 'standard' },
        }),
      initial,
    );
    assert.equal(switchedThinking.status, 'success');
    assert.deepEqual(switchedThinking.snapshot.current, {
      model: 'gemini-3-1-pro',
      reasoning: 'low',
      speed: 'standard',
    });

    // Switch to an external CLI model without adjustable thinking levels (reasoning: '').
    const switchedFlash = await page.evaluate(
      (s) =>
        window.__palbooModelControl.apply({
          target: s.target,
          expectedRevision: s.revision,
          selection: { model: 'gemini-2-5-flash', reasoning: '', speed: 'standard' },
        }),
      switchedThinking.snapshot,
    );
    assert.equal(switchedFlash.status, 'success');
    assert.deepEqual(switchedFlash.snapshot.current, {
      model: 'gemini-2-5-flash',
      reasoning: '',
      speed: 'standard',
    });

    // Switch CLI from antigravity -> codex in a draft conversation.
    const switchedToCodex = await page.evaluate(
      (s) =>
        window.__palbooModelControl.apply({
          target: s.target,
          expectedRevision: s.revision,
          agent: 'codex',
        }),
      switchedFlash.snapshot,
    );
    assert.equal(switchedToCodex.status, 'success');
    assert.equal(switchedToCodex.snapshot.agent.current, 'codex');
    assert.deepEqual(
      switchedToCodex.snapshot.models.map((m) => m.id),
      ['alpha', 'beta'],
    );

    // Switch CLI back from codex -> antigravity, then lock the conversation and verify CLI switch is refused.
    const switchedBack = await page.evaluate(
      (s) =>
        window.__palbooModelControl.apply({
          target: s.target,
          expectedRevision: s.revision,
          agent: 'antigravity',
        }),
      switchedToCodex.snapshot,
    );
    assert.equal(switchedBack.status, 'success');
    assert.equal(switchedBack.snapshot.agent.current, 'antigravity');

    await page.evaluate(() => {
      window.__extState.phase = 'locked';
      document.querySelectorAll('#ext-1-agent-menu button').forEach((btn) => {
        btn.disabled = true;
      });
      const scroll = document.querySelector('.thread-scroll-container');
      if (scroll) {
        const turn = document.createElement('div');
        turn.setAttribute('data-content-search-turn-key', 'turn-1');
        turn.innerHTML = [
          '<div class="flex flex-col items-end gap-2"><h4 class="sr-only" data-conversation-role="user"><span>你说：</span><span aria-hidden="true">You</span></h4><p>为什么外部 CLI 不能快切？ 19:50</p></div>',
          '<div class="group flex min-w-0 flex-col"><h4 class="sr-only" data-conversation-role="assistant"><span>ChatGPT 说：</span><span aria-hidden="true">ChatGPT</span></h4><p>需要读取 data-codexhost-model-control 菜单。</p></div>',
        ].join('');
        scroll.append(turn);
      }
      const composer = document.querySelector('.ProseMirror');
      composer.innerHTML = '<p>请继续完成方案 B</p>';
      const newChatBtn = document.createElement('button');
      newChatBtn.type = 'button';
      newChatBtn.setAttribute('data-codexhost-new-thread', '');
      newChatBtn.textContent = '新聊天';
      newChatBtn.onclick = () => {
        window.__newChatClicked = (window.__newChatClicked || 0) + 1;
        window.__extState.phase = 'draft';
        window.__extState.composerId = 'new-draft';
        composer.parentElement
          .querySelector('[data-codexhost-agent-control]')
          .setAttribute('data-codexhost-agent-control', 'new-draft');
        const menu = document.getElementById('ext-1-agent-menu');
        menu.id = 'new-draft-agent-menu';
        menu.querySelectorAll('button').forEach((btn) => {
          btn.disabled = false;
        });
        const next = composer.cloneNode(false);
        next.innerHTML = '<p><br></p>';
        composer.replaceWith(next);
      };
      document.body.append(newChatBtn);
    });
    const lockedSnap = await page.evaluate(() => window.__palbooModelControl.snapshot(false));
    assert.equal(lockedSnap.agent.locked, true);
    assert.equal(lockedSnap.agent.options.find((option) => option.id === 'codex').available, true);
    const lockedSwitch = await page.evaluate(
      (s) =>
        window.__palbooModelControl.apply({
          target: s.target,
          expectedRevision: s.revision,
          agent: 'codex',
        }),
      lockedSnap,
    );
    assert.equal(lockedSwitch.status, 'failed');
    assert.match(lockedSwitch.message, /锁定/);

    // Prepare handoff extracts full turns and unsent draft from locked chat.
    const handoffData = await page.evaluate(
      (s) =>
        window.__palbooModelControl.prepareHandoff({
          target: s.target,
          expectedRevision: s.revision,
          agent: 'codex',
        }),
      lockedSnap,
    );
    assert.equal(handoffData.locked, true);
    assert.equal(handoffData.sourceAgent, 'Antigravity');
    assert.equal(handoffData.draft, '请继续完成方案 B');
    assert.deepEqual(handoffData.turns, [
      {
        user: '为什么外部 CLI 不能快切？',
        assistant: '需要读取 data-codexhost-model-control 菜单。',
      },
    ]);

    await page.evaluate(() => {
      const unrelated = document.createElement('aside');
      unrelated.innerHTML =
        '<textarea id="unrelated-draft">保留另一条草稿</textarea><div data-codexhost-agent-control="unrelated-draft"></div>';
      document.body.prepend(unrelated);
    });
    const staleDraft = await page.evaluate(
      (s) =>
        window.__palbooModelControl.apply({
          target: s.target,
          expectedRevision: s.revision,
          agent: 'codex',
          sourceDraft: '过期草稿',
          handoffPrompt: '不得填入',
        }),
      lockedSnap,
    );
    assert.equal(staleDraft.status, 'failed');
    assert.match(staleDraft.message, /草稿已变化/);
    assert.equal(await page.evaluate(() => window.__newChatClicked || 0), 0);

    const cancelled = await page.evaluate(async () => {
      const button = document.querySelector('[data-codexhost-new-thread]');
      const open = button.onclick;
      button.onclick = () => {};
      const controller = new AbortController();
      const cancel = setTimeout(() => controller.abort('测试取消'), 100);
      try {
        await window.__palbooHostCompatibility.selectAgent(
          document.querySelector('.ProseMirror'),
          'codex',
          controller.signal,
          { sourceDraft: '请继续完成方案 B', handoffPrompt: '不得填入' },
        );
        return '';
      } catch (error) {
        return error.message;
      } finally {
        clearTimeout(cancel);
        button.onclick = open;
      }
    });
    assert.match(cancelled, /测试取消/);
    assert.equal(await page.locator('#unrelated-draft').inputValue(), '保留另一条草稿');

    // Mid-conversation CLI switch with handoffPrompt opens a new chat, switches CLI, and fills composer.
    const handoffSwitch = await page.evaluate(
      (s) =>
        window.__palbooModelControl.apply({
          target: s.target,
          expectedRevision: s.revision,
          agent: 'codex',
          sourceDraft: '请继续完成方案 B',
          handoffPrompt:
            '[上下文交接] 前序会话完整记录：`/tmp/handoff.md`\n\n当前待处理输入：\n请继续完成方案 B',
        }),
      lockedSnap,
    );
    assert.equal(handoffSwitch.status, 'success');
    assert.equal(handoffSwitch.snapshot.agent.current, 'codex');
    assert.equal(handoffSwitch.snapshot.agent.locked, false);
    assert.equal(await page.evaluate(() => window.__newChatClicked), 1);
    const composerAfter = await page.evaluate(
      () => document.querySelector('.ProseMirror').textContent,
    );
    assert.match(composerAfter, /\/tmp\/handoff\.md/);
    assert.match(composerAfter, /请继续完成方案 B/);
    assert.equal(await page.locator('#unrelated-draft').inputValue(), '保留另一条草稿');
  } finally {
    await browser.close();
  }
});
