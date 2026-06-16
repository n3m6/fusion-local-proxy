import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FusionService } from '../../../application/ports/fusion-service.js';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import type { LoggerPort } from '../../../domain/ports/logger-port.js';
import { createOpenAiRoute } from './openai/route.js';
import { createModelsRoute } from './models-route.js';
import { createAnthropicRoute } from './anthropic/route.js';

// Resolve the dev UI file relative to this module, not process.cwd(), so the
// page is found regardless of the directory the server is launched from.
// This file lives at src/infrastructure/inbound/http/, so public/ is four levels up.
const DEV_UI_HTML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../public/index.html',
);

export interface CreateServerOptions {
  readonly enableDevUi?: boolean;
  readonly logger?: LoggerPort;
}

export function createServer(
  fusionService: FusionService,
  configPort: ConfigPort,
  options: CreateServerOptions = {},
): Hono {
  const app = new Hono();

  app.post('/v1/chat/completions', createOpenAiRoute(fusionService, options.logger));
  app.get('/v1/models', createModelsRoute(configPort));
  app.post('/v1/messages', createAnthropicRoute(fusionService, options.logger));

  if (options.enableDevUi) {
    app.get('/', serveStatic({ path: DEV_UI_HTML_PATH }));
  }

  return app;
}
