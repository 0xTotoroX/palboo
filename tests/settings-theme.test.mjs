/* [INPUT]: 真实宿主外观采样器、设置主题菜单与控件、合成样式/修订 API。
 * [OUTPUT]: 双主题颜色/字体/控件状态、断线保留、固定模式隔离与草稿/保存回归。
 * [POS]: 隔离浏览器，不读取真实聊天或修改用户设置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

test('settings follow host appearance while preserving original theme, modes and drafts', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {SettingsTheme} from './ui/settings/settings-theme';
import {Input} from './ui/settings/components/ui/input';
import {Button} from './ui/settings/components/ui/button';
import {Switch} from './ui/settings/components/ui/switch';
import {readSettingsAppearance} from './ui/codex/appearance';
window.readHost=readSettingsAppearance;
window.mount=createRoot(document.getElementById('root'));
window.render=(host,appearance)=>window.mount.render(<div className="settings-app">
<SettingsTheme codexTheme={host?.theme} hostAppearance={host} appearance={appearance}/>
<main className="settings-content"><div className="settings-form-column">
<label htmlFor="draft">服务地址</label><Input id="draft" defaultValue="保留草稿"/>
<Button id="action">保存</Button><Button disabled id="disabled">不可用</Button>
<Switch aria-label="功能开关" checked onCheckedChange={()=>{}}/>
</div></main></div>);`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
  });
  const html = await readFile('target/web/index.html', 'utf8');
  let css = '';
  for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
    css += await readFile(`target/web${href}`, 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 720 },
      reducedMotion: 'reduce',
    });
    let pref = {
      revision: 1,
      settingsTheme: 'codex',
      typography: { mode: 'custom', customSize: 24, scale: 150, source: 'body' },
    };
    const writes = [];
    let reject = false;
    await page.route('http://fixture.test/**', async (route) => {
      if (route.request().url().includes('/api/appearance')) {
        const body = route.request().postDataJSON();
        if (body) {
          writes.push(body);
          if (reject) {
            reject = false;
            return route.fulfill({ status: 409, json: { ok: false, message: 'conflict' } });
          }
          pref = { ...pref, ...body, revision: pref.revision + 1 };
        }
        return route.fulfill({ json: pref });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    });
    await page.goto('http://fixture.test');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const hostPage = await browser.newPage();
    await hostPage.setContent('<div id="root"></div>');
    await hostPage.addScriptTag({ content: bundle.outputFiles[0].text });
    const sample = async (dark = false, size = 20) =>
      hostPage.evaluate(
        ({ dark, size }) => {
          const r = document.documentElement;
          r.className = dark ? 'theme-dark' : 'theme-light';
          r.style.fontSize = size + 'px';
          r.style.lineHeight = '1.5';
          const tokens = {
            '--app-color-background-surface': dark ? '#101010' : '#ffffff',
            '--app-color-text-foreground': dark ? '#ededed' : '#1f2328',
            '--codex-theme-accent-color': '#a67df2',
            '--app-color-text-accent': dark ? '#c4a8ff' : '#7849d1',
            '--color-token-input-border': dark ? '#444444' : '#dddddd',
            '--color-token-focus-border': '#a67df2',
            '--color-token-list-hover-background': dark ? '#303030' : '#f0f0f0',
            '--app-color-background-accent-hover': dark ? '#3d284f' : '#ede5fc',
            '--font-ui-family': 'Georgia, serif',
            '--font-ui-weight': '430',
            '--app-color-text-on-accent': '#000000',
          };
          for (const [k, v] of Object.entries(tokens)) r.style.setProperty(k, v);
          return window.readHost();
        },
        { dark, size },
      );
    const render = (host) =>
      page.evaluate(({ host, pref }) => window.render(host, pref), { host, pref });
    const color = (selector) =>
      page.locator(selector).evaluate((n) => getComputedStyle(n).backgroundColor);
    const waitColor = (expected) =>
      page.waitForFunction(
        (v) => getComputedStyle(document.documentElement).backgroundColor === v,
        expected,
      );
    let light = await sample();
    await render(light);
    await waitColor('rgb(255, 255, 255)');
    assert.equal(await page.locator('html').getAttribute('data-settings-style'), 'chatgpt');
    assert.equal(
      await page.locator('#draft').evaluate((n) => getComputedStyle(n).fontSize),
      '20px',
      'host UI size ignores workbench custom size',
    );
    assert.match(
      await page.locator('#draft').evaluate((n) => getComputedStyle(n).fontFamily),
      /Georgia/,
    );
    await page.locator('#draft').fill('未保存的新草稿');
    await page.locator('#draft').evaluate((n) => (window.draftNode = n));
    assert.equal(await color('[role=switch]'), 'rgb(166, 125, 242)');
    await page.locator('#draft').focus();
    assert.equal(
      await page.locator('#draft').evaluate((n) => getComputedStyle(n).outlineColor),
      'rgb(166, 125, 242)',
    );
    assert.equal(
      await page.locator('#disabled').evaluate((n) => getComputedStyle(n).opacity),
      '0.45',
    );
    const before = await color('#action');
    await page.locator('#action').hover();
    assert.notEqual(await color('#action'), before);
    assert.equal(writes.length, 0);
    const dark = await sample(true, 22);
    await render(dark);
    await waitColor('rgb(16, 16, 16)');
    await render(null);
    await waitColor('rgb(16, 16, 16)');
    const choose = async (name) => {
      const trigger = page.locator('.settings-theme-trigger');
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await page.locator('.settings-theme-menu').getByRole('button', { name, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.settings-theme-trigger').disabled);
    };
    await choose('浅色');
    await waitColor('rgb(255, 255, 255)');
    await render(dark);
    await waitColor('rgb(255, 255, 255)');
    assert.equal(await page.locator('#draft').evaluate((n) => n === window.draftNode), true);
    assert.equal(await page.locator('#draft').inputValue(), '未保存的新草稿');
    await choose('Palboo 原有');
    await waitColor('rgb(250, 250, 250)');
    assert.equal(
      await page.locator('#draft').evaluate((n) => getComputedStyle(n).fontSize),
      '21px',
    );
    await choose('深色');
    await waitColor('rgb(25, 25, 27)');
    reject = true;
    await choose('跟随 ChatGPT');
    await waitColor('rgb(25, 25, 27)');
    await choose('跟随 ChatGPT');
    await waitColor('rgb(16, 16, 16)');
    await choose('自动');
    light = await sample(false, 32);
    await render(light);
    await waitColor('rgb(255, 255, 255)');
    assert.equal(
      await page.locator('#draft').evaluate((n) => getComputedStyle(n).fontSize),
      '32px',
    );
    for (const width of [360, 740, 1360]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
    await mkdir('target/reports/settings-theme', { recursive: true });
    await page.screenshot({ path: 'target/reports/settings-theme/follow-light.png' });
    await render(dark);
    await waitColor('rgb(16, 16, 16)');
    await page.screenshot({ path: 'target/reports/settings-theme/follow-dark.png' });
    assert.ok(
      writes.every((w) =>
        Object.keys(w).every((k) =>
          ['expectedRevision', 'settingsTheme', 'settingsStyle'].includes(k),
        ),
      ),
    );
    assert.equal(
      await hostPage.evaluate(() => {
        document.documentElement.style.removeProperty('--app-color-background-surface');
        return window.readHost();
      }),
      null,
    );
  } finally {
    await browser.close();
  }
});
