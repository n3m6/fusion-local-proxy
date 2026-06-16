export interface Message {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export function promptChars(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}
