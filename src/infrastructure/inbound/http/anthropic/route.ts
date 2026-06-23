import type { Context } from 'hono';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import type { LoggerPort } from '../../../../domain/ports/logger-port.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';
import { toError, parseJsonBody, streamSseSafely } from '../shared.js';
import {
  anthropicRequestToFusion,
  fusionStreamToAnthropicSSE,
  fusionStreamToAnthropicResponse,
} from './translator.js';

export function createAnthropicRoute(fusionService: FusionService, logger?: LoggerPort) {
  return async (c: Context) => {
    const body = await parseJsonBody(c, logger, 'anthropic');
    if (body === null) {
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
    return streamSseSafely(
      c,
      logger,
      'anthropic',
      () => fusionStreamToAnthropicSSE(fusionService.runFusion(fusionRequest), model),
      (err) => {
        const message = err instanceof Error ? err.message : 'Internal server error';
        const errorType = err instanceof FusionError ? err.code : 'api_error';
        return `data: ${JSON.stringify({ error: { type: errorType, message } })}\n\n`;
      },
    );
  };
}
