import type { ChatRequest, ChatResponse, ChatStreamChunk } from '../model/chat-types.js';

export interface ChatModelPort {
  complete(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
}
