import type { Message } from './message.js';
import type { ChatOptions } from './chat-types.js';

export type ProviderType = 'openai';

export interface ModelRef {
  provider: ProviderType;
  model: string;
  baseURL: string;
  apiKey: string;
}

export interface FusionRequest {
  messages: Message[];
  model?: string;
  stream?: boolean;
  system?: string;
  options?: ChatOptions;
}

export class FusionError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'FusionError';
    this.code = code;
    this.details = details;
  }
}
