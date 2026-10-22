/* [INPUT]: Shared header template, workspace CSS and synthetic source/state updates.
 * [OUTPUT]: Initial and refreshed headers keep legacy text hidden and icon actions accessible.
 * [POS]: Isolated browser DOM/geometry checks; no screenshots, host data or native commands.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { workbenchHeadHtml } from '../ui/surfaces/workspace/chrome.js';

test('shared header never exposes legacy source text before association initialization', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
    page.setDefaultTimeout(5000);
    const css = await readFile('ui/surfaces/workspace/styles.css', 'utf8');
    for (const desktop of [false, true]) {
      for (const source of ['Codex · 等待聊天', '合成聊天来源']) {
        await page.setContent(
          `<style>${css}</style><div class="csw-workbench">${workbenchHeadHtml(desktop)}</div>`,
        );
        // Source updates can precede legacy association setup on the shared shell path.
        await page.locator('.csw-workbench-source').evaluate((el, text) => {
          el.textContent = text;
        }, source);
        const header = page.locator('.csw-workbench-head');
        await header.hover();
        assert.equal(await header.innerText(), '', 'only icons are painted in the header');
        assert.equal(await header.locator('[title]').count(), 0, 'no native hover tooltip');
        assert.equal(await header.locator('.csw-workbench-source').isVisible(), false);
        if (desktop) {
          for (const label of ['收回聊天', '放大']) {
            const button = header.getByRole('button', { name: label, exact: true });
            await button.focus();
            assert.equal(await button.evaluate((el) => el === document.activeElement), true);
            const box = await button.boundingBox();
            assert.ok(box.width >= 28 && box.height >= 28, 'window actions keep their hit area');
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
});
