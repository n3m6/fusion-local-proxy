import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../../domain/ports/logger-port.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';
import { OpenAiChatAdapter, createOpenAiClient } from './openai-chat-adapter.js';
import { AnthropicChatAdapter, createAnthropicClient } from './anthropic-chat-adapter.js';

export class ChatAdapterFactory {
  constructor(private readonly logger?: LoggerPort) {}

  create(modelRef: ModelRef): ChatModelPort {
    if (modelRef.provider === 'openai') {
      const client = createOpenAiClient({
        baseURL: modelRef.baseURL,
        apiKey: modelRef.apiKey,
      });
      return new OpenAiChatAdapter(client, this.logger);
    }

    if (modelRef.provider === 'anthropic') {
      const client = createAnthropicClient({
        baseURL: modelRef.baseURL,
        apiKey: modelRef.apiKey,
      });
      return new AnthropicChatAdapter(client, this.logger);
    }

    throw new Error(`Unknown provider type: ${modelRef.provider}`);
  }
}
