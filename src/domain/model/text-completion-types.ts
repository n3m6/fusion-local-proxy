import type { ModelRef } from './fusion-types.js';
import type { TokenUsage } from './chat-types.js';

export interface TextCompletionRequest {
  readonly model: ModelRef;
  readonly prompt: string;
  readonly suffix?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly stop?: string | string[];
}

export interface TextCompletionResponse {
  readonly text: string;
  readonly model: string;
  readonly usage: TokenUsage;
}

export type TextCompletionChunk =
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'text_stop' }
  | { readonly type: 'usage'; readonly usage: TokenUsage };
