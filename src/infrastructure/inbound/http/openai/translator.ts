import { FusionError } from '../../../../domain/model/fusion-types.js';
import type { FusionRequest } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import type { ChatOptions } from '../../../../domain/model/chat-types.js';
import type { TokenUsage } from '../../../../domain/model/chat-types.js';

export function openAiRequestToFusion(body: Record<string, unknown>): FusionRequest {
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>).map((m) => ({
        role: String(m.role ?? 'user') as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }))
    : [];

  const model = typeof body.model === 'string' ? body.model : undefined;
  const stream = typeof body.stream === 'boolean' ? body.stream : undefined;
  const systemPrompt = typeof body.system === 'string' ? body.system : undefined;
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;
  const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : undefined;

  const options: ChatOptions = {};
  if (temperature !== undefined) {
    (options as Record<string, unknown>).temperature = temperature;
  }
  if (maxTokens !== undefined) {
    (options as Record<string, unknown>).maxTokens = maxTokens;
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
        throw new FusionError(
          event.code,
          event.message,
          typeof event.details === 'object' && event.details !== null
            ? (event.details as Record<string, unknown>)
            : undefined,
        );
      case 'progress':
        break;
    }
  }

  if (!doneReceived) {
    throw new FusionError('incomplete_stream', 'Stream completed without a done event');
  }

  const id = `chatcmpl-${crypto.randomUUID()}`;
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
