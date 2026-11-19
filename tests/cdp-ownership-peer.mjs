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

const TIMEOUT = Symbol('timeout');

function timed(promise, ms) {
  let timer;
  const wrapped = Promise.resolve(promise);
  wrapped.catch(() => {});
  return Promise.race([
    wrapped,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function childExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function waitExit(child, ms) {
  if (childExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer);
      child.off?.('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(childExited(child)), ms);
    child.once?.('exit', onExit);
  });
}

// Reclaim only the isolated fixture browser launched by this peer; never mask a real teardown error.
export async function closeOwnedBrowser(
  browser,
  browserServer,
  { gracefulMs = 2000, killMs = 2000 } = {},
) {
  const child = browserServer?.process?.() ?? null;
  let error = null;
  const closeStep = async (fn) => {
    if (typeof fn !== 'function') return true;
    try {
      return (await timed(fn(), gracefulMs)) !== TIMEOUT;
    } catch (cause) {
      error ??= cause;
      return false;
    }
  };
  const closedBrowser = await closeStep(() => browser?.close?.());
  const closedServer = closedBrowser ? await closeStep(() => browserServer?.close?.()) : false;
  if (!closedBrowser || !closedServer || !childExited(child)) {
    if (typeof browserServer?.kill === 'function') {
      try {
        await timed(browserServer.kill(), killMs);
      } catch (cause) {
        error ??= cause;
      }
    }
    if (!childExited(child)) {
      try {
        child.kill?.('SIGKILL');
      } catch (cause) {
        if (cause?.code !== 'ESRCH') error ??= cause;
      }
      await waitExit(child, killMs);
    }
  }
  if (!childExited(child)) {
    throw error ?? new Error('Fixture Chromium process did not exit during teardown');
  }
}

export async function ownershipPeer() {
  const browserServer = await chromium.launchServer({
    executablePath: process.env.PALBOO_CHROME_BIN || process.env.CHROME_PATH || undefined,
    headless: true,
  });
  let browser, server;
  try {
    browser = await chromium.connect(browserServer.wsEndpoint());
    const context = await browser.newContext();
    await context.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><body>Ownership fixture</body>',
      }),
    );
    const page = await context.newPage();
    await page.goto('http://127.0.0.1/fixture');
    server = new wsServer({ host: '127.0.0.1', port: 0 });
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
    let closing = null;
    return {
      endpoint: `ws://127.0.0.1:${server.address().port}`,
      pid: browserServer.process()?.pid ?? null,
      page,
      close() {
        closing ??= (async () => {
          let wsError = null;
          try {
            for (const socket of server.clients) socket.terminate();
            await Promise.all([...sessions].map((session) => session.detach().catch(() => {})));
            await new Promise((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          } catch (error) {
            wsError = error;
          }
          await closeOwnedBrowser(browser, browserServer);
          if (wsError) throw wsError;
        })();
        return closing;
      },
    };
  } catch (error) {
    if (server) await new Promise((resolve) => server.close(resolve)).catch(() => {});
    await closeOwnedBrowser(browser, browserServer).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const peer = await ownershipPeer();
  process.stdout.write(`${peer.endpoint}\n`);
  process.stdin.resume();
  process.stdin.once('end', () => {
    peer.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
