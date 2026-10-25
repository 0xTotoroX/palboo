import { tr } from '../shared/i18n.js';
/* [INPUT]: 宿主公开 DOM 的右侧标签、插件菜单及当前聊天标识。
 * [OUTPUT]: Palboo 插件页签联动；设置入口只手动打开，Dev 试验可选择切换聊天后恢复。
 * [POS]: 最小宿主适配，不调用私有 IPC、不读取正文、不改变插件线程绑定。
 * [PROTOCOL]: 变更时同步 codex/AGENTS.md；真实宿主由用户手动验收。 */
import { mainChatSessionId } from './context.js';
const NAME = 'Palboo';
const NAMES = [NAME, 'PALBOO'];
const OWN = '[data-palboo-launcher],[data-companion-stepwise-root],[data-palboo-features-root]';
const RIGHT = '[data-app-shell-focus-area="right-panel"]';
const visible = (node) => {
  if (
    !(node instanceof HTMLElement) ||
    node.closest('[hidden],[inert],[aria-hidden="true"]') ||
    !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  )
    return false;
  const box = node.getBoundingClientRect();
  const left = Math.max(0, box.left),
    right = Math.min(innerWidth, box.right);
  const top = Math.max(0, box.top),
    bottom = Math.min(innerHeight, box.bottom);
  if (right <= left || bottom <= top) return false;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  return !!hit && node.contains(hit);
};
const label = (node) =>
  (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ');
function unique(selector, names) {
  const nodes = [...document.querySelectorAll(selector)].filter(
    (node) => visible(node) && !node.closest(OWN) && names.includes(label(node)),
  );
  if (nodes.length > 1)
    throw Error(
      tr('发现多个同名入口（{{names}}，{{count}}个），未自动选择。', {
        names: names.join(' / '),
        count: nodes.length,
      }),
    );
  return /** @type {HTMLElement|null} */ (nodes[0] || null);
}
function tab() {
  return unique(
    `${RIGHT} [role="tab"],[role="tablist"][aria-label="任务选项卡"] [role="tab"],[role="tablist"][aria-label="Task tabs"] [role="tab"],[data-tab-id] [role="tab"]`,
    NAMES,
  );
}
const sessionKey = () => mainChatSessionId();
class SourceChanged extends Error {
  constructor() {
    super(tr('聊天正在切换，旧操作已取消。'));
  }
}

/** @param {{onOpened:()=>void,onStatus:(message:string)=>void,follow?:boolean}} options */
export function createPluginTabLink({ onOpened, onStatus, follow = true }) {
  let stopped = false,
    enabled = false,
    running = null,
    last = sessionKey(),
    candidate = last,
    candidateAt = 0;
  let interval = 0;
  let stage = tr('识别聊天');
  const attempts = new Map();
  const check = (key) => {
    if (stopped || sessionKey() !== key) throw new SourceChanged();
    if (document.visibilityState !== 'visible') throw Error(tr('当前窗口不可见，未切换页签。'));
  };
  const wait = async (key, read, recoverSplit = false) => {
    let splitRequested = false;
    for (let i = 0; i < 50; i++) {
      if (stopped) throw new SourceChanged();
      const current = sessionKey();
      if (current && current !== key) throw new SourceChanged();
      if (!current) {
        if (recoverSplit && !splitRequested && tab()) {
          const split = unique('button', ['进入分屏视图', 'Enter split view']);
          if (
            split &&
            split.getAttribute('aria-pressed') !== 'true' &&
            !split.matches(':disabled,[aria-disabled="true"]')
          ) {
            splitRequested = true;
            split.click();
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
        continue;
      }
      check(key);
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw Error(tr('未找到官方 Palboo 页签，请确认插件已启用；可再次点击重试。'));
  };
  const click = (node, key) => {
    check(key);
    if (!visible(node) || node.matches(':disabled,[aria-disabled="true"]'))
      throw Error(tr('官方入口当前不可用。'));
    if (node.getAttribute('aria-haspopup') === 'menu') {
      const handled = !node.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
      node.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }),
      );
      if (handled) return;
    }
    node.click();
  };
  async function open(expectedKey) {
    stage = tr('恢复分屏');
    if (expectedKey && sessionKey() && sessionKey() !== expectedKey) throw new SourceChanged();
    if (document.visibilityState !== 'visible') throw Error(tr('当前窗口不可见，未切换页签。'));
    const split = unique('button', ['进入分屏视图', 'Enter split view']);
    if (split && split.getAttribute('aria-pressed') !== 'true') {
      if (split.matches(':disabled,[aria-disabled="true"]'))
        throw Error(tr('官方分屏入口当前不可用。'));
      split.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (stopped) return;
    }
    stage = tr('识别聊天');
    const key = sessionKey();
    if (!key) throw Error(tr('无法唯一识别当前聊天，未打开插件。'));
    if (expectedKey && key !== expectedKey) throw new SourceChanged();
    check(key);
    if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(visible))
      throw Error(tr('请先关闭当前对话框，再打开 Palboo。'));
    stage = tr('寻找右侧入口');
    let existing = tab();
    if (!existing) {
      const toggle = unique('button', [
        '显示/隐藏侧边面板',
        'Toggle side panel',
        '显示标签页',
        'Show tabs',
      ]);
      if (
        toggle &&
        (toggle.getAttribute('aria-pressed') === 'false' ||
          ['显示标签页', 'Show tabs'].includes(label(toggle)))
      )
        click(toggle, key);
      const next = await wait(
        key,
        () =>
          tab() ||
          unique('button', ['打开侧边面板标签页', 'Open side panel tab']) ||
          unique('button', ['新建标签页', 'New tab']) ||
          unique(`${RIGHT} button`, ['新标签页', 'New tab']) ||
          unique('button', ['新标签页', 'New tab']) ||
          unique(`${RIGHT} button`, [...NAMES, '更多工具…', 'More tools…']) ||
          unique('button', ['更多工具…', 'More tools…']),
      );
      if (next.getAttribute('role') !== 'tab') {
        if ([...document.querySelectorAll('[role="menu"]')].some(visible))
          throw Error(tr('请先关闭当前菜单，再打开 Palboo。'));
        stage = tr('打开插件菜单');
        if (['新标签页', 'New tab'].includes(label(next))) {
          // 新版左击会创建浏览器页；右键才打开包含官方插件的标签菜单。
          check(key);
          if (next.matches(':disabled,[aria-disabled="true"]'))
            throw Error(tr('官方入口当前不可用。'));
          next.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
          );
        } else click(next, key);
        if (!NAMES.includes(label(next))) {
          stage = tr('选择 Palboo 插件');
          const item = await wait(
            key,
            () =>
              unique('[role="menuitem"]', NAMES) ||
              unique(`${RIGHT} button`, [...NAMES, '更多工具…', 'More tools…']) ||
              unique('button', ['更多工具…', 'More tools…']),
          );
          click(item, key);
          if (!NAMES.includes(label(item)))
            click(await wait(key, () => unique('[role="menuitem"]', NAMES)), key);
        }
      }
      stage = tr('确认官方插件页签');
      existing = await wait(key, tab, true);
    }
    if (existing.getAttribute('aria-selected') !== 'true') click(existing, key);
    // 官方标签切换可能带入该聊天保存的完整视图；选择后再核对并恢复分屏。
    const finalSplit = unique('button', ['进入分屏视图', 'Enter split view']);
    if (finalSplit && finalSplit.getAttribute('aria-pressed') !== 'true') {
      const current = sessionKey();
      if (current && current !== key) throw new SourceChanged();
      if (!finalSplit.matches(':disabled,[aria-disabled="true"]')) finalSplit.click();
    }
    let confirmations = 0;
    await wait(key, () => {
      const split = unique('button', ['进入分屏视图', 'Enter split view']);
      const ready =
        tab()?.getAttribute('aria-selected') === 'true' &&
        (!split || split.getAttribute('aria-pressed') === 'true');
      confirmations = ready ? confirmations + 1 : 0;
      return confirmations >= 2;
    });
    check(key);
    onOpened();
    enabled = true;
    last = candidate = key;
    attempts.delete(key);
    onStatus(
      follow
        ? tr('官方 Palboo 页签已选中；切换聊天时自动恢复。')
        : tr('设置已在官方侧边页签打开。'),
    );
  }
  function request(expectedKey = sessionKey(), automatic = false) {
    if (stopped) return Promise.resolve();
    if (running) return running;
    if (!automatic) attempts.delete(expectedKey);
    const attempt = (attempts.get(expectedKey) || 0) + 1;
    attempts.set(expectedKey, attempt);
    if (attempts.size > 32) attempts.delete(attempts.keys().next().value);
    onStatus(tr('正在打开官方 Palboo 插件页签…'));
    running = open(expectedKey)
      .catch((error) => {
        if (stopped) return;
        // 切换取消不等于关闭跟随；新聊天稳定后继续。相同聊天最多重试一次。
        if (error instanceof SourceChanged) {
          if (enabled && attempt < 2 && (!sessionKey() || sessionKey() === expectedKey)) {
            last = null;
            candidateAt = Date.now();
          }
        }
        onStatus(`${stage}：${error.message}`);
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  // 只在首次手动成功后运行；同一聊天内收起、切换别的标签均不抢回。
  interval = window.setInterval(() => {
    if (!follow || stopped || !enabled || running || document.visibilityState !== 'visible') return;
    const next = sessionKey();
    if (next !== candidate) {
      candidate = next;
      candidateAt = Date.now();
      return;
    }
    if (!next || next === last || Date.now() - candidateAt < 750) return;
    last = next;
    void request(next, true);
  }, 250);
  return {
    open: () => request(),
    stop() {
      stopped = true;
      enabled = false;
      clearInterval(interval);
    },
  };
}

/** 本机设置只经可见宿主控件提交；返回 submitted 不代表网页加载成功。
 * @param {string} url
 * @param {{signal?:AbortSignal,expectedSession?:string|null,isCurrent?:()=>boolean}} options
 */
export async function openSettingsBrowser(
  url,
  { signal, expectedSession, isCurrent = () => true } = {},
) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw Error(tr('设置地址无效。'));
  }
  if (
    target.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    target.username ||
    target.password
  )
    throw Error(tr('设置地址必须是本机服务。'));
  let key = expectedSession || sessionKey();
  const deadline = Date.now() + 10000;
  const check = () => {
    signal?.throwIfAborted();
    if (!isCurrent()) throw Error(tr('设置打开已取消。'));
    const current = sessionKey();
    if (key && current && current !== key) throw new SourceChanged();
    if (document.visibilityState !== 'visible') throw Error(tr('当前窗口不可见，请返回后重试。'));
  };
  const pause = () =>
    new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(Error(tr('设置打开已取消。')));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, 80);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  const activate = (node, recovering = false) => {
    check();
    if (!recovering && !sessionKey()) throw Error(tr('聊天正在切换，请稍后重试。'));
    if (!visible(node) || node.matches(':disabled,[aria-disabled="true"]'))
      throw Error(tr('宿主浏览器入口不可用。'));
    node.click();
  };
  const restoreSplit = () => {
    const split = unique('button', ['进入分屏视图', 'Enter split view']);
    if (split && split.getAttribute('aria-pressed') !== 'true') activate(split, true);
  };
  const wait = async (read, message, requireIdentity = true) => {
    while (Date.now() < deadline) {
      check();
      if (requireIdentity && !sessionKey()) restoreSplit();
      if (!requireIdentity || sessionKey()) {
        const result = read();
        if (result) return result;
      }
      await pause();
    }
    throw Error(message);
  };
  check();
  restoreSplit();
  key = await wait(sessionKey, tr('请从可识别的当前聊天打开设置。'), false);
  const showTabs = unique('button', ['显示标签页', 'Show tabs']);
  if (showTabs) activate(showTabs);
  const selector =
    'input[data-browser-sidebar-address-input],input[aria-label="搜索或输入网址"],input[aria-label="Search or enter a URL"],input[placeholder="搜索或输入网址"],input[placeholder="Search or enter a URL"]';
  const panelId = (input) => input.closest('[data-tab-id]')?.getAttribute('data-tab-id') || '';
  const next = await wait(
    () => unique('button:not([role="tab"])', ['新标签页', 'New tab', '新建标签页']),
    tr('未找到宿主的新标签页入口，请展开标签栏后重试。'),
  );
  // 记录已有地址栏和标签，防止创建尚未完成时覆盖旧网页。
  const oldInputs = new Set(document.querySelectorAll(selector));
  const oldPanels = new Set(
    [...document.querySelectorAll('[data-tab-id]')].map((node) => node.getAttribute('data-tab-id')),
  );
  activate(next);
  let browserRequested = false;
  const input = await wait(() => {
    const inputs = [...document.querySelectorAll(selector)].filter(
      (node) =>
        visible(node) &&
        !oldInputs.has(node) &&
        (panelId(node)
          ? !oldPanels.has(panelId(node))
          : oldInputs.size === 0 && oldPanels.size === 0),
    );
    if (inputs.length > 1) throw Error(tr('无法唯一识别新标签页的地址栏。'));
    if (inputs[0]) return inputs[0];
    // 只接受明确的浏览器菜单项，不把重建的 New tab 按钮当成第二步。
    if (!browserRequested) {
      const browser = unique('[role="menuitem"]', ['浏览器', 'Browser']);
      if (browser) {
        browserRequested = true;
        activate(browser);
      }
    }
    return null;
  }, tr('未确认新浏览器标签的地址栏，请重试。'));
  const owner = panelId(input);
  const address = () => {
    const inputs = [...document.querySelectorAll(selector)].filter(
      (node) => visible(node) && (owner ? panelId(node) === owner : node === input),
    );
    if (inputs.length > 1) throw Error(tr('无法唯一识别浏览器地址栏。'));
    return /** @type {HTMLInputElement|null} */ (inputs[0] || null);
  };
  check();
  if (!sessionKey() || address() !== input) throw Error(tr('浏览器地址栏已变化，请重试。'));
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, url);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  // 有界等待代替可能被隐藏窗口暂停的 requestAnimationFrame。
  await pause();
  check();
  if (!sessionKey() || !input.isConnected || address() !== input || input.value !== url)
    throw Error(tr('浏览器地址栏已变化，未提交设置地址，请重试。'));
  const enter = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(enter);
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  if (!enter.defaultPrevented) throw Error(tr('宿主未确认设置地址提交，请在地址栏检查或重试。'));
  await wait(() => {
    const committed = address();
    if (!committed || document.activeElement === committed) return false;
    try {
      const value = new URL(
        committed.value.includes('://') ? committed.value : `http://${committed.value}`,
      );
      // 失焦且宿主保留目标地址仅确认地址提交；不声称网页已加载。
      return (
        value.origin === target.origin &&
        value.pathname === target.pathname &&
        value.search === target.search
      );
    } catch {
      return false;
    }
  }, tr('宿主未确认设置地址提交，请在浏览器地址栏检查或重试。'));
  restoreSplit();
  await wait(() => {
    const split = unique('button', ['进入分屏视图', 'Enter split view']);
    return address() && (!split || split.getAttribute('aria-pressed') === 'true');
  }, tr('设置地址已提交，但未确认浏览器侧栏可见，请检查分屏。'));
  check();
  return { status: 'submitted' };
}
