import Anthropic from '@anthropic-ai/sdk';
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
  createStreamMetrics,
  onContentDelta,
  buildStreamResponseLogFields,
  buildCompleteResponseLogFields,
} from './adapter-support.js';

export type { AdapterConfig };

const THINKING_BUDGETS: Readonly<Record<string, number>> = {
  low: 1024,
  medium: 4096,
  high: 12000,
  xhigh: 24000,
};
const THINKING_BUDGET_FALLBACK = 1024;
const DEFAULT_MAX_TOKENS = 4096;
const THINKING_MAX_TOKENS_MARGIN = 4096;

export function createAnthropicClient(config: AdapterConfig): Anthropic {
  return new Anthropic({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}

export class AnthropicChatAdapter implements ChatModelPort {
  constructor(
    private readonly client: Anthropic,
    private readonly adapterConfig: AdapterConfig,
    private readonly logger?: LoggerPort,
  ) {}

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    this.logger?.logRequest(buildRequestLogFields(request, 'anthropic', 'complete'));

    const params = this.buildCreateParams(request);
    const response = await this.client.messages.create(params, {
      signal: request.options?.signal,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock) {
      this.logger?.log('warn', 'anthropic_no_text_content_block', {
        provider: 'anthropic',
        modelId: request.model.model,
        baseURL: request.model.baseURL,
        requestId: request.options?.requestId,
        stage: request.options?.stage,
        blockTypes: response.content.map((b) => b.type),
      });
      throw new Error('Anthropic response contained no text content block');
    }
    const content = textBlock.text;

    const usage: TokenUsage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    this.logger?.logResponse(
      buildCompleteResponseLogFields(request, 'anthropic', startTime, content, {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        total: usage.totalTokens,
      }),
    );

    return { content, usage, model: response.model };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const startTime = Date.now();
    this.logger?.logRequest(buildRequestLogFields(request, 'anthropic', 'stream'));

    const params = this.buildCreateParams(request);
    const messageStream = this.client.messages.stream(params as Anthropic.MessageStreamParams, {
      signal: request.options?.signal,
    });

    const metrics = createStreamMetrics();
    let stopYielded = false;
    let usageYielded = false;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of messageStream) {
      switch (event.type) {
        case 'message_start':
          inputTokens = event.message.usage.input_tokens;
          break;

        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            onContentDelta(metrics, event.delta.text, startTime);
            yield { type: 'content_delta', delta: event.delta.text };
          }
          break;

        case 'message_delta':
          outputTokens = event.usage.output_tokens;
          break;

        case 'message_stop':
          if (!stopYielded) {
            yield { type: 'content_stop' };
            stopYielded = true;
          }
          if (!usageYielded) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
            };
            usageYielded = true;
          }
          break;

        default:
          break;
      }
    }

    if (!stopYielded) {
      yield { type: 'content_stop' };
    }

    this.logger?.logResponse(
      buildStreamResponseLogFields(request, 'anthropic', metrics, startTime, {
        prompt: inputTokens,
        completion: outputTokens,
        total: inputTokens + outputTokens,
      }),
    );
  }

  private buildMessages(request: ChatRequest): {
    system: string | undefined;
    messages: Anthropic.MessageParam[];
  } {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');
    const system =
      systemMessages.length > 0 ? systemMessages.map((m) => m.content).join('\n\n') : undefined;
    const messages: Anthropic.MessageParam[] = nonSystemMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ type: 'text' as const, text: m.content }],
    }));
    return { system, messages };
  }

  private resolveThinking(request: ChatRequest): {
    thinkingConfig: Anthropic.ThinkingConfigEnabled | undefined;
    maxTokens: number;
  } {
    const ts = request.model.thinkingStrength;
    const thinkingEnabled = ts !== undefined && ts !== 'off';
    const budgetTokens = thinkingEnabled ? (THINKING_BUDGETS[ts] ?? THINKING_BUDGET_FALLBACK) : 0;
    const baseMaxTokens = request.options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const maxTokens = thinkingEnabled
      ? Math.max(baseMaxTokens, budgetTokens + THINKING_MAX_TOKENS_MARGIN)
      : baseMaxTokens;
    return {
      thinkingConfig: thinkingEnabled
        ? { type: 'enabled', budget_tokens: budgetTokens }
        : undefined,
      maxTokens,
    };
  }

  private applyResponseFormat(
    params: Anthropic.MessageCreateParamsNonStreaming,
    request: ChatRequest,
  ): void {
    if (request.options?.responseFormat?.type === 'json_schema') {
      params.output_config = {
        format: { type: 'json_schema', schema: request.options.responseFormat.schema },
      };
    }
    // json_object mode: Anthropic's output_config only supports json_schema; the
    // JudgeStep system prompt already mandates JSON, so no output_config is needed.
  }

  private buildCreateParams(request: ChatRequest): Anthropic.MessageCreateParamsNonStreaming {
    const { system, messages } = this.buildMessages(request);
    const { thinkingConfig, maxTokens } = this.resolveThinking(request);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: request.model.model,
      messages,
      max_tokens: maxTokens,
    };

    if (system !== undefined) {
      params.system = system;
    }

    if (!thinkingConfig && request.options?.temperature !== undefined) {
      params.temperature = request.options.temperature;
    }

    if (request.options?.topP !== undefined) {
      params.top_p = request.options.topP;
    }
    if (request.options?.topK !== undefined) {
      params.top_k = request.options.topK;
    }
    if (request.options?.stopSequences !== undefined) {
      params.stop_sequences = request.options.stopSequences;
    }
    if (request.options?.metadata !== undefined) {
      params.metadata = request.options.metadata;
    }

    if (thinkingConfig) {
      params.thinking = thinkingConfig;
    }

    this.applyResponseFormat(params, request);

    return params;
  }
}
