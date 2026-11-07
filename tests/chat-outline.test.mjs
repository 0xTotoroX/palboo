/* [INPUT]: Standalone Chat bundle, synthetic current Chat DOM and isolated Chromium.
 * [OUTPUT]: Chat reply-row placement, history, virtualization, identity, lease and cleanup regressions.
 * [POS]: Ordinary Chat behavior tests; no real conversations, model calls or composer writes.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { buildChatOutline } from '../scripts/build-panel.mjs';

let browser, script;
const reply = (key, prefix) => `<div data-content-search-turn-key="${key}">
<div class="group flex flex-col"><div class="shared-messages"><div class="user"><div class="block"><h4 class="sr-only" data-conversation-role="user">You said</h4><p>Question ${prefix}</p></div><div class="turn-action-controls"><button aria-label="Edit">Edit</button></div></div>
<div class="answer block"><div data-content-search-unit-key="unit-${key}"><h4 class="sr-only" data-conversation-role="assistant">ChatGPT said</h4><div class="markdownContent-fixture">${Array.from({ length: 24 }, (_, i) => `<h2>${prefix} section ${i + 1}</h2><p>${'Synthetic response paragraph. '.repeat(12)}</p>`).join('')}</div></div></div></div>
<div class="turn-action-controls"><div class="native-actions">${['Copy', 'Rate this response', 'Read aloud', 'More actions'].map((label) => `<button class="native-button" aria-label="${label}"><svg class="native-icon"></svg></button>`).join('')}</div></div></div></div>`;
const fixture = `<!doctype html><html lang="en"><head><style>
:root { --bg-primary:#fff;--text-primary:#222;--text-secondary:#777; }
body{margin:0;color:var(--text-primary);font:16px system-ui;background:var(--bg-primary)}
.thread-scroll-container{height:650px;overflow:auto;padding:30px 360px 30px 36px}
h2{margin:24px 0 8px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}
.native-actions{display:flex;gap:2px;align-items:center}.native-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;background:transparent;color:inherit;border-radius:6px;padding:5px}.native-button:hover{background:#8883}.native-icon{width:18px;height:18px}.ProseMirror{height:60px}
</style></head><body><main><div class="thread-scroll-container">${reply('z-old', 'Historical')}${reply('a-latest', 'Latest')}</div><form><div class="ProseMirror" contenteditable="true">Existing draft</div><button type="button" aria-label="Send">Send</button></form></main></body></html>`;
before(async () => {
  script = await buildChatOutline();
  browser = await chromium.launch({
    executablePath: process.env.PALBOO_CHROME_BIN || process.env.CHROME_PATH || undefined,
    headless: true,
  });
});
after(async () => browser?.close());
async function setup(t, language = 'en') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://chatgpt.com/c/synthetic');
  await page.evaluate(() => {
    window.sends = 0;
    document.querySelector('[aria-label="Send"]').onclick = () => window.sends++;
    document.querySelector('.thread-scroll-container').scrollTop = 1e6;
  });
  await page.clock.install();
  await page.evaluate(script);
  await page.evaluate(
    (language) => window.__palbooChatOutline.update({ enabled: true, language }),
    language,
  );
  await page.locator('[data-palboo-outline-reply="a-latest"]').waitFor();
  t.after(async () => {
    if (!page.isClosed()) {
      try {
        assert.equal(await page.locator('.ProseMirror').textContent(), 'Existing draft');
        assert.equal(await page.evaluate(() => window.sends || 0), 0);
      } finally {
        await page.close();
      }
    }
  });
  return page;
}
const surface = '[data-palboo-chat-outline]';
const items = `${surface} [data-outline-id]`;
async function openLatest(page) {
  await page.locator('[data-palboo-outline-reply="a-latest"]').click();
  await page.waitForFunction(() => window.__palbooChatOutline.status().items === 24);
}

test('Chat uses the native copy/read row, bilingual labels, theme, keyboard, and no composer actions', async (t) => {
  const page = await setup(t);
  const button = page.locator('[data-palboo-outline-reply="a-latest"]');
  assert.equal(await button.getAttribute('aria-label'), 'View outline for this reply');
  const geometry = await button.evaluate((button) => {
    const native = button.parentElement.querySelector('[aria-label="Copy"]');
    const a = button.getBoundingClientRect(),
      b = native.getBoundingClientRect(),
      icon = button.querySelector('svg').getBoundingClientRect();
    return {
      same: native.parentElement === button.parentElement,
      dy: a.y - b.y,
      width: a.width,
      height: a.height,
      icon: icon.width,
      classMatch: button.className === native.className,
    };
  });
  assert.deepEqual(geometry, {
    same: true,
    dy: 0,
    width: 28,
    height: 28,
    icon: 18,
    classMatch: true,
  });
  assert.equal(await page.locator('form [data-palboo-outline-reply]').count(), 0);
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__palbooChatOutline.status().items === 24);
  assert.equal(await page.locator(`${surface} [data-outline-latest]`).count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(surface).isVisible(), false);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--bg-primary', '#222');
    document.documentElement.style.setProperty('--text-primary', '#eee');
    window.__palbooChatOutline.update({ enabled: true, language: 'zh-CN' });
  });
  await page.waitForFunction(
    () => document.querySelector('[data-palboo-outline-reply]')?.title === '查看此回复的大纲',
  );
  await openLatest(page);
  assert.equal(
    await page
      .locator(`${surface} .feature-view`)
      .evaluate((n) => getComputedStyle(n).backgroundColor),
    'rgb(34, 34, 34)',
  );
  await page.setViewportSize({ width: 400, height: 300 });
  const box = await page.locator(surface).boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 400 && box.y + box.height <= 300);
});

for (const historical of [false, true])
  test(`Chat ${historical ? 'historical' : 'latest'} outline survives unmount/remount without replacing rows or reading position`, async (t) => {
    const page = await setup(t);
    await openLatest(page);
    if (historical) {
      await page.evaluate(() => {
        const turn = document.querySelector('[data-content-search-turn-key="z-old"]');
        turn.scrollIntoView({ block: 'end' });
      });
      await page.locator('[data-palboo-outline-reply="z-old"]').click();
      await page.waitForFunction(() => window.__palbooChatOutline.status().historical);
    }
    await page.waitForFunction(() => window.__palbooChatOutline.status().items === 24);
    await page.evaluate(
      (key) => {
        const root = document.querySelector('[data-palboo-chat-outline]').shadowRoot;
        window.savedRow = root.querySelector('[data-outline-id]');
        const body = root.querySelector('.feature-body');
        body.scrollTop = 120;
        window.savedScroll = body.scrollTop;
        window.savedTurn = document.querySelector(`[data-content-search-turn-key="${key}"]`);
        window.savedNext = window.savedTurn.nextSibling;
        window.savedTurn.remove();
      },
      historical ? 'z-old' : 'a-latest',
    );
    await page.waitForFunction(() => window.__palbooChatOutline.status().status === 'unavailable');
    assert.equal(await page.locator(items).count(), 24);
    assert.equal(
      await page.evaluate(() => {
        const root = document.querySelector('[data-palboo-chat-outline]').shadowRoot;
        return (
          root.querySelector('[data-outline-id]') === window.savedRow &&
          root.querySelector('.feature-body').scrollTop === window.savedScroll
        );
      }),
      true,
    );
    assert.equal(await page.locator(items).first().isDisabled(), true);
    await page.evaluate(() =>
      document
        .querySelector('.thread-scroll-container')
        .insertBefore(window.savedTurn, window.savedNext),
    );
    await page.waitForFunction(() => window.__palbooChatOutline.status().status === 'ready');
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector('[data-palboo-chat-outline]')
            .shadowRoot.querySelector('[data-outline-id]') === window.savedRow,
      ),
      true,
    );
    await page.locator(items).nth(3).click();
    await page.waitForTimeout(850);
    const jump = await page.evaluate(() => ({
      top: document
        .querySelector('.companion-stepwise-outline-target-flash')
        ?.getBoundingClientRect().top,
      status: window.__palbooChatOutline.status(),
    }));
    assert.ok(jump.top < 110, JSON.stringify(jump));
    if (historical) {
      await page.locator(`${surface} [data-outline-latest]`).click();
      await page.waitForFunction(() => !window.__palbooChatOutline.status().historical);
    }
  });

test('Chat rejects stale navigation after answer edits or route changes; duplicates never get controls', async (t) => {
  const page = await setup(t);
  await openLatest(page);
  const unchanged = await page.evaluate(() => {
    const row = document
      .querySelector('[data-palboo-chat-outline]')
      .shadowRoot.querySelector('[data-outline-id]');
    const root = document.querySelector('.thread-scroll-container');
    const before = root.scrollTop;
    document.querySelector('[data-content-search-turn-key="a-latest"] h2').textContent =
      'Changed heading';
    row.click();
    return root.scrollTop === before;
  });
  assert.equal(unchanged, true);
  await page.waitForFunction(() =>
    document
      .querySelector('[data-palboo-chat-outline]')
      .shadowRoot.querySelector('[data-outline-id]')
      ?.textContent.includes('Changed heading'),
  );
  await page.evaluate(() => {
    history.pushState({}, '', '/c/different');
    document.querySelector('.thread-scroll-container').replaceChildren();
  });
  await page.waitForFunction(() => window.__palbooChatOutline.status().items === 0);
  await page.evaluate(
    (html) => {
      document.querySelector('.thread-scroll-container').innerHTML = html + html;
    },
    reply('duplicate', 'Ambiguous'),
  );
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-palboo-outline-reply]').count(), 0);
});

test('Chat retains completed reply buttons during streaming and waits for the newest reply', async (t) => {
  const page = await setup(t);
  await page.evaluate(() => {
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Stop streaming');
    document.querySelector('form').append(stop);
  });
  await page.waitForFunction(
    () => !document.querySelector('[data-palboo-outline-reply="a-latest"]'),
  );
  await page.evaluate(() =>
    document
      .querySelector('[data-content-search-turn-key="z-old"]')
      .scrollIntoView({ block: 'end' }),
  );
  await page.locator('[data-palboo-outline-reply="z-old"]').click();
  await page.waitForFunction(
    () =>
      window.__palbooChatOutline.status().historical &&
      window.__palbooChatOutline.status().items === 24,
  );
  await page.evaluate(() => {
    document.querySelector('[aria-label="Stop streaming"]').remove();
    document.querySelector('.thread-scroll-container').scrollTop = 1e6;
  });
  await page.locator('[data-palboo-outline-reply="a-latest"]').waitFor();
});

test('Chat hot reload, disable, lease expiry and foreign origins clean up without a Work runtime', async (t) => {
  const page = await setup(t);
  await openLatest(page);
  await page.evaluate(script);
  await page.evaluate(() => window.__palbooChatOutline.update({ enabled: true, language: 'en' }));
  await page.waitForFunction(() => window.__palbooChatOutline.status().items === 24);
  assert.equal(await page.locator(surface).count(), 1);
  assert.equal(
    await page.evaluate(() =>
      Boolean(window.__companionFloatingPanel || window.__companionHostRequest),
    ),
    false,
  );
  await page.evaluate(() => window.__palbooChatOutline.update({ enabled: false, language: 'en' }));
  assert.equal(await page.locator('[data-palboo-outline-reply]').count(), 0);
  assert.equal(await page.locator(surface).count(), 0);
  await page.evaluate(() => window.__palbooChatOutline.update({ enabled: true, language: 'en' }));
  await page.locator('[data-palboo-outline-reply="a-latest"]').waitFor();
  await page.clock.fastForward(10001);
  assert.equal(await page.evaluate(() => Boolean(window.__palbooChatOutline)), false);
  assert.equal(await page.locator('[data-palboo-outline-reply]').count(), 0);
  await page.goto('https://example.test/c/synthetic');
  await page.evaluate(script);
  assert.equal(await page.evaluate(() => Boolean(window.__palbooChatOutline)), false);
});

test('Chat rejects old row identities for an identical new answer and respects reduced motion', async (t) => {
  const page = await setup(t);
  await openLatest(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const root = document.querySelector('[data-palboo-chat-outline]').shadowRoot;
    window.oldItem = root.querySelector('[data-outline-id]');
    const turn = document.querySelector('[data-content-search-turn-key="a-latest"]');
    turn.setAttribute('data-content-search-turn-key', 'new-answer-same-text');
    window.oldItem.click();
    window.scrollOptions = [];
    const scroller = document.querySelector('.thread-scroll-container');
    const original = scroller.scrollTo.bind(scroller);
    scroller.scrollTo = (options) => {
      window.scrollOptions.push(options.behavior);
      original(options);
    };
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-palboo-chat-outline]')
        .shadowRoot.querySelector('[data-outline-id]') !== window.oldItem,
  );
  await page.locator(items).first().click();
  assert.deepEqual(await page.evaluate(() => window.scrollOptions), ['auto']);
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.companion-stepwise-outline-target-flash'))
          .outlineWidth,
    ),
    '2px',
  );
});

test('Chat queued document installs are replaced and cancellation prevents late controls', async (t) => {
  const page = await setup(t);
  await page.evaluate(() => {
    window.__palbooChatOutline.destroy();
    Object.defineProperty(document, 'readyState', { get: () => 'loading', configurable: true });
  });
  await page.evaluate(script);
  await page.evaluate(script);
  await page.evaluate(() => {
    window.__palbooChatOutlinePending();
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });
  assert.equal(await page.evaluate(() => Boolean(window.__palbooChatOutline)), false);
  await page.evaluate(script);
  await page.evaluate(script);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'));
    window.__palbooChatOutline.update({ enabled: true, language: 'en' });
  });
  await page.locator('[data-palboo-outline-reply="a-latest"]').waitFor();
  assert.equal(await page.locator('[data-palboo-outline-reply="a-latest"]').count(), 1);
  assert.equal(await page.evaluate(() => Boolean(window.__palbooChatOutlinePending)), false);
});
