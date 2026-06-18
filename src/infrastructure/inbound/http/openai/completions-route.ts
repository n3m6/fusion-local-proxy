import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { TextCompletionPort } from '../../../../domain/ports/text-completion-port.js';
import type { ModelRef } from '../../../../domain/model/fusion-types.js';
import type { LoggerPort } from '../../../../domain/ports/logger-port.js';
import { toError } from '../shared.js';
import {
  parseTextCompletionRequest,
  textCompletionToResponse,
  textCompletionToSSE,
} from './completions-translator.js';

export function createCompletionsRoute(
  textCompletionPort?: TextCompletionPort | null,
  autocompleteModel?: ModelRef | null,
  logger?: LoggerPort,
) {
  return async (c: Context) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      logger?.log('warn', 'http_invalid_json', { api: 'openai_completions' });
      return c.json({ error: { message: 'Invalid JSON body' } }, 400);
    }

    if (!textCompletionPort || !autocompleteModel) {
      return c.json(
        {
          error: {
            code: 'autocomplete_not_configured',
            message:
              'Text completion requires an autocomplete model. Add an openai provider with role "autocomplete" to your config, or ensure the first panel provider has type "openai".',
          },
        },
        501,
      );
    }

    const streaming = Boolean(body.stream);
    const request = parseTextCompletionRequest(body, autocompleteModel);

    logger?.log('info', 'http_request', {
      api: 'openai_completions',
      requestedModel: typeof body.model === 'string' ? body.model : '',
      stream: streaming,
      promptChars: typeof body.prompt === 'string' ? body.prompt.length : 0,
    });

    if (streaming) {
      return streamSSE(c, async (stream) => {
        try {
          const chunks = textCompletionPort.stream(request);
          for await (const sseString of textCompletionToSSE(chunks, autocompleteModel.model)) {
            await stream.write(sseString);
          }
        } catch (err) {
          logger?.logError('http', toError(err), { api: 'openai_completions', stream: true });
          await stream.write(
            `data: ${JSON.stringify({ error: { message: 'Internal server error' } })}\n\n`,
          );
        }
      });
    }

    try {
      const response = await textCompletionPort.complete(request);
      return c.json(textCompletionToResponse(response, autocompleteModel.model));
    } catch (err) {
      logger?.logError('http', toError(err), { api: 'openai_completions', stream: false });
      return c.json({ error: { message: 'Internal server error' } }, 500);
    }
  };
}
