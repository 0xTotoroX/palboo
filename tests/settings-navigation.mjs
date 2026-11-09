/* [INPUT]: A Playwright settings page and a stable destination ID.
 * [OUTPUT]: Opens the real sidebar or compact menu entry.
 * [POS]: Browser test helper; never writes a hash or bypasses the UI.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export async function openSettingsPage(page, id) {
  const link = page.locator('.settings-nav a[href="#settings-' + id + '"]');
  await link.waitFor({ state: 'attached' });
  if (!(await link.isVisible())) await page.locator('.settings-nav-trigger').click();
  await link.click();
}
