/* [INPUT]: Real desktop feature page with synthetic outline/next content.
 * [OUTPUT]: Trusted pointer resize, selection isolation, stable content and cancellation checks.
 * [POS]: Shared feature browser regression. [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';

export async function desktopResizeCases(page) {
  const originalSize = page.viewportSize();
  const label = page.locator('[data-feature="outline"] .csw-outline-label').first();
  await label.waitFor();
  // Chromium's button label is not selectable by default. Exercise the selectable
  // text case reported in WKWebView, including an explicit rule inside Shadow DOM.
  await label.evaluate((node) => {
    node.style.webkitUserSelect = node.style.userSelect = 'text';
  });
  const handle = (corner) => page.locator(`.csw-resize-handle[data-corner="${corner}"]`);
  const resizing = page.locator('.csw-popover[data-resizing="true"]');
  for (const corner of ['bl', 'br']) {
    await page.evaluate(() => {
      window.getSelection().removeAllRanges();
      const nodes = [...document.querySelectorAll('.csw-feature-content > div')].map((host) =>
        host.shadowRoot.querySelector('.feature-projection'),
      );
      const probe = (window.resizeProbe = {
        nodes,
        children: nodes.map((node) => node.firstElementChild),
        frames: 0,
        missing: 0,
        replacements: 0,
        prevented: false,
        active: true,
      });
      const sample = () => {
        if (!probe.active) return;
        probe.frames++;
        nodes.forEach((node, index) => {
          if (!node.isConnected || !node.getClientRects().length) probe.missing++;
          if (node.firstElementChild !== probe.children[index]) probe.replacements++;
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      document.getElementById('root').addEventListener(
        'pointerdown',
        (event) => {
          probe.prevented = event.defaultPrevented && event.isTrusted;
          probe.pointerId = event.pointerId;
        },
        { once: true },
      );
    });
    const box = await handle(corner).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(await resizing.count(), 1);
    assert.equal(await page.evaluate(() => window.resizeProbe.prevented), true);
    assert.equal(
      await label.evaluate((node) => getComputedStyle(node).webkitUserSelect),
      'none',
      'native resize also disables text selection inside feature Shadow DOM',
    );
    // Move over real feature text while the viewport changes and two state polls run.
    for (const [width, height] of [
      [1100, 760],
      [1000, 680],
      [1160, 820],
      [1200, 700],
    ]) {
      await page.setViewportSize({ width, height });
      const text = await label.boundingBox();
      await page.mouse.move(text.x + text.width / 2, text.y + text.height / 2, { steps: 6 });
      await page.waitForTimeout(110);
    }
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
    assert.equal(
      await handle(corner).evaluate((node) => node.hasPointerCapture(window.resizeProbe.pointerId)),
      true,
    );
    await page.mouse.up();
    assert.equal(await resizing.count(), 0);
    assert.equal(await page.locator('[data-window-resizing]').count(), 0);
    assert.notEqual(
      await label.evaluate((node) => getComputedStyle(node).webkitUserSelect),
      'none',
    );
    const sampled = await page.evaluate(() => {
      const probe = window.resizeProbe;
      probe.active = false;
      // A late native completion must be harmless after a normal pointer release.
      window.__companionFloatingPanel.nativeGestureEnded();
      return { frames: probe.frames, missing: probe.missing, replacements: probe.replacements };
    });
    assert.ok(sampled.frames > 10);
    assert.equal(sampled.missing, 0, 'visible content stays mounted throughout live resize');
    assert.equal(sampled.replacements, 0, 'resize/state polls keep the existing content nodes');
  }
  // Normal selection still works after resizing; do not permanently lock the body.
  const text = await label.boundingBox();
  await page.mouse.move(text.x + 2, text.y + text.height / 2);
  await page.mouse.down();
  await page.mouse.move(text.x + Math.min(150, text.width - 2), text.y + text.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  assert.ok((await page.evaluate(() => window.getSelection().toString())).length > 0);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  for (const cause of ['native', 'blur', 'pointercancel']) {
    const box = await handle('br').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(await resizing.count(), 1);
    await page.evaluate((cause) => {
      if (cause === 'native') window.__companionFloatingPanel.nativeGestureEnded();
      else if (cause === 'blur') window.dispatchEvent(new Event('blur'));
      else
        window.dispatchEvent(
          new PointerEvent('pointercancel', { pointerId: window.resizeProbe.pointerId }),
        );
    }, cause);
    assert.equal(await resizing.count(), 0, `${cause} releases the resize guard`);
    await page.mouse.up();
    assert.equal(await page.locator('[data-window-resizing]').count(), 0);
  }
  await page.setViewportSize(originalSize);
  await label.evaluate((node) => {
    node.style.removeProperty('-webkit-user-select');
    node.style.removeProperty('user-select');
  });
}
