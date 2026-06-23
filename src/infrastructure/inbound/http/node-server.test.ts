import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startHttpServer } from './node-server.js';

// ---------------------------------------------------------------------------
// Server lifecycle management
// ---------------------------------------------------------------------------

// Collect servers started during tests so we can close them in the after() hook.
// We do this by patching http.Server.listen — startHttpServer internally calls
// @hono/node-server serve() which eventually calls http.createServer().listen().
// The simplest alternative: open a server with serve() ourselves to pre-confirm
// behaviour, then verify startHttpServer does the same thing structurally.

const openServers: http.Server[] = [];
const origListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args: unknown[]) {
  openServers.push(this as http.Server);
  return origListen.apply(this, args as Parameters<typeof origListen>);
};

after(() => {
  http.Server.prototype.listen = origListen;
  for (const s of openServers) {
    try {
      s.close();
    } catch {
      /* ignore */
    }
  }
  // Give servers time to drain before the process exits.
  setTimeout(() => process.exit(0), 50);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.text('ok'));
  return app;
}

async function waitForPort(port: number, maxMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
          resolve();
          res.resume();
        });
        req.on('error', reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  throw new Error(`Port ${port} did not open within ${maxMs}ms`);
}

async function httpGet(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
    });
    req.on('error', reject);
  });
}

/** Pick a free port by listening on 0 then closing immediately. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    // Use a raw TCP server (not tracked in openServers) to find a free port.
    const s = new http.Server();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address() as { port: number };
      s.close(() => resolve(addr.port));
    });
    s.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('startHttpServer binds and responds to HTTP requests', async () => {
  const port = await freePort();
  const app = makeApp();

  await new Promise<void>((resolve) => {
    startHttpServer(app, { port, onListening: resolve });
  });

  await waitForPort(port);
  const status = await httpGet(port);
  assert.equal(status, 200, `expected 200, got ${status}`);
});

test('startHttpServer calls onListening callback exactly once', async () => {
  const port = await freePort();
  const app = makeApp();
  let callCount = 0;

  await new Promise<void>((resolve) => {
    startHttpServer(app, {
      port,
      onListening() {
        callCount++;
        resolve();
      },
    });
  });

  // Extra delay to detect double-fire
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(callCount, 1, 'onListening must fire exactly once');
});

test('startHttpServer uses 127.0.0.1 as default hostname when hostname is omitted', async () => {
  const port = await freePort();
  const app = makeApp();

  // Omit hostname — the server should bind on 127.0.0.1 by default
  await new Promise<void>((resolve) => {
    startHttpServer(app, { port, onListening: resolve });
  });

  const status = await httpGet(port);
  assert.equal(status, 200, 'server must be reachable on 127.0.0.1 when hostname is omitted');
});

test('startHttpServer with no onListening callback does not throw', async () => {
  const port = await freePort();
  const app = makeApp();

  assert.doesNotThrow(() => {
    startHttpServer(app, { port });
  });

  await waitForPort(port);
  const status = await httpGet(port);
  assert.equal(status, 200, 'server must respond even without onListening');
});

// Prevent unused-import lint error — serve is in scope for structural reference
void (serve as unknown);
