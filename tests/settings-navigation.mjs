/* [INPUT]: A Playwright settings page and a stable destination ID.
 * [OUTPUT]: Opens the real sidebar/compact entry or the link on the feature list.
 * [POS]: Browser test helper; never writes a hash or bypasses the UI.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
const featureDetails = new Set([
  'outline',
  'next',
  'prompts',
  'terminology',
  'board',
  'model-control',
  'bots',
  'sites',
  'prompt-enhancement',
  'codex-host',
]);
export async function openSettingsPage(page, id) {
  const sidebar = (key) => page.locator('.settings-nav a[href="#settings-' + key + '"]');
  const openSidebar = async (key) => {
    const link = sidebar(key);
    await link.waitFor({ state: 'attached' });
    if (!(await link.isVisible())) await page.locator('.settings-nav-trigger').click();
    await link.click();
  };
  if (featureDetails.has(id) && !(await sidebar(id).count())) {
    if (!(await page.locator('.settings-feature-list').isVisible())) await openSidebar('features');
    await page.locator('.settings-feature-list a[href="#settings-' + id + '"]').click();
  } else {
    await openSidebar(id);
  }
}
