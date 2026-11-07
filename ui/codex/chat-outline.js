/* [INPUT]: Leased read-only Chat settings, Chat DOM adapter and shared outline controller/view.
 * [OUTPUT]: Native answer-row buttons and an isolated outline surface with history/cache continuity.
 * [POS]: Standalone ordinary Chat entry. Never installs the Work runtime, bridge or composer actions.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createChatContext, chatConversationId } from './chat-context.js';
import { createOutlineController } from './outline.js';
import { createOutlineState, hashText } from './runtime/state.js';
import {
  alignOutlineNestedText,
  attachOutlineEvents,
  outlineHtml,
  syncOutlineAvailability,
} from '../features/outline/view.js';
import { setLocale, getLocale, tr } from '../shared/i18n.js';
import { iconSvg } from '../shared/icons/index.js';
import contentCss from '../features/content.css';
import surfaceCss from '../surfaces/workspace/content.css';
import chatCss from './chat-outline.css';
import hostCss from './chat-outline-host.css';

// A navigation script can run on another origin after its target navigates away.
if (location.origin === 'https://chatgpt.com' && window.top === window) {
  const host = /** @type {any} */ (window);
  host.__palbooChatOutlinePending?.();
  const install = () => {
    delete host.__palbooChatOutlinePending;
    const previous = host.__palbooChatOutline?.handoff?.();
    host.__palbooChatOutline?.destroy();
    let active = true;
    let enabled = false;
    let lease = Date.now();
    let scanTimer = 0;
    let session = chatConversationId();
    let rendered = '';
    let opener = null;
    let restoredScroll = previous?.session === session ? previous.scroll : null;
    const outline = createOutlineState({});
    const hostStyle = document.createElement('style');
    hostStyle.dataset.palbooChatOutlineStyle = '';
    hostStyle.textContent = `${hostCss}`;
    const container = document.createElement('aside');
    container.dataset.palbooChatOutline = '';
    container.hidden = true;
    const shadow = container.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${surfaceCss}${contentCss}${chatCss}`;
    shadow.append(style);
    const view = document.createElement('section');
    view.className = 'feature-view';
    view.setAttribute('role', 'region');
    view.innerHTML =
      '<header class="feature-head"><strong></strong><button type="button" data-refresh></button><button type="button" data-close></button></header><div class="feature-body"></div>';
    shadow.append(view);
    const body = view.querySelector('.feature-body');
    const shellState = {
      activeTab: 'outline',
      layoutMode: /** @type {const} */ ('workbench'),
      panel: shadow,
    };
    const context = createChatContext(() => active && enabled);
    const render = () => {
      if (!active) return;
      view.setAttribute('aria-label', tr('大纲'));
      view.querySelector('strong').textContent = tr('大纲');
      for (const [selector, icon, label] of [
        ['[data-refresh]', 'refresh', '刷新'],
        ['[data-close]', 'close', '关闭'],
      ]) {
        const button = view.querySelector(selector);
        button.setAttribute('aria-label', tr(label));
        button.setAttribute('title', tr(label));
        if (!button.firstChild) button.innerHTML = iconSvg(icon);
      }
      // Availability does not replace cached rows or the reader's scroll position.
      const fingerprint = `${getLocale()}|${outline.outlineContext?.sessionId || ''}|${outline.outlineContext?.assistantMessageId || ''}|${outline.outlineHistorical}|${outline.outlineFingerprint}|${outline.outlineItems.length ? 'items' : outline.outlineStatus}`;
      if (rendered !== fingerprint) {
        const scroll = body.scrollTop;
        body.innerHTML = outlineHtml(outline);
        attachOutlineEvents(body, (command, data) => {
          if (command === 'outline-jump') controller.outlineJumpTo(data.id);
          if (command === 'outline-anchor') controller.outlineJumpToAnchor(data.anchor);
          if (command === 'outline-latest') controller.followLatestOutline();
        });
        alignOutlineNestedText(body);
        body.scrollTop = restoredScroll ?? scroll;
        if (outline.outlineItems.length) restoredScroll = null;
        rendered = fingerprint;
      }
      syncOutlineAvailability(body, outline, !context.bindingSourceReady());
    };
    const schedule = (delay = 80) => {
      if (!active || !enabled || scanTimer) return;
      scanTimer = window.setTimeout(() => {
        scanTimer = 0;
        scan();
      }, delay);
    };
    const controller = createOutlineController({
      ...context,
      outlineState: outline,
      shellState,
      IS_POPOUT: false,
      isCurrentRuntime: () => active,
      outlineEnabled: () => active && enabled,
      decorateReplyButton: (button) => {
        button.style.cssText =
          'min-width:28px;min-height:28px;display:inline-flex;align-items:center;justify-content:center';
        button.querySelector('svg').style.cssText = 'width:18px;height:18px;flex:none';
      },
      scrollBehavior: () =>
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      contentSafeBounds: () => ({
        top: 56,
        left: 0,
        right: innerWidth,
        bottom: innerHeight,
        width: innerWidth,
        height: innerHeight - 56,
      }),
      emitSignal: (name, payload) => {
        if (name === 'render') render();
        else if (name === 'scan') schedule(typeof payload === 'number' ? payload : 80);
      },
    });
    const close = () => {
      container.hidden = true;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    const reveal = () => {
      opener = document.activeElement;
      if (!container.isConnected) document.body.append(container);
      container.hidden = false;
      render();
      view.querySelector('button').focus({ preventScroll: true });
    };
    function scan() {
      if (!active || !enabled) return;
      const current = chatConversationId();
      if (current !== session) {
        session = current;
        controller.resetOutlineFeature();
        body.scrollTop = 0;
        rendered = '';
      }
      if (!context.bindingSourceReady()) {
        controller.clearOutlineReplyControls();
        render();
        return;
      }
      const latest = context.latestConversationTurn();
      controller.syncOutlineReplyControls(reveal, latest?.turnKey);
      if (container.hidden) return;
      if (outline.outlineSelectedTurnKey) controller.syncSelectedOutline();
      else {
        const message = context.findLatestAssistantMessage();
        if (
          outline.outlineContext?.assistantMessageId !== context.assistantMessageId(message) ||
          outline.outlineSourceHash !== hashText(message?.text || '') ||
          outline.outlineMessage !== message?.node ||
          outline.outlineStatus === 'idle' ||
          outline.outlineStatus === 'pending' ||
          (message?.node?.isConnected
            ? outline.outlineStatus === 'unavailable'
            : outline.outlineStatus !== 'unavailable')
        )
          void controller.refreshOutline();
      }
      render();
    }
    const own = (node) =>
      node instanceof Element &&
      Boolean(
        node.closest(
          '[data-palboo-chat-outline],[data-palboo-outline-reply],[data-palboo-chat-outline-style]',
        ),
      );
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (r) =>
            !own(r.target) &&
            (r.type !== 'childList' || [...r.addedNodes, ...r.removedNodes].some((n) => !own(n))),
        )
      )
        schedule();
    });
    view.querySelector('[data-close]').addEventListener('click', close);
    view
      .querySelector('[data-refresh]')
      .addEventListener('click', () => controller.refreshOutline());
    const keydown = (event) => {
      if (event.key === 'Escape' && !container.hidden) {
        event.stopPropagation();
        close();
      }
    };
    shadow.addEventListener('keydown', keydown);
    const scroll = (event) => {
      if (!own(event.target)) schedule(120);
    };
    document.addEventListener('scroll', scroll, true);
    const activation = () => schedule(0);
    document.addEventListener('visibilitychange', activation);
    window.addEventListener('resize', activation);
    const watchdog = window.setInterval(() => {
      if (Date.now() - lease > 8000) api.destroy();
      else if (enabled && session !== chatConversationId()) schedule(0);
    }, 2000);
    const api = {
      update(settings) {
        lease = Date.now();
        const locale = getLocale();
        setLocale(settings.language, settings.systemLanguage);
        const changed = locale !== getLocale() || enabled !== Boolean(settings.enabled);
        if (locale !== getLocale()) controller.clearOutlineReplyControls();
        if (enabled !== Boolean(settings.enabled)) {
          enabled = Boolean(settings.enabled);
          observer.disconnect();
          if (enabled) {
            document.head.append(hostStyle);
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              characterData: true,
              attributes: true,
              attributeFilter: [
                'data-content-search-turn-key',
                'data-conversation-role',
                'aria-label',
              ],
            });
          } else {
            controller.clearOutlineReplyControls();
            controller.resetOutlineFeature();
            container.remove();
            hostStyle.remove();
            container.hidden = true;
          }
        }
        if (changed) schedule(0);
      },
      handoff: () => ({
        session,
        open: !container.hidden,
        selected: outline.outlineSelectedTurnKey,
        scroll: body.scrollTop,
      }),
      destroy() {
        if (!active) return;
        active = false;
        observer.disconnect();
        clearTimeout(scanTimer);
        clearInterval(watchdog);
        document.removeEventListener('scroll', scroll, true);
        document.removeEventListener('visibilitychange', activation);
        window.removeEventListener('resize', activation);
        controller.clearOutlineReplyControls();
        controller.resetOutlineFeature();
        clearTimeout(outline.flashTimer);
        container.remove();
        hostStyle.remove();
        if (host.__palbooChatOutline === api) delete host.__palbooChatOutline;
      },
      status: () => ({
        active,
        enabled,
        open: !container.hidden,
        status: outline.outlineStatus,
        historical: outline.outlineHistorical,
        items: outline.outlineItems.length,
      }),
    };
    host.__palbooChatOutline = api;
    if (previous?.session === session && previous.open) {
      outline.outlineSelectedTurnKey = previous.selected || '';
      outline.outlineHistorical = Boolean(previous.selected);
      document.body.append(container);
      container.hidden = false;
    }
  };
  if (document.readyState === 'loading') {
    host.__palbooChatOutlinePending = () => {
      document.removeEventListener('DOMContentLoaded', install);
      delete host.__palbooChatOutlinePending;
    };
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else install();
}
