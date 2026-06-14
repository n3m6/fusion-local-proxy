import type { ChatRequest, ChatResponse } from '../model/chat-types.js';

export interface ChatModelPort {
  complete(request: ChatRequest): Promise<ChatResponse>;
}
