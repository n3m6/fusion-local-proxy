import OpenAI from 'openai';
import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type { LoggerPort, LogFields } from '../../../domain/ports/logger-port.js';
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

function promptChars(request: ChatRequest): number {
  return request.messages.reduce((sum, m) => sum + m.content.length, 0);
}

export class OpenAiChatAdapter implements ChatModelPort {
  constructor(
    private readonly client: OpenAI,
    private readonly logger?: LoggerPort,
  ) {}

  get config(): AdapterConfig {
    return {
      baseURL: (this.client as unknown as { baseURL?: string }).baseURL ?? '',
      apiKey: (this.client as unknown as { apiKey?: string }).apiKey ?? '',
    };
  }

  private baseFields(request: ChatRequest): LogFields {
    return {
      provider: 'openai',
      modelId: request.model.model,
      baseURL: request.model.baseURL,
      requestId: request.options?.requestId,
      stage: request.options?.stage,
    };
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    this.logger?.logRequest({
      ...this.baseFields(request),
      mode: 'complete',
      messageCount: request.messages.length,
      promptChars: promptChars(request),
      temperature: request.options?.temperature,
      maxTokens: request.options?.maxTokens,
      responseFormat: request.options?.responseFormat?.type,
      thinkingStrength: request.model.thinkingStrength,
      // Full prompt; only surfaces at debug level (logRequest is debug).
      prompt: request.messages,
    });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: request.model.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.options?.temperature,
      max_tokens: request.options?.maxTokens,
    };

    const ts = request.model.thinkingStrength;
    if (ts !== undefined && ts !== 'off') {
      params.reasoning_effort = ts;
    }

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

    this.logger?.logResponse({
      ...this.baseFields(request),
      mode: 'complete',
      latencyMs: Date.now() - startTime,
      contentChars: content.length,
      finishReason: choice?.finish_reason,
      tokens: {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        total: usage.totalTokens,
      },
      // Full response text; only surfaces at debug level (logResponse is debug).
      content,
    });

    return {
      content,
      usage,
      model: response.model,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const startTime = Date.now();
    this.logger?.logRequest({
      ...this.baseFields(request),
      mode: 'stream',
      messageCount: request.messages.length,
      promptChars: promptChars(request),
      temperature: request.options?.temperature,
      maxTokens: request.options?.maxTokens,
      responseFormat: request.options?.responseFormat?.type,
      thinkingStrength: request.model.thinkingStrength,
      // Full prompt; only surfaces at debug level (logRequest is debug).
      prompt: request.messages,
    });

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

    const ts = request.model.thinkingStrength;
    if (ts !== undefined && ts !== 'off') {
      params.reasoning_effort = ts;
    }

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
        this.logger?.log('warn', 'openai_stream_retry_without_stream_options', {
          ...this.baseFields(request),
        });
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
    let deltaCount = 0;
    let contentChars = 0;
    let ttftMs: number | undefined;
    let lastUsage: TokenUsage | undefined;
    let fullContent = '';
    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      if (choice?.delta?.content) {
        if (ttftMs === undefined) {
          ttftMs = Date.now() - startTime;
        }
        deltaCount++;
        contentChars += choice.delta.content.length;
        fullContent += choice.delta.content;
        yield { type: 'content_delta', delta: choice.delta.content };
      }

      if (choice?.finish_reason) {
        yield { type: 'content_stop' };
        stopYielded = true;
      }

      if (chunk.usage) {
        lastUsage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
        yield { type: 'usage', usage: lastUsage };
      }
    }

    if (!stopYielded) {
      yield { type: 'content_stop' };
    }

    this.logger?.logResponse({
      ...this.baseFields(request),
      mode: 'stream',
      latencyMs: Date.now() - startTime,
      ttftMs,
      deltaCount,
      contentChars,
      tokens: lastUsage
        ? {
            prompt: lastUsage.promptTokens,
            completion: lastUsage.completionTokens,
            total: lastUsage.totalTokens,
          }
        : undefined,
      // Full streamed response text; only surfaces at debug level.
      content: fullContent,
    });
  }
}
