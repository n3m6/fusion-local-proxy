import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import type { LoggerPort } from '../../../../domain/ports/logger-port.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';
import { toError } from '../shared.js';
import {
  anthropicRequestToFusion,
  fusionStreamToAnthropicSSE,
  fusionStreamToAnthropicResponse,
} from './translator.js';

export function createAnthropicRoute(fusionService: FusionService, logger?: LoggerPort) {
  return async (c: Context) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      logger?.log('warn', 'http_invalid_json', { api: 'anthropic' });
      return c.json(
        { error: { type: 'invalid_request_error', message: 'Invalid JSON body' } },
        400,
      );
    }

    const model = typeof body.model === 'string' ? body.model : '';
    const fusionRequest = anthropicRequestToFusion(body);

    logger?.log('info', 'http_request', {
      api: 'anthropic',
      requestedModel: model,
      stream: body.stream !== false,
      messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    });

    // Non-streaming path: explicit `stream: false` → buffer and return JSON
    if (body.stream === false) {
      try {
        const events = fusionService.runFusion(fusionRequest);
        const response = await fusionStreamToAnthropicResponse(events, model);
        return c.json(response);
      } catch (err) {
        logger?.logError('http', toError(err), { api: 'anthropic', stream: false });
        const message = err instanceof Error ? err.message : 'Internal server error';
        const errorType = err instanceof FusionError ? err.code : 'api_error';
        return c.json({ error: { type: errorType, message } }, 500);
      }
    }

    // Streaming path (default): `stream: true` or absent → SSE
    return streamSSE(c, async (stream) => {
      try {
        const events = fusionService.runFusion(fusionRequest);
        for await (const sseString of fusionStreamToAnthropicSSE(events, model)) {
          await stream.write(sseString);
        }
      } catch (err) {
        logger?.logError('http', toError(err), { api: 'anthropic', stream: true });
        const message = err instanceof Error ? err.message : 'Internal server error';
        const errorType = err instanceof FusionError ? err.code : 'api_error';
        const errorPayload = JSON.stringify({
          error: { type: errorType, message },
        });
        await stream.write(`data: ${errorPayload}\n\n`);
      }
    });
  };
}
