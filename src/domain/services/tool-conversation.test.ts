import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { flattenToolMessages } from './tool-conversation.js';
import type { Message } from '../model/message.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function user(content: string): Message {
  return { role: 'user', content };
}
function assistant(content: string): Message {
  return { role: 'assistant', content };
}
function assistantWithCalls(content: string, calls: Message['toolCalls']): Message {
  return { role: 'assistant', content, toolCalls: calls };
}
function toolResult(toolCallId: string, content: string): Message {
  return { role: 'tool', content, toolCallId };
}

// ---------------------------------------------------------------------------
// Passthrough (no tool messages)
// ---------------------------------------------------------------------------

describe('flattenToolMessages — plain conversation', () => {
  test('passes through system/user/assistant messages unchanged', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      user('hi'),
      assistant('hello'),
    ];
    const result = flattenToolMessages(messages);
    assert.deepStrictEqual(result, messages);
  });

  test('returns a new array (does not mutate input)', () => {
    const messages: Message[] = [user('hi'), assistant('hello')];
    const result = flattenToolMessages(messages);
    assert.notEqual(result, messages);
  });

  test('empty array stays empty', () => {
    assert.deepStrictEqual(flattenToolMessages([]), []);
  });
});

// ---------------------------------------------------------------------------
// Assistant toolCalls rendering
// ---------------------------------------------------------------------------

describe('flattenToolMessages — assistant tool calls', () => {
  test('renders tool calls as text and drops toolCalls field', () => {
    const messages: Message[] = [
      assistantWithCalls('', [{ id: 'c1', name: 'get_weather', arguments: '{"city":"NYC"}' }]),
    ];
    const result = flattenToolMessages(messages);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'assistant');
    assert.ok(result[0].content.includes('[tool_call get_weather({"city":"NYC"})]'));
    assert.equal(result[0].toolCalls, undefined);
  });

  test('appends tool-call text after existing content', () => {
    const messages: Message[] = [
      assistantWithCalls('Let me check.', [
        { id: 'c1', name: 'get_weather', arguments: '{"city":"NYC"}' },
      ]),
    ];
    const result = flattenToolMessages(messages);
    assert.ok(result[0].content.startsWith('Let me check.'));
    assert.ok(result[0].content.includes('[tool_call get_weather({"city":"NYC"})]'));
  });

  test('renders multiple tool calls each on their own line', () => {
    const messages: Message[] = [
      assistantWithCalls('', [
        { id: 'c1', name: 'get_weather', arguments: '{"city":"NYC"}' },
        { id: 'c2', name: 'get_time', arguments: '{"tz":"UTC"}' },
      ]),
    ];
    const result = flattenToolMessages(messages);
    assert.ok(result[0].content.includes('[tool_call get_weather({"city":"NYC"})]'));
    assert.ok(result[0].content.includes('[tool_call get_time({"tz":"UTC"})]'));
  });
});

// ---------------------------------------------------------------------------
// Tool role conversion
// ---------------------------------------------------------------------------

describe('flattenToolMessages — tool role messages', () => {
  test('converts tool role to user with labeled content', () => {
    const messages: Message[] = [
      assistantWithCalls('', [{ id: 'c1', name: 'get_weather', arguments: '{}' }]),
      toolResult('c1', 'Sunny, 72°F'),
    ];
    const result = flattenToolMessages(messages);
    const toolMsg = result.find((m) => m.content.includes('tool result'));
    assert.ok(toolMsg);
    assert.equal(toolMsg.role, 'user');
    assert.ok(toolMsg.content.includes('[tool result get_weather]: Sunny, 72°F'));
    assert.equal(toolMsg.toolCallId, undefined);
  });

  test('labels unknown tool as "unknown" when id cannot be resolved', () => {
    const messages: Message[] = [{ role: 'tool', content: 'result', toolCallId: 'no_match' }];
    const result = flattenToolMessages(messages);
    assert.equal(result[0].role, 'user');
    assert.ok(result[0].content.includes('[tool result unknown]'));
  });

  test('labels as "unknown" when toolCallId is absent', () => {
    const messages: Message[] = [{ role: 'tool', content: 'result' }];
    const result = flattenToolMessages(messages);
    assert.equal(result[0].role, 'user');
    assert.ok(result[0].content.includes('[tool result unknown]'));
  });
});

// ---------------------------------------------------------------------------
// Consecutive same-role merging
// ---------------------------------------------------------------------------

describe('flattenToolMessages — consecutive same-role merging', () => {
  test('merges two consecutive user messages', () => {
    const messages: Message[] = [user('first'), user('second')];
    const result = flattenToolMessages(messages);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
    assert.ok(result[0].content.includes('first'));
    assert.ok(result[0].content.includes('second'));
  });

  test('multiple tool results merged into a single user message', () => {
    // Two tool results become two user messages after conversion, which are then merged.
    const messages: Message[] = [
      assistantWithCalls('', [
        { id: 'c1', name: 'tool_a', arguments: '{}' },
        { id: 'c2', name: 'tool_b', arguments: '{}' },
      ]),
      toolResult('c1', 'result_a'),
      toolResult('c2', 'result_b'),
    ];
    const result = flattenToolMessages(messages);
    // assistant (1) + merged user (1)
    assert.equal(result.length, 2);
    assert.equal(result[1].role, 'user');
    assert.ok(result[1].content.includes('[tool result tool_a]: result_a'));
    assert.ok(result[1].content.includes('[tool result tool_b]: result_b'));
  });

  test('does not merge messages with different roles', () => {
    const messages: Message[] = [user('question'), assistant('answer')];
    const result = flattenToolMessages(messages);
    assert.equal(result.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Full round-trip: tool-call turn followed by follow-up user message
// ---------------------------------------------------------------------------

describe('flattenToolMessages — full tool turn round-trip', () => {
  test('correctly handles a full tool-call turn', () => {
    const messages: Message[] = [
      user("What's the weather in NYC?"),
      assistantWithCalls('', [{ id: 'c1', name: 'get_weather', arguments: '{"city":"NYC"}' }]),
      toolResult('c1', 'Sunny, 72°F'),
      user('Thanks!'),
    ];
    const result = flattenToolMessages(messages);

    assert.equal(result[0].role, 'user');
    assert.equal(result[0].content, "What's the weather in NYC?");

    assert.equal(result[1].role, 'assistant');
    assert.ok(result[1].content.includes('[tool_call get_weather({"city":"NYC"})]'));

    assert.equal(result[2].role, 'user');
    assert.ok(result[2].content.includes('[tool result get_weather]: Sunny, 72°F'));
    assert.ok(result[2].content.includes('Thanks!'));
  });
});
