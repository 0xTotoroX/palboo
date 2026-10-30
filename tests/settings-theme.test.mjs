/* [INPUT]: 真实宿主外观采样器、设置主题菜单与控件、合成样式/修订 API。
 * [OUTPUT]: 双主题控件角色/菜单与组合输入状态、本机字形/提示、双色采样缓存、原主题恢复及草稿/保存回归。
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
import {NativeSelect} from './ui/settings/components/ui/native-select';
import {Field} from './ui/settings/settings-controls';
import {IconButton} from './ui/settings/components/ui/button';
import {Icon} from './ui/shared/icons/react';
import {readSettingsAppearance} from './ui/codex/appearance';
import {SettingsSearch} from './ui/settings/settings-search';
import {SettingsDrawer} from './ui/settings/settings-drawer';
import {DirectionPicker} from './ui/settings/direction-picker';
import {useSettingsMotion} from './ui/settings/settings-motion';
function MotionProbe({identity}) { const ref = useSettingsMotion(identity); return <div ref={ref} id="motion-probe">动效</div>; }
window.readHost=readSettingsAppearance;
window.mount=createRoot(document.getElementById('root'));
window.render=(host,appearance)=>window.mount.render(<div className="settings-app">
<SettingsTheme codexTheme={host?.theme} hostAppearance={host} appearance={appearance}/>
<SettingsSearch/>
<MotionProbe identity={host?.theme}/>
<main className="settings-content"><div className="settings-form-column">
<Field label="服务地址" id="draft"><Input id="draft" defaultValue="保留草稿"/></Field>
<Field label="显示方式" id="select"><NativeSelect id="select" controlWidth="short" defaultValue="a"><option value="a">跟随当前窗口 / Follow the current window</option><option value="b">固定显示器 / Fixed display</option></NativeSelect></Field>
<Input id="padded-input" className="pr-[43px]" defaultValue="example"/>
<IconButton id="icon" aria-label="刷新"><Icon name="refresh"/></IconButton>
<Button id="action">保存</Button><Button disabled id="disabled">不可用</Button>
<Button id="outline" variant="outline">检查连接</Button>
<div className="settings-choice"><button id="selected-choice" aria-pressed="true">当前布局</button><button aria-pressed="false">另一布局</button></div>
<div className="settings-entry" id="compound"><Input className="settings-entry-name" aria-label="组合名称" defaultValue="我的名称"/><textarea className="settings-entry-content" aria-label="组合正文" defaultValue="草稿正文"/></div>
<Input id="invalid" aria-label="无效输入" aria-invalid="true" defaultValue="example"/>
<input id="slider" type="range" aria-label="位置" defaultValue="50"/>
<Switch aria-label="功能开关" checked onCheckedChange={()=>{}}/>
<SettingsDrawer id="sample" title="高级设置"><Input aria-label="抽屉草稿" defaultValue="保留抽屉草稿"/><button type="button" title="抽屉提示">提示测试</button></SettingsDrawer>
<DirectionPicker library={[{id:'demo',name:'示例方向',instruction:'说明',enabled:true}]} builtIns={[{id:'demo'}]} selected={[]} onSelect={()=>{}}/>
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
            '--spacing': '.25rem',
            '--control-radius-md': 'calc(.5rem * 1.25)',
            '--radius-button-action': 'calc(.625rem * 1.25)',
            '--radius-button-toolbar': '9999px',
            '--menu-radius': 'calc(1rem * 1.25)',
            '--menu-item-radius': 'calc(.75rem * 1.25)',
            '--control-size-lg': '2.25rem',
            '--control-gutter-md': '.75rem',
            '--menu-item-padding': 'calc(.25rem * 1.25) calc(.25rem * 2)',
            '--app-menu-gutter': '10px',
            '--app-menu-item-padding': '6px 10px',
            '--app-menu-item-height': '36px',
            '--switch-track-width': '32px',
            '--switch-track-height': '19px',
            '--switch-thumb-size': 'calc(19px - 2 * 3px)',
            '--switch-thumb-offset': '3px',
            '--codex-corner-shape': 'superellipse(1.5)',
            '--input-outline-border-color-hover': '#888888',
            '--input-outline-border-color': '#bbbbbb',
            '--input-outline-border-color-focus': '#666666',
            '--color-background-primary-ghost-hover': dark ? '#353535' : '#f5f5f5',
            '--color-background-primary-ghost-active': dark ? '#454545' : '#e5e5e5',
            '--color-background-segmented-selected': dark ? '#383838' : '#e8e8e8',
            '--color-background-segmented-selected-hover': dark ? '#484848' : '#d8d8d8',
            '--slider-track-color': dark ? '#555555' : '#dddddd',
            '--input-placeholder-text-color': '#777777',
            '--color-background-primary-solid': dark ? '#eeeeee' : '#222222',
            '--color-background-primary-solid-hover': dark ? '#dddddd' : '#333333',
            '--color-background-primary-solid-active': dark ? '#cccccc' : '#444444',
            '--color-text-primary-solid': dark ? '#111111' : '#ffffff',
            '--color-background-disabled': '#eeeeee',
            '--color-border-disabled': '#dddddd',
            '--color-text-disabled': '#888888',
            '--color-background-text-selection': '#e6d6ff',
            '--menu-background-color': dark ? '#222222' : '#fafafa',
            '--menu-box-shadow': dark ? '0 4px 12px #0009' : '0 4px 12px #0003',
            '--menu-font-size': '.875rem',
            '--menu-line-height': '1.5',
            '--menu-backdrop-filter': 'blur(8px)',
            '--dialog-backdrop-dim-background': '#0000004d',
            '--modal-backdrop-dim-shadow': '0 12px 32px #0003',
            '--transition-duration-basic': '120ms',
            '--transition-duration-moderate': '180ms',
            '--transition-ease-basic': 'ease-in-out',
            '--ease-enter': 'cubic-bezier(.2,.8,.2,1)',
            '--cubic-exit': 'cubic-bezier(.8,0,.4,1)',
            '--tooltip-background-color': '#252525',
            '--tooltip-text-color': '#fefefe',
            '--tooltip-border-radius': '13px',
            '--tooltip-font-size': '15px',
            '--tooltip-padding-inline': '12px',
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
    const geometry = () =>
      page.evaluate(() => {
        const style = (id) => getComputedStyle(document.querySelector(id));
        return {
          radius: style('#draft').borderRadius,
          buttonRadius: style('#action').borderRadius,
          height: style('#draft').height,
          fieldMargin: style('.settings-field').marginBottom,
          switchWidth: style('[role=switch]').width,
          switchHeight: style('[role=switch]').height,
          thumbSize: style('[data-slot=switch-thumb]').width,
          thumbOffset: style('[data-slot=switch-thumb]').translate,
          reservedPadding: style('#padded-input').paddingRight,
          iconPadding: style('#icon').paddingLeft,
          menuRadius: style('.settings-theme-menu').borderRadius,
        };
      });
    assert.deepEqual(await geometry(), {
      radius: '12.5px',
      buttonRadius: '15.625px',
      height: '45px',
      fieldMargin: '20px',
      switchWidth: '32px',
      switchHeight: '19px',
      thumbSize: '13px',
      thumbOffset: '16px',
      reservedPadding: '43px',
      iconPadding: '0px',
      menuRadius: '25px',
    });
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
      await page.locator('#draft').evaluate((n) => getComputedStyle(n).borderColor),
      'rgb(102, 102, 102)',
    );
    assert.equal(await page.locator('#disabled').evaluate((n) => getComputedStyle(n).opacity), '1');
    assert.equal(await color('#disabled'), 'rgb(238, 238, 238)');
    assert.equal(await page.locator('#disabled').isEnabled(), false);
    const before = await color('#action');
    await page.locator('#action').hover();
    assert.notEqual(await color('#action'), before);
    assert.equal(before, 'rgb(34, 34, 34)');
    assert.equal(await color('#action'), 'rgb(51, 51, 51)');
    assert.equal(
      await page.locator('#select').evaluate((n) => getComputedStyle(n).borderRadius),
      '9999px',
      'dropdown uses toolbar radius independently of text inputs and action buttons',
    );
    assert.equal(await color('#selected-choice'), 'rgb(232, 232, 232)');
    await page.locator('#selected-choice').hover();
    assert.equal(await color('#selected-choice'), 'rgb(216, 216, 216)');
    const outlineBorder = await page
      .locator('#outline')
      .evaluate((n) => getComputedStyle(n).borderColor);
    await page.locator('#outline').hover();
    assert.equal(await color('#outline'), 'rgb(245, 245, 245)');
    assert.equal(
      await page.locator('#outline').evaluate((n) => getComputedStyle(n).borderColor),
      outlineBorder,
    );
    await page.getByRole('textbox', { name: '组合正文' }).fill('保留组合草稿');
    assert.equal(
      await page.locator('#compound').evaluate((n) => getComputedStyle(n).borderColor),
      'rgb(102, 102, 102)',
    );
    assert.equal(await color('.settings-entry-content'), 'rgba(0, 0, 0, 0)');
    assert.equal(
      await page
        .locator('.settings-entry-content')
        .evaluate((n) => getComputedStyle(n).borderColor),
      'rgba(0, 0, 0, 0)',
    );
    await page.locator('#invalid').focus();
    assert.equal(
      await page.locator('#invalid').evaluate((n) => getComputedStyle(n).borderColor),
      'rgb(180, 35, 24)',
      'error state survives focus',
    );
    await page.locator('#slider').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await page.locator('#slider').inputValue(),
      '51',
      'styled slider retains native keyboard operation',
    );
    await page.locator('.settings-theme-trigger').click();
    await page.locator('#draft').focus();
    const menuStyles = await page.locator('.settings-theme-menu').evaluate((n) => ({
      padding: getComputedStyle(n).padding,
      itemPadding: getComputedStyle(n.querySelector('button')).padding,
      checkedBackground: getComputedStyle(n.querySelector('[aria-pressed=true]')).backgroundColor,
    }));
    assert.deepEqual(menuStyles, {
      padding: '10px',
      itemPadding: '6px 10px',
      checkedBackground: 'rgba(0, 0, 0, 0)',
    });
    await page.locator('.settings-theme-trigger').click();
    const corners = await page.locator('#draft').evaluate((n) => ({
      supported: CSS.supports('corner-shape', 'superellipse(1.5)'),
      value: getComputedStyle(n).cornerShape,
    }));
    if (corners.supported) assert.equal(corners.value, 'superellipse(1.5)');
    await page.getByRole('button', { name: '搜索设置', exact: true }).click();
    assert.equal(
      await page.locator('.settings-search-dialog').evaluate((n) => getComputedStyle(n).boxShadow),
      'rgba(0, 0, 0, 0.2) 0px 12px 32px 0px',
    );
    await page.keyboard.press('Escape');
    await page.locator('.direction-picker-trigger').click();
    assert.equal(
      await page
        .locator('.direction-picker-panel')
        .evaluate((n) => getComputedStyle(n).borderRadius),
      '25px',
    );
    const searchGeometry = await page.locator('.direction-picker-search').evaluate((n) => {
      const input = n.querySelector('input'),
        icon = n.querySelector('.buddy-icon');
      return {
        textStart:
          input.getBoundingClientRect().left + parseFloat(getComputedStyle(input).paddingLeft),
        iconEnd: icon.getBoundingClientRect().right,
      };
    });
    assert.ok(
      searchGeometry.textStart > searchGeometry.iconEnd,
      'search text clears its leading icon',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '高级设置', exact: true }).click();
    await page.getByRole('textbox', { name: '抽屉草稿' }).fill('新抽屉草稿');
    assert.equal(
      await page
        .locator('.settings-drawer')
        .evaluate((n) => getComputedStyle(n, '::backdrop').backgroundColor),
      'rgba(0, 0, 0, 0.3)',
    );
    await page.keyboard.press('Escape');
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
    const original = await geometry();
    assert.equal(
      await page.locator('#select').evaluate((n) => getComputedStyle(n).borderRadius),
      '4px',
    );
    assert.equal(
      await page.getByRole('textbox', { name: '组合正文' }).inputValue(),
      '保留组合草稿',
    );
    assert.equal(await page.locator('#slider').inputValue(), '51');
    assert.equal(original.radius, '4px');
    assert.equal(original.switchWidth, '36px');
    assert.equal(original.switchHeight, '22px');
    assert.equal(original.menuRadius, '9px');
    assert.equal(
      await page
        .locator('html')
        .evaluate((n) => getComputedStyle(n).getPropertyValue('--settings-menu-enter').trim()),
      '.18s',
    );
    assert.equal(
      await page.locator('#disabled').evaluate((n) => getComputedStyle(n).opacity),
      '0.45',
    );
    assert.equal(
      await page
        .locator('html')
        .evaluate((n) => n.style.getPropertyValue('--settings-menu-shadow')),
      '',
    );
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
    assert.equal((await geometry()).radius, '20px', 'host rem metrics scale with its UI font');
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
      await page.locator('#select').selectOption('b');
      assert.equal(await page.locator('#select').inputValue(), 'b');
      const arrowClear = await page
        .locator('#select')
        .evaluate((n) => parseFloat(getComputedStyle(n).paddingRight) >= 30);
      assert.equal(arrowClear, true);
    }
    await page.locator('.settings-theme-trigger').click();
    await page
      .locator('.settings-theme-menu')
      .getByRole('button', { name: '跟随 ChatGPT', exact: true })
      .press('ArrowDown');
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent.trim()),
      'Palboo 原有',
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await page.locator('.settings-theme-trigger').getAttribute('aria-expanded'),
      'false',
    );
    await mkdir('target/reports/settings-theme', { recursive: true });
    await page.screenshot({ path: 'target/reports/settings-theme/follow-light.png' });
    await render(dark);
    await waitColor('rgb(16, 16, 16)');
    await page.screenshot({ path: 'target/reports/settings-theme/follow-dark.png' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.mouse.click(890, 700);
    await render(light);
    await page.waitForFunction(() =>
      document
        .querySelector('#motion-probe')
        .getAnimations()
        .some((a) => a.playState === 'running'),
    );
    const reduced = await hostPage.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'true';
      return window.readHost();
    });
    assert.equal(reduced.reducedMotion, true);
    await render(reduced);
    await page.waitForFunction(
      () => document.documentElement.dataset.settingsReducedMotion === 'true',
    );
    assert.equal(
      await page.locator('#motion-probe').evaluate((n) => n.getAnimations().length),
      0,
      'host preference cancels in-flight motion',
    );
    assert.equal(
      await page.locator('#action').evaluate((n) => getComputedStyle(n).transitionDuration),
      '0s',
    );
    await choose('Palboo 原有');
    assert.equal(await page.locator('html').getAttribute('data-settings-reduced-motion'), null);
    await choose('跟随 ChatGPT');
    await page.getByRole('button', { name: '高级设置', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '抽屉草稿' }).inputValue(), '新抽屉草稿');
    await page.keyboard.press('Escape');
    const motionEnabled = await hostPage.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'false';
      return window.readHost();
    });
    await render(motionEnabled);
    await page.mouse.click(890, 700);
    assert.equal(
      await page
        .locator('#action')
        .evaluate((n) => getComputedStyle(n).transitionDuration.split(',')[0].trim()),
      '0.12s',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(
      await page
        .locator('#action')
        .evaluate((n) => parseFloat(getComputedStyle(n).transitionDuration) <= 0.00001),
      'local accessibility preference still wins',
    );
    assert.ok(
      writes.every((w) =>
        Object.keys(w).every((k) =>
          ['expectedRevision', 'settingsTheme', 'settingsStyle'].includes(k),
        ),
      ),
    );
    // Existing native title content now follows host tooltip tokens, including in dialogs.
    await page.getByRole('button', { name: '高级设置', exact: true }).click();
    await page.getByRole('button', { name: '提示测试', exact: true }).focus();
    await page.getByRole('tooltip').waitFor({ state: 'visible' });
    assert.equal(
      await page.getByRole('tooltip').evaluate((n) => !!n.closest('dialog[open]')),
      true,
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '搜索设置', exact: true }).focus();
    await page.getByRole('tooltip').waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('tooltip').innerText(), '搜索设置');
    assert.equal(
      await page.getByRole('tooltip').evaluate((n) => getComputedStyle(n).backgroundColor),
      'rgb(37, 37, 37)',
    );
    assert.equal(
      await page.getByRole('tooltip').evaluate((n) => getComputedStyle(n).borderRadius),
      '13px',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('tooltip').count(), 0);
    assert.equal(
      await page.getByRole('button', { name: '搜索设置', exact: true }).getAttribute('title'),
      '搜索设置',
    );
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: '搜索设置', exact: true }).hover();
    await page.getByRole('tooltip').waitFor({ state: 'visible' });
    await page.getByRole('tooltip').hover();
    assert.equal(await page.getByRole('tooltip').isVisible(), true, 'tooltip remains hoverable');
    await page.screenshot({ path: 'target/reports/settings-theme/follow-tooltip.png' });
    await choose('Palboo 原有');
    assert.equal(await page.getByRole('tooltip').count(), 0);
    assert.equal(
      await page.getByRole('button', { name: '搜索设置', exact: true }).getAttribute('title'),
      '搜索设置',
    );
    await choose('跟随 ChatGPT');

    // Both palettes are sampled without changing the host root, focus, or visible theme.
    const pair = await hostPage.evaluate(() => {
      const root = document.documentElement;
      root.removeAttribute('style');
      root.className = '';
      root.dataset.theme = 'light';
      const theme = document.createElement('style');
      theme.dataset.codexAppThemes = '';
      theme.textContent = `:root, [data-theme] { --spacing: 4px; --font-ui-family: Georgia, serif; --color-token-scrollbar-slider-background: var(--app-color-border); }
        :root[data-theme="light"], :root [data-theme="light"] { --app-color-background-surface: #fafafa; --app-color-text-foreground: #121212; --menu-background-color: #f1f1f1; --app-color-border: #cccccc; }
        :root[data-theme="dark"], :root [data-theme="dark"] { --app-color-background-surface: #17191b; --app-color-text-foreground: #f4f4f4; --menu-background-color: #282a2c; --app-color-border: #555555; --font-ui-family: monospace; }`;
      document.head.append(theme);
      const input = document.createElement('input');
      document.body.append(input);
      input.focus();
      const before = root.outerHTML.slice(0, root.outerHTML.indexOf('>') + 1);
      const result = window.readHost();
      const observer = new MutationObserver(() => {});
      observer.observe(document.body, { childList: true, subtree: true });
      window.readHost();
      const repeatedMutations = observer.takeRecords().length;
      observer.disconnect();
      return {
        result,
        unchanged: before === root.outerHTML.slice(0, root.outerHTML.indexOf('>') + 1),
        focused: document.activeElement === input,
        probes: document.querySelectorAll('[data-palboo-appearance-probe]').length,
        repeatedMutations,
      };
    });
    assert.equal(pair.result.palettes.dark.colors.page, '#17191b');
    assert.equal(pair.result.palettes.dark.colors.menu, '#282a2c');
    assert.equal(pair.result.palettes.dark.colors.scrollbar, '#555555');
    assert.equal(pair.result.palettes.dark.typography.fontFamily, 'monospace');
    assert.equal(pair.unchanged && pair.focused, true);
    assert.equal(pair.probes, 0);
    assert.equal(pair.repeatedMutations, 0, 'unchanged snapshots do not remount probes');
    await render(pair.result);
    await choose('深色');
    await waitColor('rgb(23, 25, 27)');
    assert.equal(await page.locator('#draft').inputValue(), '未保存的新草稿');
    assert.equal(await hostPage.locator('html').getAttribute('data-theme'), 'light');
    const updatedPair = await hostPage.evaluate(() => {
      const style = document.querySelector('[data-codex-app-themes]');
      style.textContent = style.textContent.replace('#17191b', '#202224');
      return window.readHost();
    });
    await render(updatedPair);
    await waitColor('rgb(32, 34, 36)');

    // Use an available test-machine font to verify the alias resolves to a real local face.
    const localFont = await page.evaluate(async () => {
      for (const name of ['ArialMT', 'Arial', 'DejaVu Sans', 'Liberation Sans']) {
        try {
          await new FontFace('font-availability-probe', `local(${JSON.stringify(name)})`).load();
          return name;
        } catch {}
      }
      return null;
    });
    assert.ok(localFont, 'test browser supplies a standard local font');
    const alias = `Codex selected ${localFont}`;
    const fontHost = {
      ...pair.result,
      palettes: undefined,
      typography: { ...pair.result.typography, fontFamily: `"${alias}", monospace` },
    };
    await choose('自动');
    await render(fontHost);
    await page.waitForFunction(
      (name) =>
        [...document.fonts].some(
          (f) => f.family.replace(/^"|"$/g, '') === name && f.status === 'loaded',
        ),
      alias,
    );
    const fontWidths = await page.evaluate(
      async ({ name, alias }) => {
        const reference = new FontFace('font-reference', `local(${JSON.stringify(name)})`);
        await reference.load();
        document.fonts.add(reference);
        const context = document.createElement('canvas').getContext('2d');
        const width = (family) => {
          context.font = `16px "${family}"`;
          return context.measureText('Hello Palboo 123').width;
        };
        const widths = [width(alias), width('font-reference')];
        document.fonts.delete(reference);
        return widths;
      },
      { name: localFont, alias },
    );
    assert.equal(fontWidths[0], fontWidths[1]);
    await choose('Palboo 原有');
    assert.equal(
      await page.evaluate(
        (name) => [...document.fonts].some((f) => f.family.replace(/^"|"$/g, '') === name),
        alias,
      ),
      false,
    );
    await hostPage.evaluate(() => document.querySelector('[data-codex-app-themes]').remove());
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
