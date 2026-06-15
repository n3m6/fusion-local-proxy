import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';
import { OpenAiChatAdapter } from './openai-chat-adapter.js';
import { AnthropicChatAdapter } from './anthropic-chat-adapter.js';

export class ChatAdapterFactory {
  create(modelRef: ModelRef): ChatModelPort {
    if (modelRef.provider === 'openai') {
      const client = new OpenAI({
        baseURL: modelRef.baseURL,
        apiKey: modelRef.apiKey,
      });
      return new OpenAiChatAdapter(client);
    }

    if (modelRef.provider === 'anthropic') {
      const client = new Anthropic({
        baseURL: modelRef.baseURL,
        apiKey: modelRef.apiKey,
      });
      return new AnthropicChatAdapter(client);
    }

    throw new Error(`Unknown provider type: ${modelRef.provider}`);
  }
}
