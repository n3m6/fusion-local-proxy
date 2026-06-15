import { randomUUID } from 'node:crypto';
import type { FusionRequest } from '../../../../domain/model/fusion-types.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import type { ChatOptions } from '../../../../domain/model/chat-types.js';
import { encodeAnthropicSSE } from './sse-encoder.js';

export function anthropicRequestToFusion(body: Record<string, unknown>): FusionRequest {
  let systemPrompt: string | undefined;
  if (typeof body.system === 'string') {
    systemPrompt = body.system;
  } else if (Array.isArray(body.system)) {
    const texts: string[] = [];
    for (const block of body.system as Array<Record<string, unknown>>) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text);
      }
    }
    systemPrompt = texts.length > 0 ? texts.join('\n') : undefined;
  }

  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>).map((m) => {
        const role = typeof m.role === 'string' && (m.role === 'user' || m.role === 'assistant')
          ? m.role
          : 'user';
        let content: string;
        if (typeof m.content === 'string') {
          content = m.content;
        } else if (Array.isArray(m.content)) {
          const texts: string[] = [];
          for (const block of m.content as Array<Record<string, unknown>>) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              texts.push(block.text);
            }
          }
          content = texts.join('');
        } else {
          content = '';
        }
        return { role, content } as { role: 'user' | 'assistant'; content: string };
      })
    : [];

  const model = typeof body.model === 'string' ? body.model : undefined;
  const stream = typeof body.stream === 'boolean' ? body.stream : undefined;
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;
  const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : undefined;

  const options: ChatOptions = {};
  if (temperature !== undefined) {
    (options as Record<string, unknown>).temperature = temperature;
  }
  if (maxTokens !== undefined) {
    (options as Record<string, unknown>).maxTokens = maxTokens;
  }
  if (typeof body.top_p === 'number') {
    (options as Record<string, unknown>).top_p = body.top_p;
  }
  if (typeof body.top_k === 'number') {
    (options as Record<string, unknown>).top_k = body.top_k;
  }
  if (Array.isArray(body.stop_sequences)) {
    (options as Record<string, unknown>).stop_sequences = body.stop_sequences;
  }
  if (body.metadata !== undefined && body.metadata !== null) {
    (options as Record<string, unknown>).metadata = body.metadata;
  }

  return {
    messages,
    model,
    stream,
    systemPrompt,
    temperature,
    maxTokens,
    options: Object.keys(options).length > 0 ? options : undefined,
  };
}

export async function* fusionStreamToAnthropicSSE(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): AsyncIterable<string> {
  yield* encodeAnthropicSSE(events, model);
}

/**
 * Buffers all fusion stream events and returns a single Anthropic Messages
 * response object (for `stream: false` requests).
 */
export async function fusionStreamToAnthropicResponse(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): Promise<Record<string, unknown>> {
  const messageId = `msg_${randomUUID()}`;
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let actualModel = model;

  for await (const event of events) {
    switch (event.type) {
      case 'content_delta':
        text += event.delta;
        break;
      case 'done':
        inputTokens = event.usage?.promptTokens ?? 0;
        outputTokens = event.usage?.completionTokens ?? 0;
        if (event.model) actualModel = event.model;
        break;
      case 'error':
        throw new FusionError(
          event.code,
          event.message,
          typeof event.details === 'object' && event.details !== null
            ? (event.details as Record<string, unknown>)
            : undefined,
        );
      default:
        break;
    }
  }

  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    model: actualModel,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}
