import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';
import { openAiRequestToFusion, fusionStreamToOpenAiResponse, fusionStreamToOpenAiSSE } from './translator.js';

export function createOpenAiRoute(fusionService: FusionService) {
  return async (c: Context) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ error: { message: 'Invalid JSON body' } }, 400);
    }

    const model = typeof body.model === 'string' ? body.model : '';

    const fusionRequest = openAiRequestToFusion(body);

    if (body.stream) {
      return streamSSE(c, async (stream) => {
        try {
          const events = fusionService.runFusion(fusionRequest);
          for await (const sseString of fusionStreamToOpenAiSSE(events, model)) {
            await stream.write(sseString);
          }
        } catch (err) {
          const message = err instanceof FusionError ? err.message : 'Internal server error';
          const code = err instanceof FusionError ? err.code : 'internal_error';
          await stream.write(`data: ${JSON.stringify({ error: { code, message } })}\n\n`);
        }
      });
    }

    try {
      const events = fusionService.runFusion(fusionRequest);
      const response = await fusionStreamToOpenAiResponse(events, model);
      return c.json(response);
    } catch (err) {
      console.error('Chat completion error:', err);

      if (err instanceof FusionError) {
        return c.json({
          error: {
            message: err.message,
            code: err.code,
            details: err.details,
          },
        }, 500);
      }

      return c.json({ error: { message: 'Internal server error' } }, 500);
    }
  };
}
