import OpenAI from 'openai';
import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  TokenUsage,
} from '../../../domain/model/chat-types.js';

export interface AdapterConfig {
  readonly baseURL: string;
  readonly apiKey: string;
}

/**
 * Construct the OpenAI SDK client. Kept here (rather than in the factory) so the
 * `openai` SDK import stays confined to this adapter module (NFR-3).
 */
export function createOpenAiClient(config: AdapterConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}

export class OpenAiChatAdapter implements ChatModelPort {
  constructor(private readonly client: OpenAI) {}

  get config(): AdapterConfig {
    return {
      baseURL: (this.client as unknown as { baseURL?: string }).baseURL ?? '',
      apiKey: (this.client as unknown as { apiKey?: string }).apiKey ?? '',
    };
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: request.model.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.options?.temperature,
      max_tokens: request.options?.maxTokens,
    };

    if (request.options?.responseFormat) {
      const rf = request.options.responseFormat;
      if (rf.type === 'json_object') {
        params.response_format = { type: 'json_object' };
      } else if (rf.type === 'json_schema') {
        params.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            strict: true,
            schema: rf.schema,
          },
        };
      }
    }

    const response = await this.client.chat.completions.create(params, {
      signal: request.options?.signal,
    });

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';

    const usage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    return {
      content,
      usage,
      model: response.model,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: request.model.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.options?.temperature,
      max_tokens: request.options?.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.options?.responseFormat) {
      const rf = request.options.responseFormat;
      if (rf.type === 'json_object') {
        params.response_format = { type: 'json_object' };
      } else if (rf.type === 'json_schema') {
        params.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            strict: true,
            schema: rf.schema,
          },
        };
      }
    }

    const requestOptions = { signal: request.options?.signal };
    // Use the streaming-specific overload signature so `for await` resolves correctly
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = (await this.client.chat.completions.create(
        params as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        requestOptions,
      )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    } catch (err) {
      if ((err as { status?: number })?.status === 400) {
        // Some backends reject stream_options; retry once without it
        const { stream_options: _dropped, ...paramsWithoutStreamOptions } = params;
        stream = (await this.client.chat.completions.create(
          paramsWithoutStreamOptions as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
          requestOptions,
        )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      } else {
        throw err;
      }
    }

    let stopYielded = false;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      if (choice?.delta?.content) {
        yield { type: 'content_delta', delta: choice.delta.content };
      }

      if (choice?.finish_reason) {
        yield { type: 'content_stop' };
        stopYielded = true;
      }

      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          },
        };
      }
    }

    if (!stopYielded) {
      yield { type: 'content_stop' };
    }
  }
}
