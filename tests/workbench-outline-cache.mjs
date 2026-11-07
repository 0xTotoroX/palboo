/*
 * [INPUT]: 工作台浏览器夹具、合成回复与大纲操作接口。
 * [OUTPUT]: 滚动虚拟卸载期间保留目录节点和阅读位置，恢复后重新核验导航，拒绝缺失或变化的原文。
 * [POS]: workbench-outline 的缓存回归；不读取真实聊天或调用模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';

export function outlineCacheCases({ mode, setAnswer }) {
  return [false, true].map((historical) => [
    `大纲：滚动卸载${historical ? '历史' : '最新'}回答时目录和阅读位置不闪失`,
    async (page) => {
      await mode(page, true);
      await setAnswer(
        page,
        Array.from(
          { length: 24 },
          (_, index) =>
            `<h2>第 ${index + 1} 部分的合成目录</h2><p style="min-height:180px">这里用完整的合成段落验证虚拟滚动和原文重挂载后的导航边界。</p>`,
        ).join(''),
      );
      if (historical) {
        await page.evaluate(() => {
          const turn = document.querySelector('[data-content-search-turn-key]');
          const newer = turn.cloneNode(true);
          newer.setAttribute('data-content-search-turn-key', 'turn-0002');
          const answer = newer.querySelector('#answer');
          answer.id = 'newer-answer';
          answer.innerHTML = '<h2>新回答的正式标题</h2><p>另一条合成回答，不接管历史目录。</p>';
          turn.after(newer);
          window.__companionFloatingPanel.scan();
        });
        await page
          .locator('[data-view-body="outline"]')
          .getByRole('button', { name: '新回答的正式标题' })
          .waitFor();
        await page.locator('[data-palboo-outline-reply="turn-0001"]').click();
      }
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.outlineItems.length > 10,
      );
      const before = await page.evaluate(() => {
        const panel = window.__companionFloatingPanel;
        const body = document.querySelector('[data-view-body="outline"]');
        body.scrollTop = 120;
        const turn = document.querySelector('[data-content-search-turn-key="turn-0001"]');
        const next = turn.nextElementSibling;
        const parent = turn.parentElement;
        const rows = [...body.querySelectorAll('[data-outline-id]')];
        const source = panel.exportPanelState();
        window.outlineCacheFixture = {
          rows,
          body,
          top: body.scrollTop,
          source,
          remount() {
            parent.insertBefore(turn.cloneNode(true), next);
          },
        };
        turn.remove();
        // 最新目录只靠 DOM 卸载通知更新；历史目录同时覆盖扫描前点击的竞态。
        if (panel.state.outlineHistorical) rows[0].click();
        return { count: rows.length, top: window.outlineCacheFixture.top };
      });
      await page.waitForFunction(() => {
        const state = window.__companionFloatingPanel.state;
        return (
          ['empty', 'unavailable'].includes(state.outlineStatus) && !state.outlineRefreshPromise
        );
      });
      const missing = await page.evaluate(() => {
        const panel = window.__companionFloatingPanel;
        const f = window.outlineCacheFixture;
        const source = panel.exportPanelState();
        return {
          count: panel.state.outlineItems.length,
          rowsKept: f.rows.every((row) => row.isConnected),
          top: f.body.scrollTop,
          disabled: f.rows.every((row) => row.disabled),
          status: panel.state.outlineStatus,
          sameToken: source.outlineToken === f.source.outlineToken,
          jumps: [
            panel.panelCommand({ ...source, kind: 'outline-jump', id: f.source.outlineItems[0].id })
              .ok,
            panel.panelCommand({ ...source, kind: 'outline-anchor', anchor: 'start' }).ok,
            panel.panelCommand({ ...source, kind: 'outline-anchor', anchor: 'end' }).ok,
          ],
        };
      });
      assert.equal(missing.count, before.count, '虚拟卸载不能用空解析结果覆盖已识别目录');
      assert.equal(missing.status, 'unavailable');
      assert.equal(missing.rowsKept, true, '暂时失去原文不能重建目录 DOM');
      assert.equal(missing.top, before.top, '保留大纲自己的阅读位置');
      assert.equal(missing.disabled, true);
      assert.equal(missing.sameToken, true);
      assert.deepEqual(missing.jumps, [false, false, false]);
      await page.evaluate(() => {
        window.outlineCacheFixture.remount();
        window.__companionFloatingPanel.scan();
      });
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.outlineStatus === 'ready',
      );
      const restored = await page.evaluate(() => {
        const panel = window.__companionFloatingPanel;
        const f = window.outlineCacheFixture;
        return {
          rowsKept: f.rows.every((row) => row.isConnected && !row.disabled),
          top: f.body.scrollTop,
          sameToken: panel.exportPanelState().outlineToken === f.source.outlineToken,
          jump: panel.panelCommand({
            ...panel.exportPanelState(),
            kind: 'outline-jump',
            id: f.source.outlineItems[0].id,
          }).ok,
        };
      });
      assert.deepEqual(restored, { rowsKept: true, top: before.top, sameToken: true, jump: true });
      const changed = await page.evaluate(() => {
        const panel = window.__companionFloatingPanel;
        const source = panel.exportPanelState();
        // 同一轮正文被替换时，缓存条目和首尾导航都必须在下一次扫描前拒绝。
        document.querySelector('#answer h2').textContent = '重新加载后已经改写的正文';
        return [
          panel.panelCommand({ ...source, kind: 'outline-jump', id: source.outlineItems[0].id }).ok,
          panel.panelCommand({ ...source, kind: 'outline-anchor', anchor: 'start' }).ok,
          panel.panelCommand({ ...source, kind: 'outline-anchor', anchor: 'end' }).ok,
        ];
      });
      assert.deepEqual(changed, [false, false, false]);
    },
  ]);
}

export async function checkCachedOutlineProjection(page, outline) {
  const projection = outline.locator('.feature-projection');
  await projection.evaluate((node) => {
    window.cachedProjectionRows = [...node.querySelectorAll('[data-outline-id]')];
    window.workbenchFixture.outlineProjection.outlineStatus = 'unavailable';
  });
  await outline.locator('[data-outline-id]:disabled').first().waitFor();
  assert.equal(await outline.locator('[data-outline-id]').count(), 60);
  assert.equal(
    await page.evaluate(() => window.cachedProjectionRows.every((row) => row.isConnected)),
    true,
  );
  assert.equal(await outline.getByRole('button', { name: '定位到本轮开头' }).isDisabled(), true);
  await page.evaluate(() => {
    window.workbenchFixture.outlineProjection.outlineStatus = 'ready';
  });
  await outline.locator('[data-outline-id]:enabled').first().waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.cachedProjectionRows.every((row) => row.isConnected && !row.disabled),
    ),
    true,
  );
}
