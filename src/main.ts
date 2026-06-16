import { createApp } from './infrastructure/di/container.js';
import { startHttpServer } from './infrastructure/inbound/http/node-server.js';

const DEFAULT_PORT = 3000;

export function resolvePort(): number {
  return Number(process.env.PORT) || DEFAULT_PORT;
}

export function main(): void {
  const port = resolvePort();
  const { app } = createApp();

  console.log(JSON.stringify({ event: 'starting', port }));

  startHttpServer(app, { port });

  console.log(`Server listening on http://localhost:${port}`);
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
