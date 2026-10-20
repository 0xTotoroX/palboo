/* [INPUT]: Host browser adapter and synthetic visible navigation controls.
 * [OUTPUT]: Local settings enter the host address bar; no external window fallback.
 * [POS]: No real host, browser profile, settings token or network traffic.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const compiled = await build({
  stdin: {
    contents:
      "import {openSettingsBrowser} from './ui/codex/plugin-tab.js';window.openSettingsBrowser=openSettingsBrowser;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  define: { PALBOO_DEVELOPMENT: 'true' },
});
test('web settings use native browser address controls and return to split view', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<div class="app-shell-main-content-frame" data-conversation-id="fixture-A"><div class="thread-scroll-container">Chat</div></div><button id="show" aria-label="显示标签页">Show tabs</button><button id="new" aria-label="新标签页" hidden>New</button><div id="browser"></div>',
    );
    await page.evaluate(() => {
      document.querySelector('#show').onclick = () => {
        document.querySelector('#new').hidden = false;
        document.querySelector('#show').hidden = true;
      };
      window.externalCalls = 0;
      window.open = () => window.externalCalls++;
      document.querySelector('#new').onclick = () => {
        document.querySelector('#browser').innerHTML =
          '<input placeholder="搜索或输入网址"><button id="split" aria-label="进入分屏视图" aria-pressed="false">Split</button>';
        const input = document.querySelector('input');
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            window.submitted = input.value;
            input.blur();
          }
        };
        document.querySelector('#split').onclick = (e) =>
          e.currentTarget.setAttribute('aria-pressed', 'true');
      };
    });
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    assert.deepEqual(
      await page.evaluate(() =>
        window.openSettingsBrowser('http://127.0.0.1:12345/#token=fixture'),
      ),
      { status: 'submitted' },
    );
    assert.equal(
      await page.evaluate(() => window.submitted),
      'http://127.0.0.1:12345/#token=fixture',
    );
    assert.equal(await page.locator('#split').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.externalCalls), 0);
    await assert.rejects(page.evaluate(() => window.openSettingsBrowser('https://example.com')));
  } finally {
    await browser.close();
  }
});

async function syntheticBrowser(t, setup) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  t.after(() => browser.close());
  await page.setContent(
    '<div data-conversation-id="fixture-A"><div class="thread-scroll-container" style="width:300px;height:100px">Synthetic</div></div><button aria-label="新标签页" id="new">New</button><div id="panels"></div>',
  );
  await page.evaluate(() => {
    window.clicks = 0;
    window.submits = 0;
    window.createAddress = (id = 'new-panel') => {
      const panel = document.createElement('div');
      panel.setAttribute('data-tab-id', id);
      panel.innerHTML = '<input data-browser-sidebar-address-input placeholder="搜索或输入网址">';
      document.querySelector('#panels').append(panel);
      const input = panel.querySelector('input');
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.submits++;
          window.submitted = input.value;
          input.blur();
        }
      };
      return input;
    };
    document.querySelector('#new').onclick = () => {
      window.clicks++;
      window.createAddress();
    };
  });
  if (setup) await page.evaluate(setup);
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  return page;
}
test('a browser tab named New tab is not the create-tab button', async (t) => {
  const page = await syntheticBrowser(t, () => {
    const existing = document.createElement('button');
    existing.setAttribute('role', 'tab');
    existing.setAttribute('aria-label', '新标签页');
    existing.textContent = '新标签页';
    existing.onclick = () => window.clicks++;
    document.querySelector('#new').before(existing);
  });
  assert.deepEqual(
    await page.evaluate(() => window.openSettingsBrowser('http://127.0.0.1:12345/')),
    { status: 'submitted' },
  );
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.equal(await page.evaluate(() => window.submits), 1);
});
test('delayed new tab ignores the old address including replacement nodes', async (t) => {
  const page = await syntheticBrowser(t, () => {
    window.old = window.createAddress('old-panel');
    window.old.value = 'https://example.test/';
    document.querySelector('#new').onclick = () => {
      window.clicks++;
      setTimeout(() => {
        const old = document.querySelector('[data-tab-id="old-panel"] input');
        old.replaceWith(old.cloneNode());
      }, 10);
      setTimeout(() => window.createAddress(), 120);
    };
  });
  assert.deepEqual(
    await page.evaluate(() => window.openSettingsBrowser('http://127.0.0.1:12345/')),
    { status: 'submitted' },
  );
  assert.equal(
    await page.locator('[data-tab-id="old-panel"] input').inputValue(),
    'https://example.test/',
  );
  assert.equal(await page.evaluate(() => window.clicks), 1);
});
test('recreated New tab button is not clicked again while waiting for address', async (t) => {
  const page = await syntheticBrowser(t, () => {
    document.querySelector('#new').onclick = () => {
      window.clicks++;
      const replacement = document.querySelector('#new').cloneNode(true);
      replacement.onclick = () => window.clicks++;
      document.querySelector('#new').replaceWith(replacement);
    };
  });
  await page.clock.install();
  await page.evaluate(() => {
    window.pending = window
      .openSettingsBrowser('http://127.0.0.1:12345/')
      .catch((e) => ({ error: e.message }));
  });
  await page.clock.runFor(10001);
  assert.match((await page.evaluate(() => window.pending)).error, /未确认新浏览器标签/);
  assert.equal(await page.evaluate(() => window.clicks), 1);
});
test('ignored Enter does not report navigation success', async (t) => {
  const page = await syntheticBrowser(t, () => {
    document.querySelector('#new').onclick = () => {
      window.clicks++;
      window.createAddress().onkeydown = null;
    };
  });
  await assert.rejects(
    page.evaluate(() => window.openSettingsBrowser('http://127.0.0.1:12345/')),
    /未确认设置地址提交/,
  );
  assert.equal(await page.evaluate(() => window.submits), 0);
});
test('input replacement before Enter cancels without submitting to a stale node', async (t) => {
  const page = await syntheticBrowser(t, () => {
    document.querySelector('#new').onclick = () => {
      const input = window.createAddress();
      input.addEventListener('input', () => input.replaceWith(input.cloneNode()));
    };
  });
  await assert.rejects(
    page.evaluate(() => window.openSettingsBrowser('http://127.0.0.1:12345/')),
    /地址栏已变化/,
  );
  assert.equal(await page.evaluate(() => window.submits), 0);
});
test('runtime cancellation and generation invalidation stop before Enter', async (t) => {
  for (const abort of [true, false]) {
    const page = await syntheticBrowser(t, () => {
      window.current = true;
      document.querySelector('#new').onclick = () => {
        const input = window.createAddress();
        input.addEventListener('input', () => {
          window.current = false;
          window.controller?.abort();
        });
      };
    });
    await assert.rejects(
      page.evaluate((abort) => {
        window.controller = abort ? new AbortController() : null;
        return window.openSettingsBrowser('http://127.0.0.1:12345/', {
          signal: window.controller?.signal,
          isCurrent: () => window.current,
        });
      }, abort),
      /取消|aborted/,
    );
    assert.equal(await page.evaluate(() => window.submits), 0);
  }
});
test('missing chat identity restores split before resolving the source', async (t) => {
  const page = await syntheticBrowser(t, () => {
    document.querySelector('[data-conversation-id]').removeAttribute('data-conversation-id');
    const split = document.createElement('button');
    split.setAttribute('aria-label', '进入分屏视图');
    split.setAttribute('aria-pressed', 'false');
    split.textContent = 'Split';
    split.onclick = () => {
      document
        .querySelector('.thread-scroll-container')
        .parentElement.setAttribute('data-conversation-id', 'fixture-A');
      split.setAttribute('aria-pressed', 'true');
    };
    document.body.append(split);
  });
  assert.deepEqual(
    await page.evaluate(() => window.openSettingsBrowser('http://127.0.0.1:12345/')),
    { status: 'submitted' },
  );
});
