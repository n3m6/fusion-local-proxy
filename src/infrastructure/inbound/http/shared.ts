import { FusionError } from '../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../domain/model/stream-types.js';

export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

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
