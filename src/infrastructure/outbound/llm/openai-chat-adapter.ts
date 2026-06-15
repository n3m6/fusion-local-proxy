import type OpenAI from 'openai';
import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type { ChatRequest, ChatResponse, ChatStreamChunk, TokenUsage } from '../../../domain/model/chat-types.js';

export class OpenAiChatAdapter implements ChatModelPort {
  constructor(private readonly client: OpenAI) {}

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

    const response = await this.client.chat.completions.create(params, { signal: request.options?.signal });

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

    const stream = await this.client.chat.completions.create(params, { signal: request.options?.signal });

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
