import type { Message } from './message.js';
import type { ChatOptions, TokenUsage } from './chat-types.js';
import type { FailedModelInfo } from './stream-types.js';

export type ProviderType = 'openai' | 'anthropic';

export type JsonMode = 'json_object' | 'json_schema';

export type ThinkingStrength = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelRef {
  readonly provider: ProviderType;
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
  /** Structured-output mode used by the judge. Defaults to 'json_schema' when absent. */
  readonly jsonMode?: JsonMode;
  /** Reasoning/thinking effort level. When set and not 'off', each adapter translates this to its provider-specific parameter. */
  readonly thinkingStrength?: ThinkingStrength;
}

/**
 * Thrown with code `'all_panels_failed'` when every panel model fails
 * (i.e., Promise.allSettled produces zero fulfilled results).
 */
export class FusionError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FusionError';
    this.code = code;
    this.details = details;
  }
}

export interface PanelResult {
  readonly modelId: string;
  readonly provider: ProviderType;
  readonly content: string;
  readonly usage: { promptTokens: number; completionTokens: number };
  readonly latencyMs: number;
}

export interface PanelMeta {
  readonly results: PanelResult[];
  readonly failedModels: FailedModelInfo[];
  readonly usage: TokenUsage;
}

export interface FusionRequest {
  readonly messages: Message[];
  readonly model?: string;
  readonly stream?: boolean;
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly stopSequences?: string[];
  readonly metadata?: { readonly user_id?: string | null };
  readonly options?: ChatOptions;
}
