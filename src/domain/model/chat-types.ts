import type { Message } from './message.js';
import type { ModelRef } from './fusion-types.js';

export interface ChatRequest {
  readonly messages: Message[];
  readonly model: ModelRef;
  readonly options?: ChatOptions;
}

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
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export type ChatStreamChunk =
  | { readonly type: 'content_delta'; readonly delta: string }
  | { readonly type: 'content_stop' }
  | { readonly type: 'usage'; readonly usage: TokenUsage };
