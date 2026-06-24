import type { Message, ToolCall } from '../model/message.js';

export const NO_TOOLS_DIRECTIVE =
  'Tool calling is disabled for this step and no tools are available. Answer the user directly in natural language using the conversation so far. Do not emit tool calls, function calls, or any tool-call markup or special tokens.';

export function withNoToolsDirective(messages: Message[]): Message[] {
  return [...messages, { role: 'system', content: NO_TOOLS_DIRECTIVE }];
}

function buildToolCallIndex(messages: Message[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const msg of messages) {
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        index.set(tc.id, tc.name);
      }
    }
  }
  return index;
}

function renderToolCall(tc: ToolCall): string {
  return `[tool_call ${tc.name}(${tc.arguments})]`;
}

/**
 * Linearize tool calls and tool results into plain-text message content so that
 * any provider can consume the conversation without needing structured tool
 * support (e.g. Anthropic panel models, which only handle text content).
 *
 * Transforms applied in order:
 * 1. assistant message with toolCalls — content gets the tool calls appended as
 *    text (`[tool_call name(args)]`); toolCalls field is dropped.
 * 2. tool role message — converted to user role with labeled content
 *    (`[tool result name]: <content>`); toolCallId field is dropped.
 * 3. Consecutive same-role messages are merged with a newline separator to
 *    satisfy Anthropic's strict user/assistant alternation requirement.
 * 4. All other messages pass through unchanged.
 */
export function flattenToolMessages(messages: Message[]): Message[] {
  const toolNameIndex = buildToolCallIndex(messages);

  const flattened: Message[] = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const toolText = msg.toolCalls.map(renderToolCall).join('\n');
      const content = msg.content.length > 0 ? `${msg.content}\n${toolText}` : toolText;
      flattened.push({ role: 'assistant', content });
    } else if (msg.role === 'tool') {
      const toolName =
        msg.toolCallId !== undefined ? (toolNameIndex.get(msg.toolCallId) ?? 'unknown') : 'unknown';
      flattened.push({ role: 'user', content: `[tool result ${toolName}]: ${msg.content}` });
    } else {
      flattened.push(msg);
    }
  }

  // Merge consecutive same-role messages.
  const merged: Message[] = [];
  for (const msg of flattened) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.role === msg.role) {
      merged[merged.length - 1] = { role: prev.role, content: `${prev.content}\n${msg.content}` };
    } else {
      merged.push(msg);
    }
  }

  return merged;
}
