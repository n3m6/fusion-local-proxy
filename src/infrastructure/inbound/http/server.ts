import { Hono } from 'hono';
import type { FusionService } from '../../../application/ports/fusion-service.js';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import { createOpenAiRoute } from './openai/route.js';
import { createModelsRoute } from './models-route.js';

export function createServer(fusionService: FusionService, configPort: ConfigPort): Hono {
  const app = new Hono();

  app.post('/v1/chat/completions', createOpenAiRoute(fusionService));
  app.get('/v1/models', createModelsRoute(configPort));

  return app;
}
