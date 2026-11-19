import { measureWork } from '../shared/performance.js';
/* [INPUT]: Palboo 已识别的聊天根节点、一问一答与受限后台请求。
 * [OUTPUT]: 术语标注与稳定悬停释义；重扫保留当前有效范围与同语境待展开悬停，离开缓冲与卡片交互共享生命周期，不改变宿主正文。
 * [POS]: 术语显示旁路；单次检查复用当前语境，异步结果重新核验，不读取草稿或写主聊天。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { readTypography } from '../codex/typography.js';
import { textIndex, semanticSpans, scrollToRange } from './text-ranges.js';
import { createMatcher } from './matcher.js';
import { createTermPopover } from './popover.js';
import { inheritedAppearance } from './appearance.js';
let previewSerial = 0;
export function installTerminology({ request, getRoot, getExchange, isBusy, isolated = false }) {
  // 设置和官网复用真实标注引擎，但不接管宿主单例或读取后台状态。
  const HIGHLIGHT = isolated ? `palboo-preview-terms-${++previewSerial}` : 'palboo-terms';
  if (!isolated) window.__palbooTerminology?.destroy();
  let alive = true,
    root = null,
    observer = null,
    scanTimer = 0,
    hoverTimer = 0,
    closeTimer = 0,
    ticker = 0,
    frame = 0;
  let state = {
    preferences: { enabled: false, cardStyle: 'plain', mastered: [], semantic: false },
    entries: [],
  };
  let annotations = [],
    locations = [],
    locateTimer = 0,
    semanticMatches = [],
    active = null,
    pending = '',
    lastAnalysis = '',
    lastText = '',
    loading = false;
  let phase = 'waiting',
    lastReport = '',
    reportQueue = Promise.resolve(),
    retryAt = 0,
    failures = 0;
  const cache = new Map();
  function failedAnalysis() {
    failures++;
    if (failures < 3) {
      lastAnalysis = '';
      retryAt = Date.now() + 30000;
    }
  }
  const ACTIVE = HIGHLIGHT + '-active';
  const LOCATED = HIGHLIGHT + '-located';
  let point = { x: 0, y: 0 },
    appearanceKey = '',
    activeContext = '';
  /** @type {{ x: number, y: number, context: string, due: number } | null} */
  let pendingHover = null;
  const LEAVE_DELAY = 450;
  function keepOpen() {
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    pendingHover = null;
    clearTimeout(closeTimer);
    closeTimer = 0;
  }
  function hitAt(x, y) {
    return annotations.find(
      (a) =>
        valid(a) &&
        [...a.range.getClientRects()].some(
          (r) => x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 4 && y <= r.bottom + 4,
        ),
    );
  }
  function armHover(hit, x, y, context, delay = 60) {
    point = { x, y };
    keepOpen();
    pendingHover = { x, y, context, due: Date.now() + delay };
    hoverTimer = window.setTimeout(() => {
      hoverTimer = 0;
      pendingHover = null;
      if (!alive || context !== contextKey()) return;
      show(hit);
    }, delay);
  }
  function deferClose() {
    if (closeTimer || popup.interacting) return;
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      if (!popup.interacting) void hide();
    }, LEAVE_DELAY);
  }
  const popup = createTermPopover({
    followScroll: true,
    onEnter: keepOpen,
    onLeave: deferClose,
    onClose: () => {
      keepOpen();
      active = null;
      activeContext = '';
      CSS.highlights?.delete(ACTIVE);
    },
  });
  const highlightStyle = document.createElement('style');
  highlightStyle.dataset.buddyTerms = 'true';
  document.head.append(highlightStyle);
  function appearance() {
    const panel =
      /** @type {{ __companionFloatingPanel?: { panelAppearance?: () => import('../surfaces/theme/appearance').Appearance } }} */ (
        window
      );
    return panel.__companionFloatingPanel?.panelAppearance?.() || inheritedAppearance();
  }
  function updateTheme() {
    const theme = appearance(),
      key = JSON.stringify([theme, active && typography(active)]);
    if (key === appearanceKey) return;
    appearanceKey = key;
    const supplied = theme.colors?.accent;
    const accent = supplied && CSS.supports('color', supplied) ? supplied : 'currentColor';
    const dark =
      theme.theme === 'dark' ||
      (!theme.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    // 暗色下提亮标注并减少下划线透明度，避免深色强调色融入背景；正文颜色保持继承。
    const mark = dark ? `color-mix(in srgb,${accent} 70%,#fff)` : accent;
    // Highlight 不支持 font-weight；同色、无模糊描粗保留原文字节点和排版。
    highlightStyle.textContent = `::highlight(${HIGHLIGHT}),::highlight(${ACTIVE}),::highlight(${LOCATED}){text-shadow:-.45px 0 0 currentColor,.45px 0 0 currentColor}::highlight(${HIGHLIGHT}){background-color:color-mix(in srgb,${mark} ${dark ? 18 : 11}%,transparent);text-decoration:underline;text-decoration-color:color-mix(in srgb,${mark} ${dark ? 86 : 58}%,transparent);text-decoration-thickness:2.5px;text-underline-offset:3px}::highlight(${ACTIVE}),::highlight(${LOCATED}){background-color:color-mix(in srgb,${mark} ${dark ? 28 : 19}%,transparent);text-decoration-color:color-mix(in srgb,${mark} ${dark ? 100 : 88}%,transparent)}`;
    if (active) popup.update(active.term, cardOptions(active));
  }
  const api = async (payload, path = '/terminology') => {
    const value = await request(path, payload);
    if (value.error) throw Error(value.error);
    return value;
  };
  function hide(immediate = false) {
    keepOpen();
    return popup.hide(immediate);
  }
  function clear() {
    void hide(true);
    annotations = [];
    locations = [];
    clearTimeout(locateTimer);
    CSS.highlights?.delete(LOCATED);
    CSS.highlights?.delete(HIGHLIGHT);
    CSS.highlights?.delete(ACTIVE);
  }
  function valid(a) {
    return (
      alive &&
      state.preferences.enabled &&
      root === getRoot() &&
      root?.contains(a.range.startContainer) &&
      a.range.toString() === a.text
    );
  }
  function typography(a) {
    if (window.__palbooTypography) return window.__palbooTypography.resolved();
    const source = a?.range.startContainer;
    return readTypography(
      source ? (source.nodeType === Node.ELEMENT_NODE ? source : source.parentElement) : root,
    );
  }
  function cardOptions(a) {
    return {
      preferences: state.preferences,
      appearance: { ...appearance(), typography: typography(a) },
      favorite: state.preferences.favorites?.includes(a.term.id),
      mastered: state.preferences.mastered.includes(a.term.id),
      onFavorite: async (id, value) => {
        state = await api({ action: value ? 'favorite' : 'unfavorite', id });
        syncActivity();
      },
      onMaster: async (id, value) => {
        state = await api({ action: value ? 'master' : 'restore', id });
        syncActivity();
        window.setTimeout(() => {
          if (!alive) return;
          if (popup.termId === id)
            void hide().then((closed) => {
              if (alive && closed) scan();
            });
          else scan();
        }, 160);
      },
    };
  }
  function show(a, keyboard = false) {
    if (!valid(a)) return void hide(true);
    keepOpen();
    active = a;
    activeContext = contextKey();
    updateTheme();
    if (CSS.highlights && typeof Highlight !== 'undefined') {
      const highlight = new Highlight(a.range);
      highlight.priority = 1;
      CSS.highlights.set(ACTIVE, highlight);
    }
    // 打开时选定当前行和横向落点，随后只跟随文字布局，不追逐鼠标。
    const rects = [...a.range.getClientRects()].filter((r) => r.width && r.height);
    const lineIndex = Math.max(
      0,
      rects.findIndex(
        (r) => point.y >= r.top && point.y <= r.bottom && point.x >= r.left && point.x <= r.right,
      ),
    );
    const offset = rects[lineIndex] ? point.x - rects[lineIndex].left : 0;
    popup.show(
      a.term,
      () => {
        if (!valid(a) || activeContext !== contextKey()) return null;
        const rects = [...a.range.getClientRects()].filter((r) => r.width && r.height);
        const line = rects[lineIndex] || rects[0];
        if (!line || keyboard) return line;
        return new DOMRect(
          line.left + Math.max(0, Math.min(offset, line.width)),
          line.top,
          1,
          line.height,
        );
      },
      { ...cardOptions(a), keyboard },
    );
  }
  function contextKey() {
    return root && root === getRoot() ? String(getExchange()?.sessionId || '') : '';
  }
  function report(ids = []) {
    const payload = {
      action: 'observe',
      context: contextKey(),
      ids: [...new Set(ids)].sort(),
      phase: state.preferences.enabled ? phase : 'disabled',
      contextVerified: !!state.preferences.semantic,
      message: apiObject.lastError || '',
    };
    const signature = JSON.stringify(payload);
    if (signature === lastReport) return;
    lastReport = signature;
    reportQueue = reportQueue
      .catch(() => {})
      .then(async () => {
        if (!alive || payload.context !== contextKey()) return;
        await api(payload);
      })
      .catch(() => {
        lastReport = '';
      });
  }
  function scan() {
    return measureWork('terms-scan', scanContent);
  }
  function scanContent() {
    const resumeHover = pendingHover;
    clearTimeout(scanTimer);
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    pendingHover = null;
    if (!alive) return;
    if (!root || root !== getRoot() || !state.preferences.enabled) {
      clear();
      report();
      return;
    }
    annotations = [];
    locations = [];
    clearTimeout(locateTimer);
    CSS.highlights?.delete(LOCATED);
    const index = textIndex(root),
      terms = new Map(state.entries.map((t) => [t.id, t]));
    // 语义模式下字面命中只作候选，绝不盖过已核对的词义。
    const hits = state.preferences.semantic ? [] : createMatcher(state.entries)(index.text);
    const context = state.preferences.semantic && cache.size ? contextKey() : '';
    const confirmed = state.preferences.semantic
      ? [...cache.values()]
          .filter((entry) => entry.context === context)
          .flatMap((entry) => entry.matches)
      : [];
    for (const hint of confirmed) {
      const term = terms.get(hint.id);
      if (!term) continue;
      for (const span of semanticSpans(index.text, hint.quote, term)) {
        if (!hits.some((h) => h.start < span.end && h.end > span.start))
          hits.push({ ...span, term, semantic: true });
      }
    }
    const involved = hits.map((h) => h.term.id);
    // 定位保留所有已确认范围，已掌握或超过绘制上限的词条仍可显式跳转。
    for (const h of hits.sort((a, b) => b.start - a.start)) {
      const range = index.range(h.start, h.end);
      if (range) locations.push({ ...h, range, text: range.toString() });
    }
    annotations = locations
      .filter((h) => !state.preferences.mastered.includes(h.term.id))
      .slice(0, 400);
    if (CSS.highlights && typeof Highlight !== 'undefined')
      CSS.highlights.set(HIGHLIGHT, new Highlight(...annotations.map((a) => a.range)));
    if (active) {
      const retained =
        activeContext === contextKey() &&
        valid(active) &&
        annotations.find(
          (a) =>
            a.term.id === active.term.id &&
            a.range.startContainer === active.range.startContainer &&
            a.range.endContainer === active.range.endContainer &&
            a.range.startOffset === active.range.startOffset &&
            a.range.endOffset === active.range.endOffset,
        );
      if (retained) {
        // 保留对象及浮卡节点，待执行的指针动作、焦点和选择范围仍指向同一词语。
        Object.assign(active, retained);
        annotations[annotations.indexOf(retained)] = active;
        popup.update(active.term, cardOptions(active));
      } else void hide(true);
    }
    if (
      resumeHover &&
      !document.hidden &&
      !popup.interacting &&
      resumeHover.context === contextKey()
    ) {
      const hit = hitAt(resumeHover.x, resumeHover.y);
      if (hit && hit !== active) {
        const delay = resumeHover.due ? Math.max(0, resumeHover.due - Date.now()) : 60;
        armHover(hit, resumeHover.x, resumeHover.y, resumeHover.context, delay);
      } else if (!hit && active && !popup.near(resumeHover.x, resumeHover.y)) {
        deferClose();
      }
    }
    report(involved);
  }
  function schedule() {
    if (!alive || !state.preferences.enabled || document.hidden) return;
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 500);
  }
  async function refresh() {
    if (loading || !alive) return;
    loading = true;
    try {
      const value = await api({ action: 'state' });
      if (!alive) return;
      const entriesChanged = JSON.stringify(value.entries) !== JSON.stringify(state.entries);
      const changed =
        JSON.stringify([value.preferences, value.entries]) !==
        JSON.stringify([state.preferences, state.entries]);
      const toggled =
        value.preferences.semantic !== state.preferences.semantic ||
        value.preferences.enabled !== state.preferences.enabled;
      state = value;
      syncActivity();
      if (changed) {
        if (toggled || entriesChanged) {
          cache.clear();
          pending = '';
          lastAnalysis = '';
          failures = 0;
        }
        scan();
      }
    } catch (e) {
      apiObject.lastError = e.message;
    } finally {
      loading = false;
    }
  }
  function identity(currentRoot = getRoot()) {
    if (!root || currentRoot !== root) return null;
    const exchange = getExchange();
    if (!exchange?.answer || (!exchange.complete && isBusy())) return null;
    return {
      ...exchange,
      key: JSON.stringify([exchange.sessionId, exchange.question, exchange.answer]),
    };
  }
  async function analyze(exchange) {
    if (!state.preferences.enabled || !state.preferences.semantic || pending) return;
    if (!exchange || exchange.key === lastAnalysis || Date.now() < retryAt) return;
    if (cache.has(exchange.key) && cache.get(exchange.key).complete !== false) {
      semanticMatches = cache.get(exchange.key).matches;
      lastAnalysis = exchange.key;
      phase = 'ready';
      scan();
      return;
    }
    const id = `terms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pending = id;
    lastAnalysis = exchange.key;
    const originalRoot = root;
    phase = 'analyzing';
    apiObject.lastError = '';
    scan();
    try {
      const result = await api(
        {
          requestId: id,
          title: exchange.title,
          question: exchange.question,
          answer: exchange.answer,
        },
        '/terminology/analyze',
      );
      if (!alive || pending !== id || root !== originalRoot || identity()?.key !== exchange.key)
        return;
      semanticMatches = result.matches || [];
      cache.set(exchange.key, {
        context: exchange.sessionId,
        matches: semanticMatches,
        complete: !result.warning,
      });
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      phase = result.warning ? 'error' : 'ready';
      apiObject.lastError = result.warning || '';
      if (result.warning) failedAnalysis();
      else {
        failures = 0;
        retryAt = 0;
      }
      const updated = await api({ action: 'state' });
      if (!alive || pending !== id) return;
      state = updated;
      syncActivity();
      if (!state.preferences.enabled) return;
      scan();
    } catch (e) {
      if (alive && pending === id) {
        apiObject.lastError = e.message;
        phase = 'error';
        failedAnalysis();
        scan();
      }
    } finally {
      if (pending === id) pending = '';
    }
  }
  function tick() {
    return measureWork('terms-check', checkContext);
  }
  function checkContext() {
    if (!alive || !state.preferences.enabled || document.hidden) return;
    updateTheme();
    const next = getRoot();
    if (active && (!valid(active) || activeContext !== contextKey())) void hide(true);
    if (next !== root) {
      observer?.disconnect();
      root = next;
      semanticMatches = [];
      pending = '';
      lastAnalysis = '';
      lastText = '';
      failures = 0;
      retryAt = 0;
      phase = 'waiting';
      lastReport = '';
      clear();
      report();
      if (root) {
        observer = new MutationObserver((records) => {
          if (
            records.some((record) => {
              const element =
                record.target instanceof Element ? record.target : record.target.parentElement;
              return !element?.closest(
                '[data-companion-stepwise-root],[data-palboo-features-root],[data-palboo-prompt]',
              );
            })
          )
            schedule();
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        schedule();
      }
    }
    const exchange = identity(next);
    const key = exchange?.key || '';
    if (lastText !== key) {
      lastText = key;
      pending = '';
      semanticMatches = [];
      phase = exchange ? 'ready' : 'waiting';
      failures = 0;
      retryAt = 0;
      if (key && state.preferences.semantic && Date.now() >= retryAt) void analyze(exchange);
      else schedule();
    } else if (key) void analyze(exchange);
  }
  function move(e) {
    if (!annotations.length || document.hidden) return;
    cancelAnimationFrame(frame);
    frame = 0;
    if (popup.contains(e) || popup.interacting || popup.near(e.clientX, e.clientY)) {
      keepOpen();
      return;
    }
    const x = e.clientX,
      y = e.clientY;
    pendingHover = { x, y, context: contextKey(), due: 0 };
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (active && activeContext !== contextKey()) return void hide(true);
      const hit = hitAt(x, y);
      if (hit) point = { x, y };
      if (hit === active) {
        keepOpen();
        return;
      }
      clearTimeout(hoverTimer);
      hoverTimer = 0;
      if (hit) {
        armHover(hit, x, y, contextKey());
      } else {
        pendingHover = null;
        if (active) deferClose();
      }
    });
  }
  function keydown(e) {
    if (e.key === 'Escape' && active) {
      hide();
      return;
    }
    if (e.altKey && e.shiftKey && e.code === 'KeyT') {
      const hit = annotations.find(
        (a) =>
          valid(a) &&
          a.range.getBoundingClientRect().bottom > 0 &&
          a.range.getBoundingClientRect().top < innerHeight,
      );
      if (hit) {
        e.preventDefault();
        show(hit, true);
      }
    }
  }
  function syncActivity() {
    if (state.preferences.enabled) {
      if (ticker) return;
      document.addEventListener('pointermove', move, { passive: true });
      document.addEventListener('keydown', keydown);
      document.addEventListener('visibilitychange', visible);
      ticker = window.setInterval(tick, 1000);
      tick();
    } else {
      clearInterval(ticker);
      ticker = 0;
      observer?.disconnect();
      observer = null;
      clearTimeout(scanTimer);
      clearTimeout(hoverTimer);
      clearTimeout(closeTimer);
      cancelAnimationFrame(frame);
      pending = '';
      root = null;
      lastText = '';
      clear();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('visibilitychange', visible);
    }
  }
  function visible() {
    if (document.hidden) {
      keepOpen();
    } else {
      tick();
      schedule();
    }
  }
  const changed = () => void refresh();
  document.addEventListener('buddy-terminology-change', changed);
  const poll = isolated ? 0 : setInterval(refresh, 15000);
  const apiObject = {
    lastError: '',
    contextKey,
    locate(id, context) {
      if (!alive || !context || context !== contextKey() || !state.preferences.enabled)
        return false;
      // 重新采集当前根内的范围，拒绝重绘失效节点和其他聊天的旧请求。
      scan();
      const hit = locations.find((a) => a.term.id === id && valid(a));
      if (!hit || context !== contextKey() || !scrollToRange(hit.range)) return false;
      if (CSS.highlights && typeof Highlight !== 'undefined') {
        CSS.highlights.set(LOCATED, new Highlight(hit.range));
        locateTimer = window.setTimeout(() => CSS.highlights.delete(LOCATED), 1800);
      }
      return true;
    },
    typography: () => (root?.isConnected ? typography() : null),
    verify: (id) => alive && pending === id && identity()?.key === lastAnalysis,
    refresh,
    async progress(id, matches) {
      if (!alive || pending !== id || identity()?.key !== lastAnalysis) return false;
      const updated = await api({ action: 'state' });
      if (
        !alive ||
        pending !== id ||
        identity()?.key !== lastAnalysis ||
        !updated.preferences.enabled ||
        !updated.preferences.semantic
      )
        return false;
      state = updated;
      semanticMatches = matches;
      cache.set(lastAnalysis, { context: contextKey(), matches, complete: false });
      scan();
      return true;
    },
    destroy() {
      alive = false;
      pending = '';
      clear();
      observer?.disconnect();
      clearTimeout(scanTimer);
      cancelAnimationFrame(frame);
      clearInterval(ticker);
      clearInterval(poll);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('visibilitychange', visible);
      document.removeEventListener('buddy-terminology-change', changed);
      popup.destroy();
      highlightStyle.remove();
      if (window.__palbooTerminology === apiObject) delete window.__palbooTerminology;
    },
  };
  if (!isolated) window.__palbooTerminology = apiObject;
  tick();
  void refresh();
  return apiObject;
}
