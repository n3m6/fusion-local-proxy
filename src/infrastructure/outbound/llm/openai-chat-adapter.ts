import OpenAI from 'openai';
import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../../domain/ports/logger-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  TokenUsage,
} from '../../../domain/model/chat-types.js';
import {
  type AdapterConfig,
  buildRequestLogFields,
  buildBaseLogFields,
  createStreamMetrics,
  onContentDelta,
  buildStreamResponseLogFields,
  buildCompleteResponseLogFields,
} from './adapter-support.js';

export type { AdapterConfig };

export function createOpenAiClient(config: AdapterConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}

type BaseCompletionParams = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  'stream'
>;

export class OpenAiChatAdapter implements ChatModelPort {
  constructor(
    private readonly client: OpenAI,
    private readonly adapterConfig: AdapterConfig,
    private readonly logger?: LoggerPort,
  ) {}

  private buildBaseParams(request: ChatRequest): BaseCompletionParams {
    const params: BaseCompletionParams = {
      model: request.model.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.options?.temperature,
      max_tokens: request.options?.maxTokens,
      top_p: request.options?.topP,
      stop: request.options?.stopSequences,
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

    return params;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    this.logger?.logRequest(buildRequestLogFields(request, 'openai', 'complete'));

    const response = await this.client.chat.completions.create(
      { ...this.buildBaseParams(request) },
      { signal: request.options?.signal },
    );

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';

    const usage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    this.logger?.logResponse(
      buildCompleteResponseLogFields(
        request,
        'openai',
        startTime,
        content,
        {
          prompt: usage.promptTokens,
          completion: usage.completionTokens,
          total: usage.totalTokens,
        },
        { finishReason: choice?.finish_reason },
      ),
    );

    return { content, usage, model: response.model };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const startTime = Date.now();
    this.logger?.logRequest(buildRequestLogFields(request, 'openai', 'stream'));

    const params = {
      ...this.buildBaseParams(request),
      stream: true,
      stream_options: { include_usage: true },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;

    const requestOptions = { signal: request.options?.signal };
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = (await this.client.chat.completions.create(
        params,
        requestOptions,
      )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    } catch (err) {
      if ((err as { status?: number })?.status === 400) {
        this.logger?.log('warn', 'openai_stream_retry_without_stream_options', {
          ...buildBaseLogFields(request, 'openai'),
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

    const metrics = createStreamMetrics();
    let stopYielded = false;
    let lastUsage: TokenUsage | undefined;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      if (choice?.delta?.content) {
        onContentDelta(metrics, choice.delta.content, startTime);
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

    this.logger?.logResponse(
      buildStreamResponseLogFields(
        request,
        'openai',
        metrics,
        startTime,
        lastUsage
          ? {
              prompt: lastUsage.promptTokens,
              completion: lastUsage.completionTokens,
              total: lastUsage.totalTokens,
            }
          : undefined,
      ),
    );
  }
}
