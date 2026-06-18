import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import type { AgentService } from '../../../../application/ports/agent-service.js';
import type { LoggerPort } from '../../../../domain/ports/logger-port.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';
import { toError } from '../shared.js';
import {
  openAiRequestToFusion,
  fusionStreamToOpenAiResponse,
  fusionStreamToOpenAiSSE,
} from './translator.js';

export function createOpenAiRoute(
  fusionService: FusionService,
  agentService?: AgentService | null,
  logger?: LoggerPort,
) {
  return async (c: Context) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      logger?.log('warn', 'http_invalid_json', { api: 'openai' });
      return c.json({ error: { message: 'Invalid JSON body' } }, 400);
    }

    const model = typeof body.model === 'string' ? body.model : '';
    const streaming = Boolean(body.stream);
    const hasTools = Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;

    logger?.log('info', 'http_request', {
      api: 'openai',
      requestedModel: model,
      stream: streaming,
      messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
      hasTools,
    });

    if (hasTools && !agentService) {
      return c.json(
        {
          error: {
            code: 'agent_not_configured',
            message:
              'Tool calling requires an agent model. Add an openai provider with role "agent" to your config, or ensure the first panel provider has type "openai".',
          },
        },
        501,
      );
    }

    const fusionRequest = openAiRequestToFusion(body);
    const getEvents = () =>
      hasTools && agentService
        ? agentService.runAgent(fusionRequest)
        : fusionService.runFusion(fusionRequest);

    if (streaming) {
      return streamSSE(c, async (stream) => {
        try {
          const events = getEvents();
          for await (const sseString of fusionStreamToOpenAiSSE(events, model)) {
            await stream.write(sseString);
          }
        } catch (err) {
          logger?.logError('http', toError(err), { api: 'openai', stream: true });
          const message = err instanceof FusionError ? err.message : 'Internal server error';
          const code = err instanceof FusionError ? err.code : 'internal_error';
          await stream.write(`data: ${JSON.stringify({ error: { code, message } })}\n\n`);
        }
      });
    }

    try {
      const events = getEvents();
      const response = await fusionStreamToOpenAiResponse(events, model);
      return c.json(response);
    } catch (err) {
      logger?.logError('http', toError(err), { api: 'openai', stream: false });

      if (err instanceof FusionError) {
        return c.json(
          {
            error: {
              message: err.message,
              code: err.code,
              details: err.details,
            },
          },
          500,
        );
      }

      return c.json({ error: { message: 'Internal server error' } }, 500);
    }
  };
}
