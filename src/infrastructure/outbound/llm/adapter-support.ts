import type { ChatRequest } from '../../../domain/model/chat-types.js';
import type { LogFields } from '../../../domain/ports/logger-port.js';
import { promptChars } from '../../../domain/model/message.js';

export interface AdapterConfig {
  readonly baseURL: string;
  readonly apiKey: string;
}

export function buildRequestLogFields(
  request: ChatRequest,
  provider: string,
  mode: 'complete' | 'stream',
): LogFields {
  return {
    provider,
    modelId: request.model.model,
    baseURL: request.model.baseURL,
    requestId: request.options?.requestId,
    stage: request.options?.stage,
    mode,
    messageCount: request.messages.length,
    promptChars: promptChars(request.messages),
    temperature: request.options?.temperature,
    maxTokens: request.options?.maxTokens,
    responseFormat: request.options?.responseFormat?.type,
    thinkingStrength: request.model.thinkingStrength,
    prompt: request.messages,
  };
}

export function buildBaseLogFields(request: ChatRequest, provider: string): LogFields {
  return {
    provider,
    modelId: request.model.model,
    baseURL: request.model.baseURL,
    requestId: request.options?.requestId,
    stage: request.options?.stage,
  };
}
