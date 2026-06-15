import { serve } from '@hono/node-server';
import type { Hono } from 'hono';

export interface HttpServerOptions {
  readonly port: number;
  readonly hostname?: string;
}

/**
 * Start the Node HTTP server for the given Hono app. The `@hono/node-server`
 * dependency is confined to the inbound HTTP layer (NFR-2), so the composition
 * root (`main.ts`) bootstraps the server through this helper rather than
 * importing the Hono framework directly.
 */
export function startHttpServer(app: Hono, options: HttpServerOptions): void {
  serve({
    fetch: app.fetch,
    port: options.port,
    hostname: options.hostname ?? '127.0.0.1',
  });
}
