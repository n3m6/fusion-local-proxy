import type { Message } from '../model/message.js';
import type { PanelResult } from '../model/fusion-types.js';

export function renderConversation(messages: Message[]): string[] {
  const lines: string[] = ['=== ORIGINAL CONVERSATION ==='];
  for (const msg of messages) {
    lines.push(`[${msg.role}]: ${msg.content}`);
  }
  return lines;
}

export function renderPanelResponses(panelResults: PanelResult[]): string[] {
  const lines: string[] = ['=== PANEL MODEL RESPONSES ==='];
  for (let i = 0; i < panelResults.length; i++) {
    const result = panelResults[i];
    lines.push(`--- Model ${i + 1}: ${result.modelId} ---`);
    lines.push(result.content);
    lines.push('');
  }
  return lines;
}
