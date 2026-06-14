import { FusionError } from '../../../../domain/model/fusion-types.js';
import type { FusionRequest } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import type { ChatOptions } from '../../../../domain/model/chat-types.js';

export function openAiRequestToFusion(body: Record<string, unknown>): FusionRequest {
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>).map((m) => ({
        role: String(m.role ?? 'user') as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }))
    : [];

  const model = typeof body.model === 'string' ? body.model : undefined;
  const stream = typeof body.stream === 'boolean' ? body.stream : undefined;
  const system = typeof body.system === 'string' ? body.system : undefined;

  const options: ChatOptions = {};
  if (typeof body.temperature === 'number') {
    options.temperature = body.temperature;
  }
  if (typeof body.max_tokens === 'number') {
    options.maxTokens = body.max_tokens;
  }

  return {
    messages,
    model,
    stream,
    system,
    options: Object.keys(options).length > 0 ? options : undefined,
  };
}

export async function fusionStreamToOpenAiResponse(
  events: AsyncIterable<FusionStreamEvent>,
): Promise<Record<string, unknown>> {
  let content = '';
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let model = '';
  const failedModels: Array<{ model: string; reason: string }> = [];

  for await (const event of events) {
    switch (event.type) {
      case 'content_delta':
        content += event.delta;
        break;
      case 'content_stop':
        // marker event, no accumulation needed
        break;
      case 'done':
        usage = event.usage;
        failedModels.push(...event.failedModels);
        if (event.model) {
          model = event.model;
        }
        break;
      case 'error':
        throw new FusionError(event.code, event.message, event.details);
      case 'progress':
        // progress events are informational, skip
        break;
      default:
        break;
    }
  }

  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    id,
    object: 'chat.completion',
    created,
    model: model || '',
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
