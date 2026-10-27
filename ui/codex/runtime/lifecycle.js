import { hostPageKind, hostPageAllowed } from '../page-context.js';
import { tr } from '../../shared/i18n.js';
import { measureWork, samplePerformance, stopPerformance } from '../../shared/performance.js';
import { bridgeCall } from './state.js';
import { installNextDrop } from '../next-drop.js';
import { installPromptEnhancer } from '../prompt-enhancement.js';
import { installTokenMeter } from '../token-meter.js';
import { installBots } from '../bots.js';
import { installTerminologyImports } from '../terminology-import.js';
import { createTypographyTracker } from '../typography.js';
import { installTerminology } from '../../terminology/host.js';
/*
 * [INPUT]: 宿主上下文、独立功能、设置协调、外壳与通知。
 * [OUTPUT]: 只读 panelAppearance 接口； 回答结束且文本稳定后扫描生成、启停与通知订阅，连接胶囊/左侧图标入口与停靠开合，Dev 插件页签选中后收起旧侧栏；切换聊天恢复有效建议缓存，来源失联保留只读结果并使异步请求失效。
 * [POS]: 模块组合入口；统一初始化并回收观察器、定时器和订阅。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import {
  startFeatureHost,
  stopFeatureHost,
  independentFeatures,
  popoutSelectedFeature,
  toggleFeatureDock,
  featurePlacement,
  revealMainFeature,
  reopenMainFeatures,
} from '../../surfaces/embedded/features.js';
import { syncLauncher, stopLauncher } from '../../surfaces/embedded/launcher.js';
import { panelAppearance } from '../../surfaces/embedded/shell/panel-appearance.js';

import {
  DETACHED_KEY,
  DEVELOPMENT,
  API_KEY,
  INSTANCE_ID,
  IS_POPOUT,
  NEW_ANSWER_EXPRESSION_MS,
  ROOT_ATTR,
  SCAN_DELAY_MS,
  SCRIPT_VERSION,
  STREAM_IDLE_MS,
  STYLE_ID,
} from '../../shared/constants.js';
import {
  assistantMessageId,
  activePaneCue,
  chatBusy,
  chatRoot,
  bindingSourceReady,
  chatSurfaceReady,
  contextMatches,
  contextSnapshot,
  findLatestAssistantMessage,
  terminologyExchange,
  findPreviousUserText,
  installContextTracking,
  removeContextTracking,
  setScanStatus,
} from '../context.js';
import {
  bridgeRequestKey,
  clearPromptsForNewAssistant,
  requestBridgeStepwise,
  resetStepwiseFeature,
} from '../next.js';
import {
  cancelMorphAnimations,
  dockRightKeepHeight,
  setOpen,
} from '../../surfaces/embedded/shell/geometry.js';
import {
  cancelSourceCueAnimation,
  clearPromptInteractionTimers,
  installFloat,
  renderFloat,
} from '../../surfaces/embedded/shell/views.js';
import {
  cancelViewAnimation,
  resolveFabExpression,
  fabExpressionLabel,
  scheduleExpressionRefresh,
  triggerCompletionBeam,
} from '../../surfaces/embedded/shell/shell.js';
import {
  contextState,
  debugState,
  hashText,
  initializeState,
  isCurrentInstance,
  isCurrentRuntime,
  normalizeActiveTab,
  normalizeText,
  outlineEnabled,
  outlineState,
  runtimeEnabled,
  runtimeState,
  shellState,
  stepwiseEnabled,
  stepwiseGenerationMode,
  stepwiseInputText,
  stepwiseState,
} from './state.js';
import {
  cancelSettingsOpening,
  ensureSettings,
  loadSettings,
  reloadSettings,
  openSettings,
  scheduleSettingsSync,
  syncSettings,
} from './settings-sync.js';
import {
  togglePanelWindow,
  exportPanelState,
  panelReadingState,
  panelWindowAnchor,
  blinkHandoff,
  panelCommand,
  panelDisconnected,
  receivePanelState,
  setDetached,
  syncPanelPreferences,
} from './presentation.js';
import { fallbackHostTypography } from '../appearance.js';
import { installStyle } from '../../surfaces/embedded/shell/install-styles.js';
import {
  invalidateOutline,
  outlineClearMarks,
  refreshOutline,
  resetOutlineFeature,
} from '../outline.js';
import { nativeGestureEnded, panelPreferences } from '../../surfaces/desktop/legacy/transport.js';
import {
  cancelFaceClick,
  onResize,
  onLauncherClick,
  onLauncherPointerDown,
  onLauncherKeyDown,
} from '../../surfaces/embedded/shell/interaction.js';
import {
  stopWorkbench,
  setWorkbench,
  openWorkbench,
  closeWorkbench,
} from '../../surfaces/embedded/legacy.js';
import { onSignal, emitSignal } from './signals.js';
import { pushDiagnostic, readDiagnostics } from './diagnostics.js';
import {
  readFontOffset,
  readMaterial,
  readLiquidVariant,
  readPanelHeight,
  readPanelWidth,
  syncTheme,
  toggleMaterial,
  writeMaterial,
} from '../../surfaces/embedded/shell/panel-appearance.js';
import { updateGenerationModeControl } from '../../surfaces/embedded/shell/settings-view.js';

function scan(generation = runtimeState.runtimeGeneration, timerId = 0) {
  return measureWork('scan', () => scanCurrent(generation, timerId));
}
function scanCurrent(generation, timerId) {
  if (IS_POPOUT || !isCurrentRuntime(generation)) return;
  if (timerId && runtimeState.timer !== timerId) return;
  if (timerId) runtimeState.timer = 0;
  runtimeState.scans += 1;
  window.__palbooTokenMeter?.refresh();
  installStyle();
  installFloat();
  const stepwiseActive = stepwiseEnabled();
  const outlineActive = outlineEnabled();
  if (!stepwiseActive && !outlineActive) {
    renderFloat();
    return;
  }

  if (!bindingSourceReady()) {
    setScanStatus('source-unavailable', {});
    renderFloat();
    return;
  }
  if (!chatSurfaceReady()) {
    if (outlineActive && (outlineState.outlineItems.length || outlineState.outlineMessage))
      invalidateOutline();
    const busy = chatBusy();
    const statusChanged = setScanStatus('not-ready', { busy });
    if (statusChanged) renderFloat();
    // Local readiness checks also catch a stop button disappearing without a text mutation.
    if (busy) scheduleScan(STREAM_IDLE_MS);
    return;
  }
  if (contextState.scanBusy) contextState.lastAssistantAt = Date.now();

  const message = findLatestAssistantMessage();
  if (!message) {
    if (contextState.lastAssistantHash) {
      contextState.lastAssistantHash = '';
      contextState.activeContext.assistantMessageId = '';
      clearPromptsForNewAssistant('');
    }
    if (outlineActive && (outlineState.outlineItems.length || outlineState.outlineMessage))
      invalidateOutline();
    const statusChanged = setScanStatus('no-assistant-message', {});
    if (statusChanged) renderFloat();
    return;
  }

  const nextAssistantMessageId = assistantMessageId(message);
  if (contextState.activeContext.assistantMessageId !== nextAssistantMessageId) {
    contextState.activeContext.assistantMessageId = nextAssistantMessageId;
  }

  const sourceText = normalizeText(message.text);
  const assistantText = stepwiseInputText(sourceText);
  const hash = hashText(sourceText);
  const now = Date.now();

  if (hash !== contextState.lastAssistantHash) {
    contextState.lastAssistantHash = hash;
    contextState.lastAssistantAt = now;
    shellState.surpriseUntil = now + NEW_ANSWER_EXPRESSION_MS;
    scheduleExpressionRefresh(NEW_ANSWER_EXPRESSION_MS);
    setScanStatus('assistant-changed', { hash, textLength: assistantText.length });
    if (outlineActive) invalidateOutline(message, hash);
    if (stepwiseActive) {
      clearPromptsForNewAssistant(hash);
    } else {
      renderFloat();
    }
    scheduleScan(STREAM_IDLE_MS + 120);
    return;
  }

  if (now - contextState.lastAssistantAt < STREAM_IDLE_MS) {
    setScanStatus('assistant-settling', { hash });
    scheduleScan(STREAM_IDLE_MS);
    return;
  }

  if (
    outlineActive &&
    (outlineState.outlineSourceHash !== hash || !outlineState.outlineMessage?.isConnected) &&
    !outlineState.outlineRefreshPromise
  ) {
    void refreshOutline({ message, assistantHash: hash });
  }
  if (!stepwiseActive) {
    const statusChanged = setScanStatus('ready', {
      hash,
      outlineOnly: true,
      outlineCount: outlineState.outlineItems.length,
    });
    if (statusChanged) renderFloat();
    return;
  }

  const userText = findPreviousUserText(message);
  const bridgeKey = bridgeRequestKey(userText, assistantText);
  const generationMode = stepwiseGenerationMode();
  const manualRequestPending =
    generationMode === 'manual' &&
    stepwiseState.bridgeStatus === 'pending' &&
    stepwiseState.bridgePendingHash === bridgeKey;
  stepwiseState.bridgeActiveKey = bridgeKey;
  const bridgeResult = stepwiseState.bridgeCache.get(bridgeKey);
  const hasSuccessfulCache = bridgeResult?.status === 'ok';
  let prompts = [];

  if (generationMode === 'manual' && !hasSuccessfulCache && !manualRequestPending) {
    stepwiseState.bridgeStatus = 'manual-ready';
    stepwiseState.bridgeError = '';
    stepwiseState.promptContext = contextSnapshot();
  } else if (manualRequestPending) {
    stepwiseState.bridgeError = '';
    stepwiseState.promptContext = contextSnapshot();
  } else if (hasSuccessfulCache) {
    prompts = Array.isArray(bridgeResult.prompts) ? bridgeResult.prompts : [];
    stepwiseState.bridgeStatus = 'ok';
    stepwiseState.bridgeError = '';
    stepwiseState.promptContext = contextSnapshot();
  } else {
    if (bridgeResult) {
      stepwiseState.bridgeStatus =
        bridgeResult.status ||
        (bridgeResult.error ? 'failed' : bridgeResult.disabled ? 'disabled' : 'ok');
      stepwiseState.bridgeError = bridgeResult.error || '';
      stepwiseState.promptContext = contextSnapshot();
    } else {
      requestBridgeStepwise(bridgeKey, userText, assistantText, 'auto');
    }
  }
  setScanStatus('ready', {
    hash,
    bridgeCached: Boolean(bridgeResult),
    promptCount: prompts.length,
  });

  const nextHash = hashText(
    `${generationMode}:${stepwiseState.bridgeStatus}:${prompts.map((item) => `${item.label}\n${item.prompt}`).join('\n\n')}`,
  );
  const renderedHash = `${hash}:${nextHash}`;
  if (stepwiseState.currentHash !== renderedHash) {
    stepwiseState.currentHash = renderedHash;
    stepwiseState.prompts = prompts;
    stepwiseState.promptContext = contextSnapshot();
    shellState.promptPreviewIndex = 0;
    renderFloat();
  }
}

function scheduleScan(delay = SCAN_DELAY_MS) {
  if (IS_POPOUT) return;
  if (!isCurrentRuntime()) return;
  if (runtimeState.timer) window.clearTimeout(runtimeState.timer);
  const generation = runtimeState.runtimeGeneration;
  const timer = window.setTimeout(() => scan(generation, timer), delay);
  runtimeState.timer = timer;
}

function installObserver() {
  if (!isCurrentRuntime()) return false;
  const root = document.body || document.documentElement;
  if (!root) return false;

  const generation = runtimeState.runtimeGeneration;
  runtimeState.observer = new MutationObserver((mutations) => {
    if (!isCurrentRuntime(generation)) return;
    const relevant = mutations.some((mutation) => {
      if (
        shellState.root?.contains(mutation.target) ||
        (mutation.target instanceof Element &&
          mutation.target.closest('[data-palboo-features-root],[data-palboo-token-meter]'))
      )
        return false;
      return mutation.addedNodes.length || mutation.type === 'characterData';
    });
    if (relevant) scheduleScan();
  });
  runtimeState.observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return true;
}

function stopRuntime() {
  cancelSettingsOpening();
  stopLauncher();
  stopFeatureHost();
  stopWorkbench();
  cancelFaceClick();
  window.dispatchEvent(
    new CustomEvent('palboo:stop', { detail: { destroy: runtimeState.destroyed } }),
  );
  runtimeState.runtimeActive = false;
  runtimeState.runtimeGeneration += 1;
  contextState.latestTurnAnchor = null;
  if (runtimeState.domReadyHandler)
    document.removeEventListener('DOMContentLoaded', runtimeState.domReadyHandler);
  runtimeState.domReadyHandler = null;
  if (runtimeState.timer) window.clearTimeout(runtimeState.timer);
  if (shellState.expressionTimer) window.clearTimeout(shellState.expressionTimer);
  if (outlineState.flashTimer) window.clearTimeout(outlineState.flashTimer);
  if (shellState.materialAnimTimer) window.clearTimeout(shellState.materialAnimTimer);
  if (shellState.completionBeamTimer) window.clearTimeout(shellState.completionBeamTimer);
  if (shellState.snapTimer) window.clearTimeout(shellState.snapTimer);
  if (shellState.eyeRaf) window.cancelAnimationFrame(shellState.eyeRaf);
  runtimeState.timer = 0;
  shellState.expressionTimer = 0;
  outlineState.flashTimer = 0;
  shellState.materialAnimTimer = 0;
  shellState.completionBeamTimer = 0;
  shellState.snapTimer = 0;
  shellState.eyeRaf = 0;
  shellState.surpriseUntil = 0;
  stepwiseState.bridgeActiveKey = '';
  stepwiseState.bridgePendingHash = '';
  stepwiseState.bridgePendingRequestId = 0;
  shellState.viewTransitioning = false;
  shellState.pendingTab = '';
  shellState.pendingRender = false;
  shellState.popover?.removeAttribute?.('data-snap-right');
  cancelViewAnimation();
  cancelSourceCueAnimation();
  cancelMorphAnimations();
  shellState.handoffGeneration += 1;
  shellState.handoffAnimation?.cancel?.();
  shellState.handoffAnimation = null;
  shellState.handoffPromise = null;
  shellState.handoffTarget = null;
  shellState.dragCleanup?.();
  shellState.resizeCleanup?.();
  shellState.viewReorderCleanup?.();
  shellState.contentFadeCleanup?.();
  shellState.eyeCleanup?.();
  shellState.eyeCleanup = null;
  shellState.contentFadeCleanup = null;
  shellState.eyePointer = null;
  document
    .querySelectorAll('.companion-stepwise-active-pane, .companion-stepwise-pane-flash')
    .forEach((node) => {
      node.classList.remove('companion-stepwise-active-pane', 'companion-stepwise-pane-flash');
    });
  removeContextTracking();
  if (shellState.keyHandler) document.removeEventListener('keydown', shellState.keyHandler, true);
  shellState.keyHandler = null;
  window.removeEventListener('resize', onResize);
  runtimeState.observer?.disconnect();
  runtimeState.observer = null;
  shellState.themeObserver?.disconnect();
  shellState.themeObserver = null;
  shellState.typographyObserver?.disconnect();
  shellState.typographyObserver = null;
  clearPromptInteractionTimers();
  outlineClearMarks();
  outlineState.outlineItems = [];
  outlineState.outlineRefreshPromise = null;
  outlineState.outlineMessage = null;
  outlineState.outlineScrollCleanup?.();
  outlineState.outlineScrollCleanup = null;
  outlineState.outlineSourceHash = '';
  outlineState.outlineFingerprint = '';
  outlineState.outlineStatus = 'idle';
  outlineState.outlineError = '';
  shellState.featureCleanup?.();
  shellState.root?.remove();
  shellState.root = null;
  shellState.fab = null;
  shellState.popover = null;
  shellState.glass = null;
  shellState.rim = null;
  shellState.completionBeam = null;
  shellState.panel = null;
  shellState.layout = null;
  shellState.drag = null;
  shellState.resizeDrag = null;
  shellState.dragCleanup = null;
  shellState.resizeCleanup = null;
  shellState.viewReorderCleanup = null;
  shellState.suppressViewTabClickUntil = 0;
  shellState.focusAfterMorph = '';
  contextState.pinnedThreadRoot = null;
  contextState.pinnedThreadAt = 0;
  contextState.activeContext = {
    paneRoot: null,
    paneKey: '',
    sessionId: '',
    assistantMessageId: '',
    generation: contextState.activeContext.generation + 1,
  };
  document.getElementById(STYLE_ID)?.remove();
  shellState.open = false;
}

function activateRuntime() {
  if (!isCurrentInstance()) return false;
  if (!runtimeState.runtimeActive) {
    runtimeState.runtimeGeneration += 1;
    runtimeState.runtimeActive = true;
  }
  const generation = runtimeState.runtimeGeneration;
  shellState.activeTab = normalizeActiveTab();
  installStyle();
  installFloat();
  if (IS_POPOUT) {
    renderFloat();
    return true;
  }
  startFeatureHost();
  installContextTracking();
  if (!runtimeState.observer && !installObserver()) {
    const domReadyHandler = () => {
      if (runtimeState.domReadyHandler === domReadyHandler) runtimeState.domReadyHandler = null;
      if (!isCurrentRuntime(generation)) return;
      installObserver();
      installFloat();
      void ensureSettings();
      scheduleScan(0);
    };
    runtimeState.domReadyHandler = domReadyHandler;
    document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
  }
  scheduleScan(0);
  return true;
}

function destroy() {
  stopNextDrop?.();
  stopNextDrop = null;
  stopPerformance();
  if (!IS_POPOUT) window.__palbooPromptEnhancer?.destroy();
  if (!IS_POPOUT) window.__palbooTokenMeter?.destroy();
  if (!IS_POPOUT) window.__palbooTerminology?.destroy();
  if (!IS_POPOUT) window.__palbooTerminologyImports?.destroy();
  if (!IS_POPOUT) window.__palbooBots?.destroy();
  shellState.featureCleanup?.();
  clearTimeout(shellState.detachedRecoveryTimer);
  if (!IS_POPOUT) sessionStorage.removeItem(DETACHED_KEY);
  runtimeState.destroyed = true;
  stepwiseState.promptContext = null;
  contextState.latestTurnAnchor = null;
  contextState.pinnedPaneKey = '';
  contextState.pinnedSessionId = '';
  contextState.pinnedThreadRoot = null;
  if (runtimeState.settingsSyncTimer) window.clearTimeout(runtimeState.settingsSyncTimer);
  runtimeState.settingsSyncTimer = 0;
  cancelSourceCueAnimation();
  cancelViewAnimation();
  stopRuntime();
  runtimeState.signalCleanup?.();
  if (window[API_KEY]?.instanceId === INSTANCE_ID) delete window[API_KEY];
}

async function start() {
  scheduleSettingsSync();
  if (runtimeState.startupPromise) return runtimeState.startupPromise;
  const generation = runtimeState.runtimeGeneration;
  runtimeState.startupPromise = (async () => {
    const settings = await ensureSettings();
    if (!isCurrentInstance() || generation !== runtimeState.runtimeGeneration) return;
    if (!runtimeEnabled(settings)) {
      pushDiagnostic('startup:disabled', {});
      runtimeState.startupPromise = null;
      return;
    }
    activateRuntime();
  })();
  return runtimeState.startupPromise;
}

async function launcherAction(action, toggle = false) {
  if (!hostPageAllowed(shellState) && action !== 'settings') return;
  if (!toggle) cancelFaceClick();
  if (action === 'toggle') {
    if (runtimeState.settings?.popoutSupported === true) emitSignal('windowToggle', undefined);
    return;
  }
  if (action === 'settings') {
    const result = await openSettings();
    if (!result.ok && !result.cancelled) throw Error(result.message);
    return;
  }
  if (action === 'outside') {
    if (runtimeState.settings?.popoutSupported !== true) return;
    if (independentFeatures()) {
      if (featurePlacement() === 'desktop') await revealMainFeature();
      else await popoutSelectedFeature();
    } else if (!shellState.detached) await togglePanelWindow({ expand: true });
    return;
  }
  if (independentFeatures() && featurePlacement() === 'desktop') {
    await popoutSelectedFeature();
    toggleFeatureDock(true);
  } else if (shellState.detached) {
    const result = await bridgeCall('/panel/return', {});
    if (result.error) throw Error(result.error);
  } else if (independentFeatures() && featurePlacement() === 'sidebar') {
    const reopened = await reopenMainFeatures();
    toggleFeatureDock(reopened || (toggle ? !shellState.dockOpen : true));
  } else {
    const reopened = independentFeatures() && (await reopenMainFeatures());
    setOpen(reopened || (toggle ? !shellState.open : true));
  }
}

let stopNextDrop = null;
function syncTools() {
  if (IS_POPOUT || !isCurrentInstance() || !runtimeState.settingsLoaded) return;
  if (stepwiseEnabled()) {
    if (!stopNextDrop)
      stopNextDrop = installNextDrop({ read: exportPanelState, command: panelCommand });
  } else {
    stopNextDrop?.();
    stopNextDrop = null;
  }
  if (runtimeState.settings?.grokbotEnabled === true) {
    if (!window.__palbooBots)
      installBots({
        isEnabled: () => isCurrentInstance() && runtimeState.settings?.grokbotEnabled === true,
      });
  } else window.__palbooBots?.destroy();
  if (runtimeState.settings?.tokenMeterEnabled === true) {
    if (!window.__palbooTokenMeter)
      installTokenMeter({
        isEnabled: () => isCurrentInstance() && runtimeState.settings?.tokenMeterEnabled === true,
      });
  } else window.__palbooTokenMeter?.destroy();
  if (runtimeState.settings?.promptEnhancementEnabled !== false) {
    if (!window.__palbooPromptEnhancer)
      installPromptEnhancer({
        request: bridgeCall,
        isEnabled: () =>
          isCurrentInstance() && runtimeState.settings?.promptEnhancementEnabled !== false,
      });
  } else window.__palbooPromptEnhancer?.destroy();
  if (runtimeState.settings?.terminologyImportsPending === true) {
    if (!window.__palbooTerminologyImports)
      installTerminologyImports({
        request: bridgeCall,
        isEnabled: () =>
          isCurrentInstance() && runtimeState.settings?.terminologyImportsPending === true,
      });
  } else window.__palbooTerminologyImports?.destroy();
  if (runtimeState.settings?.terminologyEnabled !== false) {
    if (!window.__palbooTerminology)
      installTerminology({
        request: bridgeCall,
        getRoot: chatRoot,
        isBusy: chatBusy,
        getExchange: () => ({
          ...terminologyExchange(),
          sessionId: contextSnapshot().sessionId,
          title: document.title,
        }),
      });
  } else window.__palbooTerminology?.destroy();
}

function install() {
  // Re-injection replaces stale instances instead of layering another UI on top.
  const previous = window[API_KEY];
  const previousRuntimeHealthy =
    previous?.state?.runtimeActive === true &&
    previous?.state?.settingsLoaded === true &&
    document.readyState !== 'loading' &&
    previous?.state?.root?.isConnected === true &&
    previous?.state?.popover?.isConnected === true &&
    Boolean(previous?.state?.observer) &&
    document.querySelectorAll?.(`[${ROOT_ATTR}="true"]`).length === 1 &&
    document.querySelectorAll?.(`#${STYLE_ID}`).length === 1 &&
    document.querySelectorAll('[data-palboo-dock]').length <= 1 &&
    document.getElementById(STYLE_ID)?.dataset.codexStepwiseStyleVersion === SCRIPT_VERSION;
  if (
    previous?.version === SCRIPT_VERSION &&
    previous?.state?.destroyed !== true &&
    previousRuntimeHealthy
  ) {
    previous.syncSettings?.();
    previous.start?.();
    return;
  }
  if (previous && typeof previous.destroy === 'function') previous.destroy();
  document.querySelectorAll?.(`[${ROOT_ATTR}="true"]`).forEach((node) => node.remove());
  // Older runtimes could leave empty layout slots after replacing their root.
  document
    .querySelectorAll('[data-palboo-dock],[data-codex-buddy-dock]')
    .forEach((node) => node.remove());
  document.getElementById(STYLE_ID)?.remove();

  initializeState({
    width: readPanelWidth(),
    height: readPanelHeight(),
    hostTypography: fallbackHostTypography(),
    fontOffset: readFontOffset(),
    material: readMaterial(),
    liquidVariant: readLiquidVariant(),
    diagnostics: readDiagnostics(),
  });
  const stopSignals = [
    onSignal('tools', syncTools),
    onSignal('render', (options) =>
      measureWork('render', () => {
        renderFloat(options);
        if (IS_POPOUT || !runtimeState.runtimeActive) return;
        const expression = resolveFabExpression();
        syncLauncher({
          open:
            shellState.open ||
            shellState.detached ||
            (independentFeatures() && featurePlacement() === 'desktop'),
          root: shellState.root,
          canUseOfficial: () => Boolean(chatRoot()),
          pluginOpened: () => {
            cancelFaceClick();
            if (independentFeatures()) toggleFeatureDock(false);
            else if (!shellState.detached) setOpen(false);
          },
          expression,
          expressionLabel: fabExpressionLabel(expression),
          sourceCue: activePaneCue(),
          defaultAction: shellState.launcherAction,
          settingsStatus: runtimeState.settingsOpenStatus,
          settingsBusy: runtimeState.settingsOpening,
          dismissSettingsStatus: () => {
            runtimeState.settingsOpenStatus = '';
            emitSignal('render', undefined);
          },
          colors: panelAppearance().colors,
          theme: shellState.theme,
          outsideAvailable: runtimeState.settings?.popoutSupported === true,
          action: (action) => launcherAction(action),
          click: (event) => {
            const run = (action) => {
              void launcherAction(action, true).catch((error) => {
                if (action !== 'settings') {
                  stepwiseState.bridgeError = String(error);
                  runtimeState.settingsOpenStatus = String(error);
                }
                emitSignal('render', undefined);
              });
            };
            onLauncherClick(
              event,
              () => run(shellState.launcherAction),
              () => run(shellState.launcherDoubleAction),
            );
          },
          pointerDown: onLauncherPointerDown,
          keyDown: onLauncherKeyDown,
          settingsBrowser: () => emitSignal('openSettings', 'web'),
          settings: () => {
            cancelFaceClick();
            void launcherAction(shellState.launcherContextAction).catch((error) => {
              runtimeState.settingsOpenStatus = String(error);
              emitSignal('render', undefined);
            });
          },
        });
      }),
    ),
    onSignal('scan', (delay) => scheduleScan(delay)),
    onSignal('runtime', (enabled) => (enabled ? activateRuntime() : stopRuntime())),
    onSignal('bindingUnavailable', () => {
      stepwiseState.stepwiseEpoch += 1;
      stepwiseState.bridgePendingHash = '';
      stepwiseState.bridgePendingRequestId = 0;
      if (stepwiseState.bridgeStatus === 'pending') stepwiseState.bridgeStatus = 'idle';
      outlineState.outlineEpoch += 1;
      outlineState.outlineRefreshPromise = null;
      if (outlineState.outlineStatus === 'pending')
        outlineState.outlineStatus = outlineState.outlineItems.length ? 'ready' : 'idle';
    }),
    onSignal('context', () => {
      resetStepwiseFeature('idle', { preserveCache: true });
      resetOutlineFeature();
    }),
    onSignal('complete', (count) => triggerCompletionBeam(count)),
    onSignal('preview', () => clearPromptInteractionTimers()),
    onSignal('openSettings', () => {
      cancelFaceClick();
      void openSettings();
    }),
    onSignal('settings', () => {
      void reloadSettings();
    }),
    onSignal('generationControl', ({ mode, busy }) => updateGenerationModeControl(mode, busy)),
    onSignal('verify', () => scan()),
    onSignal('theme', () => syncTheme()),
    onSignal(
      'windowToggle',
      (options) =>
        void (independentFeatures() ? popoutSelectedFeature() : togglePanelWindow(options)),
    ),
    onSignal('workbenchToggle', (expanded) =>
      independentFeatures()
        ? toggleFeatureDock(expanded)
        : expanded
          ? openWorkbench()
          : closeWorkbench(),
    ),
  ];
  runtimeState.signalCleanup = () => stopSignals.forEach((stop) => stop());
  if (!IS_POPOUT)
    window.__palbooTypography = createTypographyTracker(
      chatRoot,
      () => window.__palbooModelControl?.inputTarget()?.composer,
    );
  window[API_KEY] = {
    version: SCRIPT_VERSION,
    instanceId: INSTANCE_ID,
    translate: tr,
    development: DEVELOPMENT,
    get state() {
      return debugState();
    },
    scan,
    samplePerformance,
    stopPerformance,
    start,
    destroy,
    loadSettings,
    syncSettings,
    setOpen,
    setWorkbench,
    setMaterial: writeMaterial,
    toggleMaterial,
    dockRight: dockRightKeepHeight,
    getFabExpression: () => resolveFabExpression(),
    renderFloat,
    panelPreferences,
    exportPanelState,
    panelAppearance,
    syncTypography: (value) => window.__palbooTypography?.configure(value),
    typography: () => {
      const value = window.__palbooTypography?.snapshot();
      syncTheme();
      return value;
    },
    panelReadingState,
    panelWindowAnchor,
    blinkHandoff,
    panelCommand,
    setDetached,
    syncPanelPreferences,
    receivePanelState,
    panelDisconnected,
    nativeGestureEnded,
    hostPageAllowed: () => hostPageAllowed(shellState),
    desktopStatus: () => {
      if (!IS_POPOUT) window.__palbooTokenMeter?.refresh();
      if (runtimeState.runtimeActive && !shellState.root?.isConnected) scheduleScan(0);
      return {
        pageKind: hostPageKind(),
        hasAnswer: Boolean(contextState.lastAssistantHash),
        headings:
          contextState.lastAssistantHash &&
          contextState.lastAssistantHash === outlineState.outlineSourceHash
            ? outlineState.outlineItems.length
            : 0,
      };
    },
    diagnostics: () => runtimeState.diagnostics.slice(),
    verifyRequest: (context, answerHash) => {
      scan();
      return (
        contextMatches(context) && contextState.lastAssistantHash === answerHash && !chatBusy()
      );
    },
  };

  void start();
}

install();
