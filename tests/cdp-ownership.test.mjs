/* [INPUT]: Ownership templates from src/cdp.rs and the real desktop request bridge.
 * [OUTPUT]: Same-process reconnect, foreign rejection, deferred installation and real async hot-reload ownership.
 * [POS]: Isolated Chromium/CDP regression; no compilation or real host connection. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ownershipPeer } from './cdp-ownership-peer.mjs';

const rust = readFileSync(new URL('../src/cdp.rs', import.meta.url), 'utf8');
const template = (name) => {
  const match = rust.match(new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`));
  assert.ok(match, `${name} must remain the actual Rust injection template`);
  return match[1];
};
const availableTemplate = template('DESKTOP_AVAILABLE');
const ownedTemplate = template('OWNED_SCRIPT');
const owner = 'synthetic-backend-a';
const available = (token = owner) =>
  availableTemplate.replaceAll('__PALBOO_OWNER__', JSON.stringify(token));
const cleanup = () =>
  template('DESKTOP_CLEANUP')
    .replaceAll('__PALBOO_AVAILABLE__', available())
    .replaceAll('__PALBOO_OWNER__', JSON.stringify(owner));
const owned = (source, panel = true, token = owner, protect = true) =>
  ownedTemplate
    .replaceAll('__PALBOO_AVAILABLE__', availableTemplate)
    .replaceAll('__PALBOO_OWNER__', JSON.stringify(token))
    .replaceAll('__PALBOO_PANEL__', String(panel))
    .replaceAll('__PALBOO_PROTECT__', String(protect))
    .replace('__PALBOO_SOURCE__', () => source);
const bridge = readFileSync(new URL('../ui/shared/bridge/requests.js', import.meta.url), 'utf8');
const panel = `${bridge}\nwindow.__companionFloatingPanel = {
  development: true,
  destroy() { window.destroyedPanels = (window.destroyedPanels || 0) + 1; delete window.__companionFloatingPanel; }
};`;

async function connection(endpoint) {
  const socket = new WebSocket(endpoint);
  const pending = new Map();
  let sequence = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', ({ data }) => {
      const value = JSON.parse(data);
      if (value.method === 'Fixture.ready') resolve();
      const request = pending.get(value.id);
      if (!request) return;
      pending.delete(value.id);
      if (value.error) request.reject(Error(value.error.message));
      else request.resolve(value.result);
    });
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(Error('connection closed'));
    pending.clear();
  });
  await ready;
  return {
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await this.request('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception.description);
      return result.result.value;
    },
    close: () => socket.close(),
  };
}

test('executed restoration survives a lost CDP acknowledgement; foreign objects remain untouched', async () => {
  const peer = await ownershipPeer();
  try {
    const first = await connection(peer.endpoint);
    await first.evaluate(owned(panel));
    await first.evaluate('window.__companionDesktop.destroy(); true');
    await first.request('Fixture.dropAfterNextPanel');
    await assert.rejects(first.evaluate(owned(panel)), /connection closed/);
    const second = await connection(peer.endpoint);
    assert.equal(await second.evaluate(available()), true);
    await second.evaluate(owned(panel));
    assert.equal(await second.evaluate('window.destroyedPanels'), 2);
    assert.equal(await second.evaluate('window.__companionDesktop.__palbooOwner'), owner);

    // Hot reload and fallback use the same wrapper and replace the real bridge object.
    await second.evaluate('window.previousDesktop = window.__companionDesktop; true');
    await second.evaluate(owned(panel));
    assert.equal(
      await second.evaluate('window.previousDesktop !== window.__companionDesktop'),
      true,
    );
    assert.equal(await second.evaluate(available()), true);
    await second.evaluate('window.__companionFloatingPanel.destroy(); true');
    await second.evaluate(owned(panel));
    assert.equal(await second.evaluate(available()), true);

    // A stale marker elsewhere must not authorize an untagged replacement Desktop.
    for (const foreign of [undefined, 'synthetic-backend-b']) {
      await second.evaluate(
        `window.__companionDesktop = {destroy() {window.foreignDestroyed = true;}, ${foreign ? `__palbooOwner:${JSON.stringify(foreign)},` : ''}}; true`,
      );
      assert.equal(await second.evaluate(available()), false);
      await assert.rejects(second.evaluate(owned(panel)), /其他胶囊实例/);
      assert.equal(await second.evaluate('Boolean(window.foreignDestroyed)'), false);
    }
    second.close();
  } finally {
    await peer.close();
  }
});

test('deferred installation rechecks ownership and partially installed objects remain recoverable', async () => {
  const peer = await ownershipPeer();
  try {
    const client = await connection(peer.endpoint);
    await client.evaluate(
      `Object.defineProperty(document, 'readyState', {configurable:true, value:'loading'}); true`,
    );
    await client.evaluate(owned(panel));
    assert.equal(await client.evaluate('Boolean(window.__companionDesktop)'), false);
    await client.evaluate(
      `window.__companionDesktop = {destroy() {window.foreignDestroyed=true;}}; Object.defineProperty(document,'readyState',{configurable:true,value:'interactive'}); document.dispatchEvent(new Event('DOMContentLoaded')); true`,
    );
    assert.equal(await client.evaluate('Boolean(window.foreignDestroyed)'), false);
    assert.equal(await client.evaluate('window.__companionDesktop.__palbooOwner || null'), null);
    await client.evaluate('delete window.__companionDesktop; true');
    await assert.rejects(
      client.evaluate(owned(`${bridge}\nthrow Error('synthetic initialization failure');`)),
      /synthetic initialization failure/,
    );
    assert.equal(await client.evaluate(available()), true);
    await client.evaluate(owned(panel));
    assert.equal(await client.evaluate('window.__companionDesktop.__palbooOwner'), owner);
    client.close();
  } finally {
    await peer.close();
  }
});

test('suspension cancels installation waiting for DOM readiness', async () => {
  const peer = await ownershipPeer();
  try {
    const client = await connection(peer.endpoint);
    await client.evaluate(
      "Object.defineProperty(document,'readyState',{configurable:true,value:'loading'}); true",
    );
    await client.evaluate(owned(panel));
    assert.equal(await client.evaluate(cleanup()), true);
    await client.evaluate(
      "Object.defineProperty(document,'readyState',{configurable:true,value:'interactive'}); document.dispatchEvent(new Event('DOMContentLoaded')); true",
    );
    assert.equal(await client.evaluate('Boolean(window.__companionDesktop)'), false);
    client.close();
  } finally {
    await peer.close();
  }
});

test('release installation preserves takeover of legacy and other-process remnants', async () => {
  const peer = await ownershipPeer();
  try {
    const client = await connection(peer.endpoint);
    for (const foreign of [undefined, 'previous-process']) {
      await client.evaluate(
        `window.foreignDestroyed = false; window.__companionDesktop = {destroy() {window.foreignDestroyed = true;}, ${foreign ? `__palbooOwner:${JSON.stringify(foreign)},` : ''}}; true`,
      );
      assert.equal(await client.evaluate(available()), false);
      await client.evaluate(owned(panel, true, owner, false));
      assert.equal(await client.evaluate('window.foreignDestroyed'), true);
      assert.equal(await client.evaluate(available()), true);
      assert.equal(await client.evaluate('window.__companionDesktop.__palbooOwner'), owner);
    }
    client.close();
  } finally {
    await peer.close();
  }
});

test('real development reload retains ownership after async flush and rejects a replaced owner', async () => {
  const { buildDevPanel } = await import('../scripts/dev-panel.mjs');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'palboo-ownership-'));
  const peer = await ownershipPeer();
  try {
    const snapshot = await buildDevPanel(
      resolve(import.meta.dirname, '..'),
      join(dir, 'panel.json'),
    );
    const client = await connection(peer.endpoint);
    await client.evaluate(
      owned(
        `${panel}\nwindow.__companionFloatingPanel.panelPreferences = () => null; window.__companionFloatingPanel.state = {};`,
      ),
    );
    await client.evaluate(
      'window.__buddyFeatureFlush = () => new Promise(resolve => {window.finishFlush = resolve;}); true',
    );
    await client.evaluate(owned(snapshot.script));
    await client.evaluate('window.finishFlush(true); window.__buddyDevUpdate');
    assert.equal(
      await client.evaluate(available()),
      true,
      'async replacement remains owned by this connection',
    );
    assert.equal(await client.evaluate('window.__companionDesktop.__palbooOwner'), owner);
    assert.equal(await client.evaluate('window.__companionFloatingPanel.__palbooOwner'), owner);
    assert.equal(
      await client.evaluate(cleanup()),
      true,
      'normal shutdown can remove the new objects',
    );
    assert.equal(
      await client.evaluate(
        'Boolean(window.__companionDesktop || window.__companionFloatingPanel)',
      ),
      false,
    );

    await client.evaluate(
      owned(
        `${panel}\nwindow.__companionFloatingPanel.panelPreferences = () => null; window.__companionFloatingPanel.state = {};`,
      ),
    );
    await client.evaluate(
      'window.__buddyFeatureFlush = () => new Promise(resolve => {window.finishFlush = resolve;}); true',
    );
    await client.evaluate(owned(snapshot.script));
    await client.evaluate(
      'window.__companionDesktop = {__palbooOwner:"different-connection",destroy(){window.foreignDestroyed=true;}}; window.finishFlush(true); window.__buddyDevUpdate',
    );
    assert.equal(
      await client.evaluate('window.__companionDesktop.__palbooOwner'),
      'different-connection',
    );
    assert.equal(await client.evaluate('Boolean(window.foreignDestroyed)'), false);
    client.close();
  } finally {
    await peer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
