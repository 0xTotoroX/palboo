/* [INPUT]: Real ModelView, ModelSpeedControl, model styles and isolated Light/Shadow DOM mounts.
 * [OUTPUT]: Speed-menu lifecycle, scroll/internal-scroll, deactivation, Escape/focus and disabled styling checks.
 * [POS]: Shared model speed-menu regression; no host, network or persisted configuration.
 * [PROTOCOL]: Keep tests/AGENTS.md and ui/features/model/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const modelCss = readFileSync('ui/features/model/styles.css', 'utf8');

const bundle = await build({
  stdin: {
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { ModelView } from './ui/features/model/view';

      function Harness({ initial, inShadow }) {
        const [state, setState] = useState(initial);
        const [active, setActive] = useState(true);
        const [mounted, setMounted] = useState(true);
        const [inert, setInert] = useState(false);
        const [hidden, setHidden] = useState(false);
        window.lastApplied ??= null;
        window.harness = {
          setActive,
          setMounted,
          setInert,
          setHidden,
          setModel(modelId, speed = 'standard') {
            setState((current) => ({
              ...current,
              snapshot: {
                ...current.snapshot,
                current: { model: modelId, reasoning: 'high', speed },
              },
            }));
          },
        };
        const view = mounted ? (
          <ModelView
            state={state}
            busy={false}
            active={active}
            reading={{}}
            action={async (data, action) => {
              if (action !== 'apply' || !data?.selection) return state;
              window.lastApplied = data.selection;
              const next = {
                ...state,
                snapshot: { ...state.snapshot, current: data.selection },
              };
              setState(next);
              return next;
            }}
          />
        ) : null;
        return (
          <div
            id="panel"
            inert={inert}
            hidden={hidden}
            style={{
              height: 220,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {view}
          </div>
        );
      }

      window.mountHarness = ({ initial, inShadow = false }) => {
        const host = document.getElementById('host');
        if (inShadow) {
          const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
          root.innerHTML = '<style>' + window.MODEL_CSS + '</style><div id="shadow-app"></div>';
          createRoot(root.getElementById('shadow-app')).render(
            <Harness initial={initial} inShadow />,
          );
        } else {
          createRoot(host).render(<Harness initial={initial} inShadow={false} />);
        }
      };
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
});

const baseState = {
  revision: 1,
  preferences: {
    enabled: true,
    pinned: ['m-fast', 'm-ultra', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8'],
    presets: [],
    showUsage: false,
  },
  snapshot: {
    target: { id: 'fixture' },
    revision: 'rev-1',
    status: 'ready',
    message: '',
    current: { model: 'm-fast', reasoning: 'high', speed: 'standard' },
    models: [
      { id: 'm-fast', label: 'Fast Only', reasoning: ['low', 'high'], fast: true },
      {
        id: 'm-ultra',
        label: 'Ultra Model',
        reasoning: ['low', 'high'],
        fast: true,
        ultrafast: true,
      },
      ...['3', '4', '5', '6', '7', '8'].map((n) => ({
        id: `m-${n}`,
        label: `Model ${n}`,
        reasoning: ['low', 'high'],
        fast: false,
      })),
    ],
  },
};

async function openHarness(
  browser,
  { inShadow = false, viewport = { width: 900, height: 700 } } = {},
) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          :root {
            --paper: #ffffff;
            --ink: #0d0d0d;
            --muted: #5d5d5d;
            --hover: #f5f5f5;
            --line: #e5e5e5;
            --accent: #0d0d0d;
          }
          :root[data-theme='dark'] {
            --paper: #212121;
            --ink: #f3f3f3;
            --muted: #b4b4b4;
            --hover: #2f2f2f;
            --line: #383838;
            --accent: #f3f3f3;
          }
          body { margin: 0; padding: 24px; background: var(--paper); color: var(--ink); min-height: 2200px; font: 14px/1.5 -apple-system, sans-serif; }
          button { color: inherit; border: 0; background: none; padding: 0; cursor: pointer; font: inherit; }
          .layout { display: grid; grid-template-columns: 200px 1fr; gap: 16px; }
          #sibling { height: 220px; overflow: auto; border: 1px solid var(--line); }
          #sibling-inner { height: 600px; }
          #outside { margin-bottom: 12px; padding: 6px 10px; border: 1px solid var(--line); }
          ${inShadow ? '' : modelCss}
        </style>
      </head>
      <body>
        <button id="outside" type="button">Outside</button>
        <div class="layout">
          <div id="sibling"><div id="sibling-inner">Sibling scroll</div></div>
          <div id="host"></div>
        </div>
      </body>
    </html>`);
  await page.evaluate((css) => {
    window.MODEL_CSS = css;
  }, modelCss);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(({ initial, inShadow }) => window.mountHarness({ initial, inShadow }), {
    initial: baseState,
    inShadow,
  });
  await page.locator('.model-fast').waitFor();
  return { page, errors };
}

let browser;
test.before(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
});
test.after(async () => {
  await browser?.close();
});

test('speed menu distinguishes disabled tiers in light and dark themes and handles keyboard/focus', async () => {
  for (const inShadow of [false, true]) {
    const { page, errors } = await openHarness(browser, { inShadow });
    try {
      const bolt = page.locator('.model-fast');
      const menu = page.locator('.model-speed-menu');
      for (const theme of ['light', 'dark']) {
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, theme);
        await bolt.focus();
        await page.keyboard.press('ArrowDown');
        await page.waitForFunction(() => {
          const root = document.getElementById('host')?.shadowRoot ?? document;
          return root.querySelector('.model-speed-menu')?.matches(':popover-open');
        });
        const styles = await menu.locator('button').evaluateAll((nodes) =>
          nodes.map((node) => {
            const s = getComputedStyle(node);
            return {
              text: node.textContent.trim(),
              disabled: node.disabled,
              color: s.color,
              opacity: Number(s.opacity),
              cursor: s.cursor,
            };
          }),
        );
        const standard = styles.find((item) => item.text === '标准');
        const fast = styles.find((item) => item.text === '快速');
        const ultra = styles.find((item) => item.text === '超快');
        assert.equal(standard.disabled, false);
        assert.equal(fast.disabled, false);
        assert.equal(ultra.disabled, true);
        assert.ok(ultra.opacity < 0.6, `${theme} (${inShadow}): disabled opacity`);
        assert.notEqual(
          ultra.color,
          standard.color,
          `${theme} (${inShadow}): muted semantic color`,
        );
        assert.equal(ultra.cursor, 'not-allowed', `${theme} (${inShadow}): disabled cursor`);

        // Clicking disabled option does not select or close.
        await menu.getByRole('menuitemradio', { name: '超快' }).click({ force: true });
        assert.equal(await page.evaluate(() => window.lastApplied), null);
        assert.equal(
          await menu.evaluate((el) => el.matches(':popover-open')),
          true,
          'disabled click keeps menu open',
        );

        // ArrowDown skips disabled Ultra Fast and wraps back to Standard; Escape closes and returns focus.
        await page.keyboard.press('ArrowDown');
        assert.equal(
          await menu.evaluate((el) => {
            let active = document.activeElement;
            while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
            return active?.textContent?.trim();
          }),
          '快速',
        );
        await page.keyboard.press('ArrowDown');
        assert.equal(
          await menu.evaluate((el) => {
            let active = document.activeElement;
            while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
            return active?.textContent?.trim();
          }),
          '标准',
        );
        await page.keyboard.press('Escape');
        assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), false);
        assert.equal(
          await bolt.evaluate((el) => {
            let active = document.activeElement;
            while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
            return active === el;
          }),
          true,
          'Escape restores focus to the lightning button',
        );
      }

      // Switch to Ultra Fast capable model, select Ultra Fast via keyboard, and verify outside click does not steal focus.
      await page.evaluate(() => window.harness.setModel('m-ultra', 'standard'));
      await page.locator('.model-fast[aria-label="速度 · 标准"]').waitFor();
      await bolt.focus();
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(() => {
        const root = document.getElementById('host')?.shadowRoot ?? document;
        return root.querySelector('.model-speed-menu')?.matches(':popover-open');
      });
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.lastApplied?.speed === 'ultrafast');
      assert.equal(await page.evaluate(() => window.lastApplied?.speed), 'ultrafast');
      assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), false);
      assert.equal(
        await bolt.evaluate((el) => {
          let active = document.activeElement;
          while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
          return active === el;
        }),
        true,
      );

      await bolt.click({ button: 'right' });
      assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
      await page.locator('#outside').click();
      assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), false);
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        'outside',
        'outside click keeps focus on the clicked target',
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});

test('speed menu closes on page/ancestor scroll without blocking scroll, and stays open on internal or sibling scroll', async () => {
  for (const inShadow of [false, true]) {
    const { page, errors } = await openHarness(browser, { inShadow });
    try {
      const bolt = page.locator('.model-fast');
      const menu = page.locator('.model-speed-menu');
      const favorites = page.locator('.model-favorites');

      // 1. Sibling scroll does not close the menu.
      await bolt.click({ button: 'right' });
      assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
      await page.locator('#sibling').evaluate((el) => {
        el.scrollTop = 120;
      });
      await page.waitForTimeout(80);
      assert.equal(
        await menu.evaluate((el) => el.matches(':popover-open')),
        true,
        'unrelated sibling scroll preserves the menu',
      );

      // 2. Internal menu scroll (when viewport is very short) does not close the menu.
      await page.setViewportSize({ width: 900, height: 72 });
      await bolt.click({ button: 'right' });
      const scrollable = await menu.evaluate((el) => {
        const open = el.matches(':popover-open');
        const canScroll = el.scrollHeight > el.clientHeight;
        el.scrollTop = 20;
        return { open, canScroll, scrollTop: el.scrollTop };
      });
      await page.waitForTimeout(80);
      assert.equal(scrollable.open, true);
      assert.equal(scrollable.canScroll, true);
      assert.equal(
        await menu.evaluate((el) => el.matches(':popover-open')),
        true,
        'scrolling inside the menu itself must not close it',
      );

      // 3. Ancestor (.model-favorites) scroll closes the menu without stealing focus.
      await page.setViewportSize({ width: 900, height: 700 });
      await bolt.click({ button: 'right' });
      assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
      await favorites.evaluate((el) => {
        el.scrollTop = 40;
      });
      await page.waitForFunction(() => {
        const root = document.getElementById('host')?.shadowRoot ?? document;
        return !root.querySelector('.model-speed-menu')?.matches(':popover-open');
      });
      assert.equal(await favorites.evaluate((el) => el.scrollTop > 0), true);

      // 4. Page scroll closes the menu and does not prevent scrolling.
      await favorites.evaluate((el) => {
        el.scrollTop = 0;
      });
      await bolt.click({ button: 'right' });
      assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
      await page.evaluate(() => window.scrollBy(0, 240));
      await page.waitForFunction(() => {
        const root = document.getElementById('host')?.shadowRoot ?? document;
        return !root.querySelector('.model-speed-menu')?.matches(':popover-open');
      });
      assert.ok((await page.evaluate(() => window.scrollY)) >= 200, 'page scroll stays functional');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});

test('speed menu closes cleanly on inert, hidden, active=false, catalog switch and unmount without trapping Escape', async () => {
  const { page, errors } = await openHarness(browser, { inShadow: false });
  try {
    const bolt = page.locator('.model-fast');
    const menu = page.locator('.model-speed-menu');
    await page.evaluate(() => {
      window.documentEscapes = 0;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.documentEscapes += 1;
      });
    });

    // 1. Ancestor becomes inert (website tab deactivation).
    await bolt.click({ button: 'right' });
    assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
    await page.evaluate(() => window.harness.setInert(true));
    await page.waitForFunction(
      () => !document.querySelector('.model-speed-menu')?.matches(':popover-open'),
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await page.evaluate(() => window.documentEscapes),
      1,
      'Escape reaches the document once menu closed on inert',
    );
    await page.evaluate(() => window.harness.setInert(false));

    // 2. Ancestor becomes hidden (settings tab switch).
    await bolt.click({ button: 'right' });
    assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
    await page.evaluate(() => window.harness.setHidden(true));
    await page.waitForFunction(
      () => !document.querySelector('.model-speed-menu')?.matches(':popover-open'),
    );
    await page.evaluate(() => window.harness.setHidden(false));

    // 3. Explicit active=false prop.
    await bolt.click({ button: 'right' });
    assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
    await page.evaluate(() => window.harness.setActive(false));
    await page.waitForFunction(
      () => !document.querySelector('.model-speed-menu')?.matches(':popover-open'),
    );
    await page.evaluate(() => window.harness.setActive(true));

    // 4. Opening the All Models catalog closes the speed menu.
    await bolt.click({ button: 'right' });
    assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
    await page.getByRole('button', { name: '所有模型', exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('.model-speed-menu')?.matches(':popover-open'),
    );
    await page.getByRole('button', { name: '关闭所有模型', exact: true }).click();

    // 5. Unmounting cleanly removes an open menu without errors.
    await bolt.click({ button: 'right' });
    assert.equal(await menu.evaluate((el) => el.matches(':popover-open')), true);
    await page.evaluate(() => window.harness.setMounted(false));
    await menu.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.model-speed-menu').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
