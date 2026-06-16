import Anthropic from '@anthropic-ai/sdk';
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
 * Construct the Anthropic SDK client. Kept here (rather than in the factory) so
 * the `@anthropic-ai/sdk` import stays confined to this adapter module (NFR-3).
 */
export function createAnthropicClient(config: AdapterConfig): Anthropic {
  return new Anthropic({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}

export class AnthropicChatAdapter implements ChatModelPort {
  constructor(private readonly client: Anthropic) {}

  get config(): AdapterConfig {
    return {
      baseURL: (this.client as unknown as { baseURL?: string }).baseURL ?? '',
      apiKey: (this.client as unknown as { apiKey?: string }).apiKey ?? '',
    };
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const params = this.buildCreateParams(request);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Record<string,unknown> bypasses SDK strict params type
    const response = await this.client.messages.create(params as any, {
      signal: request.options?.signal,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock) {
      throw new Error('Anthropic response contained no text content block');
    }
    const content = textBlock.text;

    const usage: TokenUsage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    return { content, usage, model: response.model };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const params = this.buildCreateParams(request);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Record<string,unknown> bypasses SDK strict params type
    const messageStream = this.client.messages.stream(params as any, {
      signal: request.options?.signal,
    });

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
          // Ignore all other event types (content_block_start, content_block_stop,
          // content_block_delta for non-text types, etc.)
          break;
      }
    }

    if (!stopYielded) {
      yield { type: 'content_stop' };
    }
  }

  private buildCreateParams(request: ChatRequest): Record<string, unknown> {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

    const messages = nonSystemMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ type: 'text' as const, text: m.content }],
    }));

    const ts = request.model.thinkingStrength;
    const thinkingEnabled = ts !== undefined && ts !== 'off';

    // budget_tokens must be >=1024 and strictly less than max_tokens (SDK constraint).
    const THINKING_BUDGETS: Record<string, number> = { low: 1024, medium: 4096, high: 12000 };
    const budgetTokens = thinkingEnabled ? (THINKING_BUDGETS[ts] ?? 1024) : 0;

    // When thinking is enabled, ensure max_tokens exceeds budget_tokens.
    const baseMaxTokens = request.options?.maxTokens ?? 4096;
    const maxTokens = thinkingEnabled
      ? Math.max(baseMaxTokens, budgetTokens + 4096)
      : baseMaxTokens;

    const params: Record<string, unknown> = {
      model: request.model.model,
      messages,
      max_tokens: maxTokens,
    };

    if (systemMessages.length > 0) {
      params['system'] = systemMessages.map((m) => m.content).join('\n\n');
    }

    // Anthropic requires temperature to be unset (or 1) when extended thinking is enabled.
    if (!thinkingEnabled && request.options?.temperature !== undefined) {
      params['temperature'] = request.options.temperature;
    }

    if (thinkingEnabled) {
      params['thinking'] = { type: 'enabled', budget_tokens: budgetTokens };
    }

    if (request.options?.responseFormat?.type === 'json_object') {
      params['output_config'] = {
        format: { type: 'json_object', schema: null },
      };
    } else if (request.options?.responseFormat?.type === 'json_schema') {
      // Pass the schema through so structured output is requested from the model.
      // Note: Anthropic's param shape (`output_config`) should be verified against
      // the installed SDK version; the prompt-based JSON fallback in JudgeStep
      // (which mandates JSON and safeParse-degrades) remains the reliable path.
      params['output_config'] = {
        format: { type: 'json_schema', schema: request.options.responseFormat.schema },
      };
    }

    return params;
  }
}
