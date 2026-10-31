/*
 * [INPUT]: 工作台真实浏览器夹具与合成回答。
 * [OUTPUT]: 原文标题优先、本地段落导航、去重、重挂载定位与过期拒绝回归。
 * [POS]: 由 workbench.mjs 执行；不读取真实聊天，不调用模型或外部服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';

const body = '这里使用合成材料说明当前段落，保留自然段边界与完整的原文定位。'.repeat(9);
const paragraphs = (count = 12, english = false) =>
  Array.from({ length: count }, (_, index) => {
    const label = english ? `Reading point ${index + 1}.` : `这是第 ${index + 1} 个阅读位置。`;
    const detail = english
      ? 'This synthetic paragraph explains the current example without contacting any service. '.repeat(
          6,
        )
      : body;
    return `<div><p data-outline-fixture="${index}" style="min-height:180px"><strong>${label}</strong> ${detail}</p></div>`;
  }).join('');

async function setAnswer(page, html) {
  await page.evaluate((html) => {
    document.querySelector('#answer').innerHTML = html;
    window.__companionFloatingPanel.scan();
  }, html);
  await page.waitForFunction(() => {
    const state = window.__companionFloatingPanel.state;
    return (
      state.outlineSourceHash === state.lastAssistantHash &&
      ['ready', 'empty'].includes(state.outlineStatus)
    );
  });
}

const items = (page) =>
  page.evaluate(() =>
    window.__companionFloatingPanel.state.outlineItems.map((item) => ({
      id: item.id,
      text: item.text,
      kind: item.kind,
      target: item.el.getAttribute('data-outline-fixture'),
    })),
  );

export function outlineCases({ mode }) {
  return [
    [
      '大纲：无标题中英文长回答只补少量段落，点击与键盘准确定位',
      async (page) => {
        await mode(page, true);
        for (const english of [false, true]) {
          await setAnswer(page, paragraphs(18, english));
          const result = await items(page);
          assert.ok(result.length >= 2 && result.length <= 6);
          assert.ok(result.every((item) => item.kind === 'paragraph'));
          assert.equal(new Set(result.map((item) => item.text)).size, result.length);
          assert.equal(new Set(result.map((item) => item.target)).size, result.length);
          assert.equal(result[0].target, '0');
          const chosen = result.at(-1);
          const row = page.locator(`[data-view-body="outline"] [data-outline-id="${chosen.id}"]`);
          if (english) await row.press('Enter');
          else await row.click();
          assert.equal(
            await page
              .locator('#answer .companion-stepwise-outline-target-flash')
              .getAttribute('data-outline-fixture'),
            chosen.target,
          );
          await page.waitForFunction((target) => {
            const element = document.querySelector(`#answer [data-outline-fixture="${target}"]`);
            const viewport = document
              .querySelector('.thread-scroll-container')
              .getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            return rect.top >= viewport.top && rect.top < viewport.bottom;
          }, chosen.target);
        }
      },
    ],
    [
      '大纲：原文标题包括短标题与单标题优先，不混入段落入口',
      async (page) => {
        await setAnswer(page, `<h2>成本</h2>${paragraphs(5)}<h3>细节</h3>${paragraphs(4, true)}`);
        assert.deepEqual(
          (await items(page)).map(({ text, kind }) => [text, kind]),
          [
            ['成本', 'semantic'],
            ['细节', 'semantic'],
          ],
        );
        await setAnswer(page, `<h2>原文唯一标题</h2>${paragraphs()}`);
        assert.deepEqual(
          (await items(page)).map((item) => item.text),
          ['原文唯一标题'],
        );
      },
    ],
    [
      '大纲：列表表格与短引导句同组，重复段落与代码不产生重复入口',
      async (page) => {
        const section = (index) => `<div>
          <p data-outline-fixture="${index}">这里列出第 ${index} 组材料：</p>
          <ul><li><p>${body}</p></li><li><p>${body}</p></li></ul>
          <table><tbody><tr><td><p>${body}</p></td></tr></tbody></table>
          <pre><code>${'const synthetic = 1;\n'.repeat(10)}</code></pre>
        </div>`;
        await setAnswer(page, [0, 1, 1, 2, 3, 4, 5].map(section).join(''));
        const result = await items(page);
        assert.ok(result.length >= 2 && result.length <= 6);
        assert.ok(result.every((item) => item.target !== null && item.text.startsWith('这里列出')));
        assert.equal(new Set(result.map((item) => item.text)).size, result.length);
        assert.equal(
          await page
            .locator(
              '#answer li [data-companion-stepwise-outline-id], #answer td [data-companion-stepwise-outline-id]',
            )
            .count(),
          0,
        );
      },
    ],
    [
      '大纲：短回答与代码空态不强行补导航',
      async (page) => {
        await setAnswer(page, '<p>第一段是简短的确认。</p><p>第二段补充一个小细节。</p>');
        assert.deepEqual(await items(page), []);
        await setAnswer(page, `<pre><code>${'const synthetic = 1;\n'.repeat(80)}</code></pre>`);
        assert.deepEqual(await items(page), []);
        await setAnswer(
          page,
          `<h2 hidden>隐藏标题</h2><p>单独一个自然段没有可供分组的边界。${body.repeat(3)}</p>`,
        );
        assert.deepEqual(await items(page), []);
      },
    ],
    [
      '大纲：段落重挂载保持定位，原文变化或同文换聊天拒绝旧点击',
      async (page) => {
        await setAnswer(page, paragraphs());
        const rebuilt = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          const source = panel.exportPanelState();
          const item = panel.state.outlineItems.at(-1);
          const target = item.el.getAttribute('data-outline-fixture');
          const answer = document.querySelector('#answer');
          answer.innerHTML = answer.innerHTML;
          const reply = panel.panelCommand({ ...source, kind: 'outline-jump', id: item.id });
          return {
            ok: reply.ok,
            target,
            actual: answer
              .querySelector('.companion-stepwise-outline-target-flash')
              ?.getAttribute('data-outline-fixture'),
          };
        });
        assert.equal(rebuilt.ok, true);
        assert.equal(rebuilt.actual, rebuilt.target);
        const staleText = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          const source = panel.exportPanelState();
          const item = panel.state.outlineItems.at(-1);
          // 标签开头不变，只改末尾；必须在下一次扫描前拒绝旧定位。
          item.el.append(document.createTextNode(' 此段末尾已有新内容。'));
          return panel.panelCommand({ ...source, kind: 'outline-jump', id: item.id });
        });
        assert.equal(staleText.ok, false);
        await setAnswer(page, paragraphs(14));
        const staleChat = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          const source = panel.exportPanelState();
          const item = panel.state.outlineItems[0];
          document.querySelector('.thread-scroll-container').dataset.sessionId =
            'another-outline-chat';
          document
            .querySelector('[data-response-annotation-conversation]')
            .setAttribute('data-response-annotation-conversation', 'another-outline-chat');
          return panel.panelCommand({ ...source, kind: 'outline-jump', id: item.id });
        });
        assert.equal(staleChat.ok, false);
      },
    ],
    [
      '大纲：相同正文的新轮次拒绝旧点击并恢复新目录',
      async (page) => {
        await setAnswer(page, paragraphs());
        const reply = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          const source = panel.exportPanelState();
          const item = panel.state.outlineItems[0];
          document
            .querySelector('[data-content-search-turn-key]')
            .setAttribute('data-content-search-turn-key', 'turn-0002');
          return panel.panelCommand({ ...source, kind: 'outline-jump', id: item.id });
        });
        assert.equal(reply.ok, false);
        await page.evaluate(() => window.__companionFloatingPanel.scan());
        await page.waitForFunction(() => {
          const state = window.__companionFloatingPanel.state;
          return (
            state.outlineStatus === 'ready' &&
            state.outlineContext?.assistantMessageId === state.activeContext.assistantMessageId
          );
        });
        const current = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          return panel.panelCommand({
            ...panel.exportPanelState(),
            kind: 'outline-jump',
            id: panel.state.outlineItems[0].id,
          });
        });
        assert.equal(current.ok, true);
      },
    ],
  ];
}
