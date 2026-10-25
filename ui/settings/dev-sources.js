import { tr, getLocale, setLocale } from '../shared/i18n.js';
/*
 * [INPUT]: 开发网关注入的脚本、同源认证 API 与共享外观变量。
 * [OUTPUT]: 仅 Dev 设置页的目录单选列表、右侧切换操作与跨重载资源回读确认；不显示提交或资源哈希。
 * [POS]: 由开发监督进程提供，旧 worktree 无需合并此模块；不进入正式构建或聊天界面。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
setLocale(document.documentElement.lang || 'zh-CN');
const incoming = new URLSearchParams(location.hash.slice(1)).get('token');
if (incoming) {
  sessionStorage.setItem('companion-token', incoming);
  try {
    localStorage.setItem('companion-token', incoming);
  } catch {}
}
function credential() {
  let shared = '';
  try {
    shared = localStorage.getItem('companion-token') || '';
  } catch {}
  return shared || sessionStorage.getItem('companion-token') || '';
}
const host = document.createElement('section');
host.id = 'buddy-dev-sources';
const view = host.attachShadow({ mode: 'open' });
view.innerHTML = `<style>
:host{display:block;max-width:1120px;margin:20px auto 0!important;padding:0 40px!important;font:14px/1.5 system-ui;color:var(--buddy-text,CanvasText)}
:host-context(#settings-dev-content){max-width:none;margin:0!important;padding:0!important}
*{box-sizing:border-box}
.source-content{width:100%}
.source-list{display:grid;gap:12px;margin:0;padding:0;border:0;min-width:0}
.source-row{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:20px;padding:24px;cursor:pointer;border:1px solid var(--buddy-border,GrayText);border-radius:8px;background:var(--buddy-surface,Canvas);transition:border-color .16s,background .16s}
.source-row:has(:checked){border-color:var(--buddy-text,CanvasText);background:var(--buddy-subtle,ButtonFace)}
.source-row:has(:focus-visible){outline:2px solid var(--buddy-focus,Highlight);outline-offset:3px}
.source-row:has(:disabled){cursor:default}
input{width:18px;height:18px;margin:0;accent-color:var(--buddy-text,CanvasText)}
.source-name{display:block;font-size:22px;font-weight:600;letter-spacing:-.025em;overflow-wrap:anywhere;line-height:1.3}
.source-path{display:block;margin-top:8px;font-size:13px;color:var(--buddy-muted,GrayText);overflow-wrap:anywhere;user-select:text}
.source-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;font-size:12px}
.source-badge{white-space:nowrap;border-radius:4px;padding:4px 8px;background:var(--buddy-input,Canvas);color:var(--buddy-text,CanvasText)}
.source-dirty{color:var(--buddy-muted,GrayText)}
.source-actions{display:flex;align-items:center;justify-content:flex-end;gap:24px;margin-top:24px}
[data-state]{flex:1;margin:0;overflow-wrap:anywhere;color:var(--buddy-muted,GrayText)}
[data-state][data-error="true"]{color:var(--buddy-error,#b42318)}
[data-state][data-complete="true"]{color:inherit;animation:source-confirm .24s ease-out}
button{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;gap:8px;min-width:132px;min-height:42px;padding:10px 20px;border:0;border-radius:var(--settings-control-radius,4px);font:inherit;font-weight:600;cursor:pointer;background:var(--buddy-text,CanvasText);color:var(--buddy-page,Canvas);transition:opacity .16s}
button:disabled{opacity:.35;cursor:default}button:focus-visible{outline:2px solid var(--buddy-focus,Highlight);outline-offset:3px}
button[data-busy="true"]{opacity:1;cursor:progress}
button[data-busy="true"]::before{content:"";width:14px;height:14px;box-sizing:border-box;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:source-spin .8s linear infinite}
@media(hover:hover){.source-row:hover:not(:has(:disabled)){border-color:var(--buddy-text,CanvasText)}}
@keyframes source-spin{to{transform:rotate(360deg)}}
@keyframes source-confirm{from{opacity:.35}to{opacity:1}}
@media(max-width:850px){:host{padding:0 23px!important}}
@media(max-width:650px){:host{padding:0 18px!important}.source-row{padding:18px;gap:14px;grid-template-columns:18px minmax(0,1fr)}.source-name{font-size:20px}.source-badges{grid-column:2;justify-content:flex-start}.source-badges:empty{display:none}.source-actions{flex-wrap:wrap;gap:16px}[data-state]:not(:empty){flex-basis:100%}}
@media(prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important}}
</style><form class="source-content">
<fieldset class="source-list" aria-label="${tr('开发来源')}"><p data-loading>${tr('正在读取工作目录…')}</p></fieldset>
<div class="source-actions"><p data-state role="status" aria-live="polite"></p><button type="submit" disabled>${tr('切换来源')}</button></div>
</form>`;
document.body.prepend(host);
const list = view.querySelector('.source-list');
const button = view.querySelector('button');
const state = view.querySelector('[data-state]');
let chosen = '',
  sourceSignature = '';
let active = '',
  pending = false,
  polling = false,
  serverBusy = false,
  switchError = '',
  switchTarget = '',
  requestEpoch = 0;
const switchKey = 'palboo-dev-source-switch';
try {
  switchTarget = sessionStorage.getItem(switchKey) || '';
} catch {}
function updateControls(busy) {
  button.dataset.busy = String(busy);
  button.setAttribute('aria-busy', String(busy));
  button.textContent = busy ? tr('切换中…') : tr('切换来源');
  for (const radio of list.querySelectorAll('input')) radio.disabled = busy;
  button.disabled = busy || !chosen || chosen === active;
}
async function api(body) {
  const token = credential();
  if (!token) throw new Error(tr('请从眼睛菜单打开一次设置，当前标签页会自动恢复连接。'));
  const response = await fetch('/api/dev/sources', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401)
    throw new Error(tr('连接凭据已过期，请从工作台齿轮或 npm run dev:settings 重新打开。'));
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || tr('开发来源暂时不可用'));
  return result;
}
function render(result) {
  setLocale(document.documentElement.lang || 'zh-CN');
  host.lang = getLocale();
  list.setAttribute('aria-label', tr('开发来源'));
  const source = result.sources.find((item) => item.path === result.active);
  const changed = active !== result.active;
  if (changed || !result.sources.some((item) => item.path === chosen)) chosen = result.active;
  active = result.active;
  // 普通轮询保留节点与键盘焦点；资源指纹不参与视觉列表。
  const signature = JSON.stringify([
    getLocale(),
    active,
    result.sources.map(({ path, branch, dirty }) => ({ path, branch, dirty })),
  ]);
  if (sourceSignature !== signature) {
    sourceSignature = signature;
    list.replaceChildren(
      ...result.sources.map((item) => {
        const row = document.createElement('label');
        row.className = 'source-row';
        row.dataset.active = String(item.path === active);
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'source';
        radio.value = item.path;
        radio.checked = item.path === chosen;
        radio.setAttribute(
          'aria-label',
          tr('{{value1}} · {{value2}}', {
            value1: item.branch || tr('未命名分支'),
            value2: item.path,
          }),
        );
        const info = document.createElement('span');
        const name = document.createElement('span');
        name.className = 'source-name';
        name.textContent = item.branch || tr('未命名分支');
        const path = document.createElement('span');
        path.className = 'source-path';
        path.textContent = item.path;
        info.append(name, path);
        const badges = document.createElement('span');
        badges.className = 'source-badges';
        if (item.dirty) {
          const dirty = document.createElement('span');
          dirty.className = 'source-dirty';
          dirty.textContent = tr('未提交修改');
          badges.append(dirty);
        }
        if (item.path === active) {
          const badge = document.createElement('span');
          badge.className = 'source-badge';
          badge.textContent = tr('使用中');
          badges.append(badge);
        }
        row.append(radio, info, badges);
        return row;
      }),
    );
  }
  const phases = {
    preparing: tr('正在编译目标来源，原工作台保持运行…'),
    connecting: tr('正在交接开发连接…'),
    restoring: tr('切换失败，正在恢复原来源…'),
    failed: tr('连接恢复失败，请查看开发日志。'),
  };
  serverBusy = Boolean(result.busy);
  const error = switchError || result.error || result.buildError || result.phase === 'failed';
  const complete = !pending && !serverBusy && !error && result.loaded && active === switchTarget;
  state.dataset.complete = String(Boolean(complete));
  state.dataset.error = String(Boolean(error));
  state.textContent =
    switchError ||
    result.error ||
    (result.buildError &&
      tr('热更新失败，保留上次资源：{{value1}}', { value1: result.buildError })) ||
    phases[result.phase] ||
    (pending
      ? tr('正在准备目标来源…')
      : complete
        ? tr('已切换至 {{value1}}', { value1: source?.branch || tr('所选来源') })
        : result.loaded
          ? ''
          : result.connected
            ? tr('已连接，等待界面资源确认')
            : tr('尚未连接'));
  updateControls(pending || serverBusy || (!error && active === switchTarget && !result.loaded));
}
async function refresh() {
  if (polling || document.hidden) return;
  polling = true;
  const epoch = requestEpoch;
  try {
    const result = await api();
    if (epoch === requestEpoch) render(result);
  } catch (error) {
    if (epoch !== requestEpoch) return;
    updateControls(pending);
    for (const radio of list.querySelectorAll('input')) radio.disabled = true;
    button.disabled = true;
    view.querySelector('[data-loading]')?.remove();
    state.dataset.error = 'true';
    state.dataset.complete = 'false';
    state.textContent = error.message;
  } finally {
    polling = false;
  }
}
list.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  chosen = event.target.value;
  updateControls(pending || serverBusy);
});
view.querySelector('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending || serverBusy || chosen === active) return;
  const target = chosen;
  requestEpoch += 1;
  pending = true;
  switchError = switchTarget = '';
  // Vite can reload again while preparing the new source. Keep the last
  // requested target until another switch begins, and always recheck loaded.
  try {
    sessionStorage.removeItem(switchKey);
  } catch {}
  state.dataset.complete = 'false';
  state.dataset.error = 'false';
  updateControls(true);
  state.textContent = tr('正在准备目标来源…');
  try {
    await api({ path: target });
    try {
      sessionStorage.setItem(switchKey, target);
    } catch {}
    state.textContent = tr('来源已交接，正在刷新界面…');
    location.reload();
  } catch (error) {
    requestEpoch += 1;
    switchError = error.message;
    state.textContent = switchError;
    state.dataset.error = 'true';
    pending = false;
    updateControls(serverBusy);
  }
});
void refresh();
const timer = setInterval(refresh, 5000);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
