import OpenAI from 'openai';
import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../../domain/ports/logger-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  TokenUsage,
} from '../../../domain/model/chat-types.js';
import type { Message } from '../../../domain/model/message.js';
import { FusionError } from '../../../domain/model/fusion-types.js';
import {
  type AdapterConfig,
  buildRequestLogFields,
  buildBaseLogFields,
  createStreamMetrics,
  onContentDelta,
  onReasoningDelta,
  buildStreamResponseLogFields,
  buildCompleteResponseLogFields,
  parseOpenAiUsage,
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

function toSdkMessage(m: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === 'tool') {
    if (m.toolCallId === undefined || m.toolCallId === '') {
      throw new FusionError(
        'invalid_tool_message',
        'A tool-role message is missing tool_call_id. Each tool result must include the id of the preceding assistant tool call it responds to.',
      );
    }
    return {
      role: 'tool',
      content: m.content,
      tool_call_id: m.toolCallId,
    };
  }
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }
  return {
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  };
}

function buildResponseFormat(
  request: ChatRequest,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming['response_format'] | undefined {
  const rf = request.options?.responseFormat;
  if (!rf) return undefined;
  if (rf.type === 'json_object') return { type: 'json_object' };
  if (rf.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema: rf.schema },
    };
  }
  return undefined;
}

function buildTools(
  request: ChatRequest,
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  const tools = request.options?.tools;
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      ...(t.parameters !== undefined ? { parameters: t.parameters } : {}),
    },
  }));
}

function buildToolChoice(
  request: ChatRequest,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming['tool_choice'] | undefined {
  const tc = request.options?.toolChoice;
  if (tc === undefined) return undefined;
  if (tc === 'none' || tc === 'auto' || tc === 'required') return tc;
  return { type: 'function', function: { name: tc.function.name } };
}

export class OpenAiChatAdapter implements ChatModelPort {
  constructor(
    private readonly client: OpenAI,
    private readonly logger?: LoggerPort,
  ) {}

  private buildBaseParams(request: ChatRequest): BaseCompletionParams {
    const params: BaseCompletionParams = {
      model: request.model.model,
      messages: request.messages.map(toSdkMessage),
      temperature: request.options?.temperature,
      max_tokens: request.options?.maxTokens,
      top_p: request.options?.topP,
      stop: request.options?.stopSequences,
    };

    const ts = request.model.thinkingStrength;
    if (ts !== undefined && ts !== 'off') {
      params.reasoning_effort = ts;
    }

    const responseFormat = buildResponseFormat(request);
    if (responseFormat !== undefined) {
      params.response_format = responseFormat;
    }

    const tools = buildTools(request);
    if (tools !== undefined) {
      params.tools = tools;
    }

    const toolChoice = buildToolChoice(request);
    if (toolChoice !== undefined) {
      params.tool_choice = toolChoice;
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

    // The OpenAI SDK type omits reasoning fields; access them via casts.
    // DeepSeek-compatible backends echo the reasoning text on `message.reasoning_content`.
    const reasoningContent = (choice?.message as unknown as Record<string, unknown> | undefined)
      ?.reasoning_content;
    const reasoningChars = typeof reasoningContent === 'string' ? reasoningContent.length : 0;

    const usage: TokenUsage = response.usage
      ? parseOpenAiUsage(response.usage)
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    type SdkFunctionToolCall = {
      id: string;
      type: string;
      function?: { name: string; arguments: string };
    };
    const sdkToolCalls = choice?.message?.tool_calls as SdkFunctionToolCall[] | undefined;
    const toolCalls = sdkToolCalls
      ?.filter((tc) => tc.function !== undefined)
      .map((tc) => ({
        id: tc.id,
        name: tc.function!.name,
        arguments: tc.function!.arguments,
      }));

    const finishReason = choice?.finish_reason ?? undefined;

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
          ...(usage.reasoningTokens !== undefined ? { reasoning: usage.reasoningTokens } : {}),
          ...(usage.cachedPromptTokens !== undefined ? { cached: usage.cachedPromptTokens } : {}),
        },
        {
          finishReason,
          ...(reasoningChars > 0 ? { reasoningChars } : {}),
        },
      ),
    );

    return {
      content,
      usage,
      model: response.model,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      ...(finishReason !== undefined ? { finishReason } : {}),
    };
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

      // Detect reasoning_content (DeepSeek-compatible extended reasoning field).
      // The OpenAI SDK type does not include this field; access it via a cast.
      // This must be checked BEFORE content: some backends (e.g. vLLM-served
      // DeepSeek) populate both fields in a single chunk, and reasoning_progress
      // must precede the first content_delta.
      const deltaExt = choice?.delta as Record<string, unknown> | undefined;
      if (
        typeof deltaExt?.reasoning_content === 'string' &&
        deltaExt.reasoning_content.length > 0
      ) {
        onReasoningDelta(metrics, deltaExt.reasoning_content);
        yield { type: 'reasoning_progress' };
      }

      const toolCallDeltas = choice?.delta?.tool_calls;
      if (toolCallDeltas) {
        for (const tc of toolCallDeltas) {
          yield {
            type: 'tool_call_delta',
            index: tc.index,
            ...(tc.id !== undefined ? { id: tc.id } : {}),
            ...(tc.function?.name !== undefined && tc.function.name !== ''
              ? { name: tc.function.name }
              : {}),
            ...(tc.function?.arguments !== undefined && tc.function.arguments !== ''
              ? { argumentsDelta: tc.function.arguments }
              : {}),
          };
        }
      }

      if (choice?.delta?.content) {
        onContentDelta(metrics, choice.delta.content, startTime);
        yield { type: 'content_delta', delta: choice.delta.content };
      }

      if (choice?.finish_reason) {
        yield { type: 'content_stop', finishReason: choice.finish_reason };
        stopYielded = true;
      }

      if (chunk.usage) {
        lastUsage = parseOpenAiUsage(chunk.usage);
        yield { type: 'usage', usage: lastUsage };
      }
    }

    if (!stopYielded) {
      yield { type: 'content_stop', finishReason: 'stop' };
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
              ...(lastUsage.reasoningTokens !== undefined
                ? { reasoning: lastUsage.reasoningTokens }
                : {}),
              ...(lastUsage.cachedPromptTokens !== undefined
                ? { cached: lastUsage.cachedPromptTokens }
                : {}),
            }
          : undefined,
      ),
    );
  }
}
