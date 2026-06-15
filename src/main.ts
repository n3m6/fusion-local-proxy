import { serve } from '@hono/node-server';
import { createApp } from './infrastructure/di/container.js';

export function resolvePort(): number {
  return Number(process.env.PORT) || 3000;
}

export function main(): void {
  const port = resolvePort();
  const { app } = createApp();

  console.log(JSON.stringify({ event: 'starting', port }));

  serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1',
  });

  console.log(`Server listening on http://localhost:${port}`);
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
