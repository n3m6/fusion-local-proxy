import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { FusionError, toError } from '../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../domain/model/stream-types.js';
import type { LoggerPort } from '../../../domain/ports/logger-port.js';

export { toError };

export function errorEventToFusionError(
  event: Extract<FusionStreamEvent, { type: 'error' }>,
): FusionError {
  return new FusionError(
    event.code,
    event.message,
    typeof event.details === 'object' && event.details !== null
      ? (event.details as Record<string, unknown>)
      : undefined,
  );
}

/**
 * Parse the JSON request body. Returns `null` and logs a warning on failure;
 * the caller is responsible for returning the appropriate 400 response.
 */
export async function parseJsonBody(
  c: Context,
  logger: LoggerPort | undefined,
  api: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await c.req.json<Record<string, unknown>>();
  } catch {
    logger?.log('warn', 'http_invalid_json', { api });
    return null;
  }
}

/**
 * Wrap a streaming SSE handler with consistent error handling. The `produce`
 * callback returns the SSE string iterable; `formatError` converts a thrown
 * error into the SSE-encoded error string to flush to the client.
 */
export function streamSseSafely(
  c: Context,
  logger: LoggerPort | undefined,
  api: string,
  produce: () => AsyncIterable<string>,
  formatError: (err: unknown) => string,
): Response {
  return streamSSE(c, async (stream) => {
    try {
      for await (const sseString of produce()) {
        await stream.write(sseString);
      }
    } catch (err) {
      logger?.logError('http', toError(err), { api, stream: true });
      await stream.write(formatError(err));
    }
  });
}

export function parseCommonRequestFields(body: Record<string, unknown>): {
  model: string | undefined;
  stream: boolean | undefined;
  temperature: number | undefined;
  maxTokens: number | undefined;
  topP: number | undefined;
} {
  return {
    model: typeof body.model === 'string' ? body.model : undefined,
    stream: typeof body.stream === 'boolean' ? body.stream : undefined,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
    topP: typeof body.top_p === 'number' ? body.top_p : undefined,
  };
}
