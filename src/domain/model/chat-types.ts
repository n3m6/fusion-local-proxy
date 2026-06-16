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
