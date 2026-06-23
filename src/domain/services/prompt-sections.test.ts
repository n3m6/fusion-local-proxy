import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConversation, renderPanelResponses } from './prompt-sections.js';
import type { Message } from '../model/message.js';
import type { PanelResult } from '../model/fusion-types.js';

// ---------------------------------------------------------------------------
// renderConversation
// ---------------------------------------------------------------------------

test('renderConversation with empty messages returns only the header', () => {
  const lines = renderConversation([]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], '=== ORIGINAL CONVERSATION ===');
});

test('renderConversation formats each message as [role]: content', () => {
  const messages: Message[] = [
    { role: 'user', content: 'What is TypeScript?' },
    { role: 'assistant', content: 'A typed superset of JavaScript.' },
  ];

  const lines = renderConversation(messages);

  assert.equal(lines[0], '=== ORIGINAL CONVERSATION ===');
  assert.equal(lines[1], '[user]: What is TypeScript?');
  assert.equal(lines[2], '[assistant]: A typed superset of JavaScript.');
  assert.equal(lines.length, 3);
});

test('renderConversation includes all roles including system and tool', () => {
  const messages: Message[] = [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Hello' },
    { role: 'tool', content: 'search result', toolCallId: 'call_1' },
  ];

  const lines = renderConversation(messages);

  assert.ok(lines.some((l) => l.startsWith('[system]:')));
  assert.ok(lines.some((l) => l.startsWith('[user]:')));
  assert.ok(lines.some((l) => l.startsWith('[tool]:')));
});

test('renderConversation preserves message content verbatim', () => {
  const messages: Message[] = [{ role: 'user', content: 'Line 1\nLine 2\tTabbed' }];

  const lines = renderConversation(messages);
  assert.equal(lines[1], '[user]: Line 1\nLine 2\tTabbed');
});

// ---------------------------------------------------------------------------
// renderPanelResponses
// ---------------------------------------------------------------------------

test('renderPanelResponses with empty results returns only the header', () => {
  const lines = renderPanelResponses([]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], '=== PANEL MODEL RESPONSES ===');
});

test('renderPanelResponses uses 1-based "Model N: <id>" labels', () => {
  const results: PanelResult[] = [
    {
      modelId: 'gpt-4o',
      provider: 'openai',
      content: 'First answer.',
      usage: { promptTokens: 5, completionTokens: 10 },
      latencyMs: 100,
    },
    {
      modelId: 'claude-opus',
      provider: 'anthropic',
      content: 'Second answer.',
      usage: { promptTokens: 7, completionTokens: 12 },
      latencyMs: 150,
    },
  ];

  const lines = renderPanelResponses(results);

  assert.equal(lines[0], '=== PANEL MODEL RESPONSES ===');
  assert.equal(lines[1], '--- Model 1: gpt-4o ---');
  assert.equal(lines[2], 'First answer.');
  assert.equal(lines[3], ''); // blank separator line
  assert.equal(lines[4], '--- Model 2: claude-opus ---');
  assert.equal(lines[5], 'Second answer.');
  assert.equal(lines[6], ''); // blank separator line
});

test('renderPanelResponses includes a trailing blank line after each block', () => {
  const result: PanelResult = {
    modelId: 'gpt-4o',
    provider: 'openai',
    content: 'Answer.',
    usage: { promptTokens: 1, completionTokens: 1 },
    latencyMs: 50,
  };

  const lines = renderPanelResponses([result]);

  // header + label + content + blank = 4 lines
  assert.equal(lines.length, 4);
  assert.equal(lines[3], '', 'last line must be a blank separator');
});

test('renderPanelResponses total line count = 1 + N*3 (header + label+content+blank per result)', () => {
  const results: PanelResult[] = Array.from({ length: 3 }, (_, i) => ({
    modelId: `model-${i + 1}`,
    provider: 'openai' as const,
    content: `response ${i + 1}`,
    usage: { promptTokens: 1, completionTokens: 1 },
    latencyMs: 10,
  }));

  const lines = renderPanelResponses(results);

  // 1 header + 3 * (label + content + blank) = 1 + 9 = 10
  assert.equal(lines.length, 10);
});
