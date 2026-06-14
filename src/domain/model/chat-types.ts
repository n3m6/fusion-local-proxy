import type { Message } from './message.js';
import type { ModelRef } from './fusion-types.js';

export interface ResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  jsonSchema?: Record<string, unknown>;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ResponseFormat;
}

export interface ChatRequest {
  messages: Message[];
  model: ModelRef;
  options?: ChatOptions;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  content: string;
  usage: TokenUsage;
  model: string;
}
