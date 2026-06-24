import type { Message, ToolCall } from './message.js';
import type { ModelRef } from './fusion-types.js';

export interface ChatRequest {
  readonly messages: Message[];
  readonly model: ModelRef;
  readonly options?: ChatOptions;
}

export interface ToolDefinition {
  readonly type: 'function';
  readonly name: string;
  readonly description?: string;
  readonly parameters?: Record<string, unknown>;
}

export type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { readonly type: 'function'; readonly function: { readonly name: string } };

export interface ChatOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly stopSequences?: string[];
  readonly metadata?: { readonly user_id?: string | null };
  readonly responseFormat?: ResponseFormat;
  readonly signal?: AbortSignal;
  /** Correlation id propagated to outbound adapter logs to tie a run's stages together. */
  readonly requestId?: string;
  /** Pipeline stage that issued this request ('panel' | 'judge' | 'synthesis'), for logging. */
  readonly stage?: string;
  /** Stable per-call label (e.g. 'panel-0') so completion-order logs with identical modelIds stay attributable. */
  readonly label?: string;
  readonly tools?: ToolDefinition[];
  readonly toolChoice?: ToolChoice;
}

/** The subset of ChatOptions that callers may override per-request via sampling parameters. */
export type Sampling = Pick<
  ChatOptions,
  'temperature' | 'maxTokens' | 'topP' | 'topK' | 'stopSequences' | 'metadata'
>;

/** Converts a Sampling object into the corresponding partial ChatOptions, omitting undefined fields. */
export function samplingToOptions(sampling: Sampling | undefined): Partial<ChatOptions> {
  if (sampling === undefined) return {};
  return {
    ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
    ...(sampling.maxTokens !== undefined ? { maxTokens: sampling.maxTokens } : {}),
    ...(sampling.topP !== undefined ? { topP: sampling.topP } : {}),
    ...(sampling.topK !== undefined ? { topK: sampling.topK } : {}),
    ...(sampling.stopSequences !== undefined ? { stopSequences: sampling.stopSequences } : {}),
    ...(sampling.metadata !== undefined ? { metadata: sampling.metadata } : {}),
  };
}

/**
 * Returns an AbortSignal that fires after `timeoutMs` milliseconds, or
 * `undefined` when `timeoutMs` is not positive (meaning no timeout applies).
 */
export function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  return timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
}

export type ResponseFormat =
  | { readonly type: 'text' }
  | { readonly type: 'json_object' }
  | { readonly type: 'json_schema'; readonly schema: Record<string, unknown> };

export interface ChatResponse {
  readonly content: string;
  readonly usage: TokenUsage;
  readonly model: string;
  readonly toolCalls?: ToolCall[];
  readonly finishReason?: string;
}

export interface TokenUsage {
  /**
   * Total input tokens for this call = uncached + cachedPromptTokens + cacheWritePromptTokens.
   * Always inclusive of all cache tiers so that arithmetic across stages stays consistent.
   * NOTE: Anthropic's `input_tokens` EXCLUDES cache tokens; adapters must reconstruct the
   * inclusive total (input_tokens + cache_read + cache_creation) before setting this field.
   */
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /**
   * Tokens spent on hidden reasoning, when the provider reports them separately
   * (e.g. OpenAI `completion_tokens_details.reasoning_tokens`). Already included
   * in `completionTokens`/`totalTokens`; surfaced so billed-but-invisible cost is
   * auditable. Omitted when the provider does not report it.
   */
  readonly reasoningTokens?: number;
  /**
   * Subset of `promptTokens` served from the provider's prompt cache at a reduced rate.
   * Maps to: DeepSeek `prompt_cache_hit_tokens`, OpenAI `prompt_tokens_details.cached_tokens`,
   * Anthropic `cache_read_input_tokens`. Omitted when the provider does not report it.
   */
  readonly cachedPromptTokens?: number;
  /**
   * Tokens billed to *write* new entries into the provider's prompt cache, typically at a
   * premium rate. Maps to: Anthropic `cache_creation_input_tokens`. Omitted for providers
   * that do not have a separate cache-write billing tier (DeepSeek, OpenAI).
   */
  readonly cacheWritePromptTokens?: number;
}

export type ChatStreamChunk =
  | { readonly type: 'content_delta'; readonly delta: string }
  | { readonly type: 'content_stop'; readonly finishReason?: string }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'reasoning_progress' }
  | {
      readonly type: 'tool_call_delta';
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsDelta?: string;
    };
