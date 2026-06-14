export interface Message {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}
