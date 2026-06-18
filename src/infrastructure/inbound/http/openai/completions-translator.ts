import { randomUUID } from 'node:crypto';
import type { ModelRef } from '../../../../domain/model/fusion-types.js';
import type {
  TextCompletionRequest,
  TextCompletionResponse,
  TextCompletionChunk,
} from '../../../../domain/model/text-completion-types.js';
import { encodeTextCompletionSSE } from './completions-sse-encoder.js';

export function parseTextCompletionRequest(
  body: Record<string, unknown>,
  model: ModelRef,
): TextCompletionRequest {
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const suffix = typeof body.suffix === 'string' ? body.suffix : undefined;
  const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : undefined;
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;

  const rawStop = body.stop;
  const stop = Array.isArray(rawStop)
    ? (rawStop as unknown[]).filter((s): s is string => typeof s === 'string')
    : typeof rawStop === 'string'
      ? rawStop
      : undefined;

  return {
    model,
    prompt,
    ...(suffix !== undefined ? { suffix } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(stop !== undefined ? { stop } : {}),
  };
}

export function textCompletionToResponse(
  response: TextCompletionResponse,
  requestedModel: string,
): Record<string, unknown> {
  const id = `cmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  return {
    id,
    object: 'text_completion',
    created,
    model: requestedModel,
    choices: [
      {
        text: response.text,
        index: 0,
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: response.usage.promptTokens,
      completion_tokens: response.usage.completionTokens,
      total_tokens: response.usage.totalTokens,
    },
  };
}

export function textCompletionToSSE(
  chunks: AsyncIterable<TextCompletionChunk>,
  model: string,
): AsyncIterable<string> {
  return encodeTextCompletionSSE(chunks, model);
}
