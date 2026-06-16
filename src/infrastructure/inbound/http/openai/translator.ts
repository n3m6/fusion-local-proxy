import { randomUUID } from 'node:crypto';
import type { FusionRequest } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import type { TokenUsage } from '../../../../domain/model/chat-types.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';
import { errorEventToFusionError, parseCommonRequestFields } from '../shared.js';
import { encodeOpenAiSSE } from './sse-encoder.js';

export function openAiRequestToFusion(body: Record<string, unknown>): FusionRequest {
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>).map((m) => ({
        role: String(m.role ?? 'user') as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }))
    : [];

  const { model, stream, temperature, maxTokens, topP } = parseCommonRequestFields(body);
  const systemPrompt = typeof body.system === 'string' ? body.system : undefined;
  const rawStop = body.stop;
  const stopSequences = Array.isArray(rawStop)
    ? (rawStop as unknown[]).filter((s): s is string => typeof s === 'string')
    : typeof rawStop === 'string'
      ? [rawStop]
      : undefined;

  return {
    messages,
    model,
    stream,
    systemPrompt,
    temperature,
    maxTokens,
    ...(topP !== undefined ? { topP } : {}),
    ...(stopSequences !== undefined && stopSequences.length > 0 ? { stopSequences } : {}),
  };
}

export async function fusionStreamToOpenAiResponse(
  events: AsyncIterable<FusionStreamEvent>,
  model?: string,
): Promise<Record<string, unknown>> {
  let content = '';
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let eventModel = '';
  let doneReceived = false;

  for await (const event of events) {
    switch (event.type) {
      case 'content_delta':
        content += event.delta;
        break;
      case 'content_stop':
        break;
      case 'done':
        doneReceived = true;
        usage = {
          promptTokens: event.usage?.promptTokens ?? 0,
          completionTokens: event.usage?.completionTokens ?? 0,
          totalTokens: event.usage?.totalTokens ?? 0,
        };
        if (event.model) {
          eventModel = event.model;
        }
        break;
      case 'error':
        throw errorEventToFusionError(event);
      case 'progress':
        break;
    }
  }

  if (!doneReceived) {
    throw new FusionError('incomplete_stream', 'Stream completed without a done event');
  }

  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    id,
    object: 'chat.completion',
    created,
    model: model ?? (eventModel || ''),
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    },
  };
}

export function fusionStreamToOpenAiSSE(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): AsyncIterable<string> {
  return encodeOpenAiSSE(events, model);
}
