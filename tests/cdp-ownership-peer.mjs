/* [INPUT]: Synthetic CDP requests and an isolated Chromium page.
 * [OUTPUT]: A loopback CDP peer that can lose an acknowledgement after real page execution.
 * [POS]: Ownership recovery fixture shared by Node and Rust tests; no real host or user data.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { wsServer } = require('playwright-core/lib/utilsBundle');

export async function ownershipPeer() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body>Ownership fixture</body>',
    }),
  );
  const page = await context.newPage();
  await page.goto('http://127.0.0.1/fixture');
  const server = new wsServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const sessions = new Set();
  server.on('connection', (socket) => {
    const connected = context.newCDPSession(page);
    let dropPanel = false;
    void connected.then((session) => {
      sessions.add(session);
      session.on('Runtime.bindingCalled', (params) => {
        if (socket.readyState === 1)
          socket.send(JSON.stringify({ method: 'Runtime.bindingCalled', params }));
      });
      if (socket.readyState === 1) socket.send(JSON.stringify({ method: 'Fixture.ready' }));
    });
    socket.on('close', () => {
      void connected
        .then((session) => {
          sessions.delete(session);
          return session.detach();
        })
        .catch(() => {});
    });
    socket.on('message', async (bytes) => {
      const request = JSON.parse(String(bytes));
      let response;
      try {
        const session = await connected;
        if (request.method === 'Fixture.dropAfterNextPanel') {
          dropPanel = true;
          response = {};
        } else {
          response = await session.send(request.method, request.params);
          if (
            dropPanel &&
            request.method === 'Runtime.evaluate' &&
            request.params.expression.includes('if (true && document.readyState')
          ) {
            dropPanel = false;
            // The page has executed the actual source; only its response is lost.
            socket.terminate();
            return;
          }
        }
        if (socket.readyState === 1)
          socket.send(JSON.stringify({ id: request.id, result: response }));
      } catch (error) {
        if (socket.readyState === 1)
          socket.send(JSON.stringify({ id: request.id, error: { message: String(error) } }));
      }
    });
  });
  return {
    endpoint: `ws://127.0.0.1:${server.address().port}`,
    page,
    async close() {
      for (const socket of server.clients) socket.terminate();
      await Promise.all([...sessions].map((session) => session.detach().catch(() => {})));
      await new Promise((resolve) => server.close(resolve));
      await browser.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const peer = await ownershipPeer();
  process.stdout.write(`${peer.endpoint}\n`);
  process.stdin.resume();
  process.stdin.once('end', () => void peer.close());
}
