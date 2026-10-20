/*
 * [INPUT]: 开发网关注入的脚本、同源认证 API 与共享外观变量。
 * [OUTPUT]: 仅 Dev 设置页常驻展开的来源、切换动效与实际资源回读确认。
 * [POS]: 由开发监督进程提供，旧 worktree 无需合并此模块；不进入正式构建或聊天界面。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
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
:host{display:block;max-width:1120px;margin:20px auto 0!important;padding:0 40px!important;font:13px/1.6 system-ui;color:var(--buddy-text,CanvasText)}
@media(max-width:850px){:host{padding:0 23px!important}}
@media(max-width:650px){:host{padding:0 18px!important}}
:host-context(#settings-dev-content){max-width:none;margin:0!important;padding:0!important;font-size:14px}
:host-context(#settings-dev-content) .source-content{border:0;background:transparent;padding:0}
.source-content{border:1px solid var(--buddy-border,GrayText);border-radius:var(--settings-control-radius,4px);background:var(--buddy-surface,Canvas);padding:12px 16px}
p{margin:8px 0;overflow-wrap:anywhere;color:var(--buddy-muted,GrayText)}
[data-current]{margin-top:0;color:inherit}
form{display:flex;align-items:center;gap:10px;flex-wrap:wrap}select,button{box-sizing:border-box;font:inherit;color:inherit;background:var(--buddy-input,Canvas);border:1px solid var(--buddy-border,GrayText);border-radius:var(--settings-control-radius,4px);padding:6px 10px;max-width:100%;min-height:var(--settings-control-height,38px)}
button{cursor:pointer;background:var(--settings-selected,ButtonFace);color:var(--settings-selected-text,ButtonText)}button:disabled,select:disabled{opacity:.45;cursor:not-allowed}:focus-visible{outline:1px solid var(--buddy-focus,Highlight);outline-offset:2px}
button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:8.5em}
button[data-busy="true"]{opacity:1;cursor:progress}
button[data-busy="true"]::before{content:"";width:14px;height:14px;box-sizing:border-box;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:source-spin .8s linear infinite}
[data-state][data-complete="true"]{color:inherit;font-weight:600;animation:source-confirm .24s ease-out}
@keyframes source-spin{to{transform:rotate(360deg)}}
@keyframes source-confirm{from{opacity:.35}to{opacity:1}}
@media(prefers-reduced-motion:reduce){button[data-busy="true"]::before,[data-state][data-complete="true"]{animation:none}}
@supports(appearance:base-select){
select,select::picker(select){appearance:base-select}
select{align-items:center;cursor:pointer}
select::picker-icon{color:var(--buddy-muted,GrayText)}
select::picker(select){font:inherit;color:var(--buddy-text,CanvasText);background:var(--buddy-surface,Canvas);border:1px solid var(--buddy-border,GrayText);border-radius:var(--settings-control-radius,4px);box-shadow:var(--settings-menu-shadow,0 8px 28px #0002);padding:4px;margin-block:5px;min-width:anchor-size(width);max-width:calc(100vw - 24px);max-height:min(360px,60vh);overflow-y:auto}
option{display:flex;align-items:center;gap:12px;min-height:36px;padding:8px 10px;border:0;border-radius:2px;font:inherit;color:inherit;background:transparent;white-space:normal;overflow-wrap:anywhere}
option:checked{background:var(--settings-selected,ButtonFace);color:var(--settings-selected-text,ButtonText);font-weight:600}
option::checkmark{order:1;margin-inline-start:auto;color:var(--buddy-muted,GrayText)}
option:focus-visible{outline-offset:-1px}option:disabled{opacity:.45;cursor:not-allowed}
@media(hover:hover){option:hover:not(:checked):not(:disabled){background:var(--buddy-subtle,ButtonFace)}}
}
</style><div class="source-content"><p data-current>读取中…</p><p data-path></p>
<form><label for="source">调试 worktree</label><select id="source" aria-label="调试 worktree"></select><button type="submit">切换来源</button></form>
<p data-state role="status" aria-live="polite"></p><p>各来源配置独立，切换不重启 Codex。</p></div>`;
document.body.prepend(host);
const current = view.querySelector('[data-current]');
const select = view.querySelector('select');
const button = view.querySelector('button');
const state = view.querySelector('[data-state]');
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
  sessionStorage.removeItem(switchKey);
} catch {}
function updateControls(busy) {
  button.dataset.busy = String(busy);
  button.setAttribute('aria-busy', String(busy));
  button.textContent = busy ? '切换中…' : '切换来源';
  select.disabled = busy;
  button.disabled = busy || select.value === active;
}
async function api(body) {
  const token = credential();
  if (!token) throw new Error('请从眼睛菜单打开一次设置，当前标签页会自动恢复连接。');
  const response = await fetch('/api/dev/sources', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401)
    throw new Error('连接凭据已过期，请从工作台齿轮或 npm run dev:settings 重新打开。');
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || '开发来源暂时不可用');
  return result;
}
function render(result) {
  const source = result.sources.find((item) => item.path === result.active);
  current.textContent = `当前 · ${source?.branch || '未知'} · ${source?.commit || ''}${source?.dirty ? '（未提交修改）' : ''}`;
  view.querySelector('[data-path]').textContent = result.active;
  const chosen = select.value;
  const changed = active !== result.active;
  select.replaceChildren(
    ...result.sources.map((item) => {
      const option = document.createElement('option');
      option.value = item.path;
      option.textContent = `${item.branch} · ${item.commit}${item.dirty ? ' *' : ''} — ${item.path}`;
      return option;
    }),
  );
  active = result.active;
  select.value = !changed && result.sources.some((s) => s.path === chosen) ? chosen : active;
  const phases = {
    preparing: '正在编译目标来源，原工作台保持运行…',
    connecting: '正在交接开发连接…',
    restoring: '切换失败，正在恢复原来源…',
    failed: '连接恢复失败，请查看开发日志。',
  };
  serverBusy = Boolean(result.busy);
  const error = switchError || result.error || result.buildError || result.phase === 'failed';
  const complete = !pending && !serverBusy && !error && result.loaded && active === switchTarget;
  state.dataset.complete = String(Boolean(complete));
  state.textContent =
    switchError ||
    result.error ||
    (result.buildError && `热更新失败，保留上次资源：${result.buildError}`) ||
    phases[result.phase] ||
    (pending
      ? '正在准备目标来源…'
      : complete
        ? `已切换至 ${source.branch} · 已同步 ${result.resource}`
        : result.loaded
          ? `已同步 · ${result.resource}`
          : result.connected
            ? '已连接，等待界面资源确认'
            : '尚未连接');
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
    current.textContent = '无法连接';
    updateControls(pending);
    select.disabled = button.disabled = true;
    state.dataset.complete = 'false';
    state.textContent = error.message;
  } finally {
    polling = false;
  }
}
select.addEventListener('change', () => {
  button.disabled = pending || serverBusy || select.value === active;
});
view.querySelector('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending || serverBusy || select.value === active) return;
  const target = select.value;
  requestEpoch += 1;
  pending = true;
  switchError = switchTarget = '';
  state.dataset.complete = 'false';
  updateControls(true);
  state.textContent = '正在准备目标来源…';
  try {
    await api({ path: target });
    try {
      sessionStorage.setItem(switchKey, target);
    } catch {}
    state.textContent = '来源已交接，正在刷新界面…';
    location.reload();
  } catch (error) {
    requestEpoch += 1;
    switchError = error.message;
    state.textContent = switchError;
    pending = false;
    updateControls(serverBusy);
  }
});
void refresh();
const timer = setInterval(refresh, 5000);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
