import test from 'node:test';
import assert from 'node:assert/strict';
import { promptChars } from './message.js';
import type { Message } from './message.js';

test('promptChars returns 0 for empty array', () => {
  assert.equal(promptChars([]), 0);
});

test('promptChars returns sum of content lengths for a single message', () => {
  const messages: Message[] = [{ role: 'user', content: 'Hello' }];
  assert.equal(promptChars(messages), 5);
});

test('promptChars sums content lengths across all messages', () => {
  const messages: Message[] = [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'What is TypeScript?' },
    { role: 'assistant', content: 'A typed superset of JavaScript.' },
  ];
  // 'Be concise.'.length = 11, 'What is TypeScript?'.length = 19, 'A typed superset of JavaScript.'.length = 31
  assert.equal(promptChars(messages), 11 + 19 + 31);
});

test('promptChars counts only content, not toolCalls or toolCallId', () => {
  const messages: Message[] = [
    {
      role: 'assistant',
      content: 'calling tool',
      toolCalls: [{ id: 'call_abc', name: 'search', arguments: '{"q":"test"}' }],
    },
    {
      role: 'tool',
      content: 'result text',
      toolCallId: 'call_abc',
    },
  ];
  // Only content lengths count: 'calling tool'.length + 'result text'.length
  assert.equal(promptChars(messages), 12 + 11);
});

test('promptChars handles empty-content messages', () => {
  const messages: Message[] = [
    { role: 'user', content: '' },
    { role: 'assistant', content: '' },
  ];
  assert.equal(promptChars(messages), 0);
});

test('promptChars handles unicode multi-byte characters by JS string length', () => {
  const messages: Message[] = [
    { role: 'user', content: '😀😀' }, // each emoji is 2 code units in JS
  ];
  assert.equal(promptChars(messages), '😀😀'.length);
});
