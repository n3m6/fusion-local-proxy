import type { Context } from 'hono';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import { openAiRequestToFusion, fusionStreamToOpenAiResponse } from './translator.js';

export function createOpenAiRoute(fusionService: FusionService) {
  return async (c: Context) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ error: { message: 'Invalid JSON body' } }, 400);
    }

    const fusionRequest = openAiRequestToFusion(body);

    try {
      const events = fusionService.runFusion(fusionRequest);
      const response = await fusionStreamToOpenAiResponse(events);
      return c.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { message } }, 500);
    }
  };
}
