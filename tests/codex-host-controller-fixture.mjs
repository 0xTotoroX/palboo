// [INPUT]: 自有合成路由与 CDP 替身，不读取外部配置或发送请求。
// [OUTPUT]: 保留已验证上游函数边界的最小控制器，用于 Rust 补丁行为回归。
// [POS]: codex_host/controller_tests.rs 的语法、重载与延迟挂载测试数据。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
function directRendererInstaller() {
  return `(() => {
    /* ${'synthetic '.repeat(6500)} */
    const connected = (routing) => {
      window.__fixtureOwner = routing.forComposer();
      return window.__fixtureOwner !== null;
    };
    const routing = window.__fixtureRouting;
    if (!routing || !connected(routing)) throw new Error('Renderer Host request manager is unavailable');
    return { state: 'ready', reason: 'owned-request-bridge' };
  })()`;
}
async function waitForDraftPrewarmPolicy(evaluate, expression) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    try {
      const value = await evaluate(expression);
      if (value?.state !== 'ready' || value?.reason !== 'owned-request-bridge')
        throw new Error('invalid installation status');
      return value;
    } catch (error) {
      if (!error.message.includes('Renderer Host request manager is unavailable')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw new Error('Manager mount timed out');
}
// prettier-ignore
function installRendererDraftPrewarmPolicyDirect(renderer) {
  return waitForDraftPrewarmPolicy(
    (expression) => renderer.evaluate(expression),
    directRendererInstaller()
  );
}
// prettier-ignore
async function installRendererLoadedModules(renderer) {
  await renderer.command("Debugger.enable");
}
