/*
 * [INPUT]: 工作台真实浏览器夹具与合成回答。
 * [OUTPUT]: 宿主角色兼容、混合标题、不均匀段落与同名前缀、去重、重挂载定位与过期拒绝回归。
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

async function checkTargets(page, result) {
  for (const item of result) {
    await page.locator(`[data-view-body="outline"] [data-outline-id="${item.id}"]`).click();
    await page.waitForFunction(({ id, target }) => {
      const element = document.querySelector(
        `#answer [data-companion-stepwise-outline-id="${id}"]`,
      );
      const viewport = document.querySelector('.thread-scroll-container').getBoundingClientRect();
      const rect = element?.getBoundingClientRect();
      return (
        element?.getAttribute('data-outline-fixture') === target &&
        element.classList.contains('companion-stepwise-outline-target-flash') &&
        rect.top >= viewport.top &&
        rect.top < viewport.bottom
      );
    }, item);
  }
}

export function outlineCases({ mode }) {
  return [
    [
      '大纲：新版角色属性和隐藏打印标签、旧版中英文标签均识别回答',
      async (page) => {
        await mode(page, true);
        const variants = [
          { attribute: true, user: '未知本地化名称', assistant: '未知本地化名称', hidden: true },
          { attribute: false, user: '你说：', assistant: 'ChatGPT 说：', hidden: true },
          { attribute: false, user: 'You said:', assistant: 'Codex said:', hidden: true },
          { attribute: false, user: '你说：', assistant: 'ChatGPT 说：', hidden: false },
          { attribute: false, user: 'You said:', assistant: 'Assistant:', hidden: false },
        ];
        for (const [index, variant] of variants.entries()) {
          await page.evaluate(
            ({ index, variant }) => {
              const turn = document.querySelector('[data-content-search-turn-key]');
              turn.setAttribute('data-content-search-turn-key', `turn-label-${index}`);
              for (const role of ['user', 'assistant']) {
                const label = turn.querySelector(`[data-message-author-role="${role}"] h4.sr-only`);
                if (variant.attribute) label.setAttribute('data-conversation-role', role);
                else label.removeAttribute('data-conversation-role');
                label.replaceChildren(document.createTextNode(variant[role]));
                if (variant.hidden) {
                  const hidden = document.createElement('span');
                  hidden.className = 'hidden print:inline';
                  hidden.setAttribute('aria-hidden', 'true');
                  hidden.textContent = role === 'user' ? 'You' : 'ChatGPT';
                  label.append(hidden);
                }
              }
            },
            { index, variant },
          );
          await setAnswer(page, `<h2 data-outline-fixture="0">原文标题</h2>${paragraphs(3)}`);
          assert.equal((await items(page)).length, 1);
          assert.equal(
            await page.evaluate(() => {
              const state = window.__companionFloatingPanel.state;
              return !!state.latestTurnAnchor?.userText && !!state.latestTurnAnchor?.assistantText;
            }),
            true,
          );
          await checkTargets(page, await items(page));
        }
        // 明确的未知角色不能被旧标签文字误认成 assistant。
        await page.evaluate(() => {
          const turn = document.querySelector('[data-content-search-turn-key]');
          turn.setAttribute('data-content-search-turn-key', 'turn-label-z');
          turn
            .querySelector('[data-message-author-role="assistant"] h4')
            .setAttribute('data-conversation-role', 'tool');
          window.__companionFloatingPanel.scan();
        });
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.scanStatus === 'no-assistant-message',
        );
        assert.deepEqual(await items(page), []);
      },
    ],
    [
      '大纲：长度不均的自然段保留导航与实际定位',
      async (page) => {
        await mode(page, true);
        for (const lengths of [
          [400, 800],
          [800, 400],
          [600, 600],
          [120, 1080],
        ]) {
          await setAnswer(
            page,
            lengths
              .map(
                (length, index) =>
                  `<p data-outline-fixture="${index}">${String.fromCharCode(0x7532 + index).repeat(length - 1)}。</p>`,
              )
              .join(''),
          );
          const result = await items(page);
          assert.deepEqual(
            result.map((item) => item.target),
            ['0', '1'],
          );
          await checkTargets(page, result);
        }
      },
    ],
    [
      '大纲：相同首句及截断前缀保留不同正文，标签唯一且定位各自段落',
      async (page) => {
        await mode(page, true);
        for (const prefix of ['这一部分需要单独检查。', '共同的长前缀'.repeat(16)]) {
          await setAnswer(
            page,
            Array.from(
              { length: 6 },
              (_, index) =>
                `<p data-outline-fixture="${index}">${prefix}${String.fromCharCode(0x7532 + index).repeat(700)}</p>`,
            ).join(''),
          );
          const result = await items(page);
          assert.equal(result.length, 6);
          assert.equal(new Set(result.map((item) => item.text)).size, 6);
          assert.ok(result.every((item) => Array.from(item.text).length <= 56));
          await checkTargets(page, result);
        }
      },
    ],
    [
      '大纲：正式标题与编号加粗小标题合并，嵌套加粗不重复',
      async (page) => {
        await mode(page, true);
        const section = (index) =>
          `<p data-outline-fixture="${index}"><strong>${index}. 检查第 ${index} 项</strong></p><p>${body}</p>`;
        await setAnswer(
          page,
          `<h2 data-outline-fixture="0"><strong>整体接入方案</strong></h2>${[1, 2, 3].map(section).join('')}`,
        );
        let result = await items(page);
        assert.deepEqual(
          result.map((item) => item.target),
          ['0', '1', '2', '3'],
        );
        assert.deepEqual(
          result.map((item) => item.kind),
          ['semantic', 'pseudo', 'pseudo', 'pseudo'],
        );
        await checkTargets(page, result);
        await setAnswer(
          page,
          `<h2 data-outline-fixture="0">整体接入方案</h2>${section(1)}<h2 data-outline-fixture="2">验证与交付</h2>${section(3)}`,
        );
        result = await items(page);
        assert.deepEqual(
          result.map((item) => item.target),
          ['0', '1', '2', '3'],
        );
        await checkTargets(page, result);
      },
    ],
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
