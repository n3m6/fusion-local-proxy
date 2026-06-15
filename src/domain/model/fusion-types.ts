import type { Message } from './message.js';
import type { ChatOptions } from './chat-types.js';
import type { FailedModelInfo } from './stream-types.js';

export type ProviderType = 'openai' | 'anthropic';

export interface ModelRef {
  readonly provider: ProviderType;
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
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
}

export interface FusionRequest {
  readonly messages: Message[];
  readonly model?: string;
  readonly stream?: boolean;
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly options?: ChatOptions;
}
