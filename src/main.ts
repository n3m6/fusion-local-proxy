import { serve } from '@hono/node-server';
import { createApp } from './infrastructure/di/container.js';

const port = Number(process.env.PORT) || 3000;

const { app } = createApp();

console.log(JSON.stringify({ event: 'starting', port }));

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server listening on http://localhost:${port}`);
