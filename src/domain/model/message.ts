export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface Message {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCalls?: ToolCall[];
  readonly toolCallId?: string;
}

export function promptChars(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}
