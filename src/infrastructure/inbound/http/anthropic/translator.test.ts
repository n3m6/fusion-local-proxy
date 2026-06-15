import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicRequestToFusion,
  fusionStreamToAnthropicSSE,
} from './translator.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function asyncIterableFrom<T>(items: T[]): Promise<AsyncIterable<T>> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) {
            return { value: items[i++]!, done: false };
          }
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

async function collectStrings(iterable: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// anthropicRequestToFusion — message extraction
// ---------------------------------------------------------------------------

test('anthropicRequestToFusion extracts messages with string content', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ],
  };

  const result = anthropicRequestToFusion(body);

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].content, 'Hello');
  assert.equal(result.messages[1].role, 'assistant');
  assert.equal(result.messages[1].content, 'Hi there');
});

test('anthropicRequestToFusion extracts model field', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.model, 'claude-3-opus-20240229');
});

test('anthropicRequestToFusion handles missing model', () => {
  const body: Record<string, unknown> = {
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.model, undefined);
});

// ---------------------------------------------------------------------------
// anthropicRequestToFusion — system field
// ---------------------------------------------------------------------------

test('anthropicRequestToFusion maps system string to systemPrompt', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    system: 'You are a helpful assistant.',
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.systemPrompt, 'You are a helpful assistant.');
});

test('anthropicRequestToFusion maps system content block array to systemPrompt', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    system: [
      { type: 'text', text: 'Be helpful.' },
      { type: 'text', text: 'Be concise.' },
    ],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.systemPrompt, 'Be helpful.\nBe concise.');
});

test('anthropicRequestToFusion ignores non-text blocks in system array', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    system: [
      { type: 'text', text: 'Be helpful.' },
      { type: 'image', source: {} },
      { type: 'text', text: 'Be concise.' },
    ],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.systemPrompt, 'Be helpful.\nBe concise.');
});

test('anthropicRequestToFusion treats all-non-text system array as absent', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    system: [
      { type: 'image', source: {} },
      { type: 'tool_use', id: 't1', name: 'foo' },
    ],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.systemPrompt, undefined);
});

test('anthropicRequestToFusion treats non-string non-array system as absent', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    system: 123,
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.systemPrompt, undefined);
});

test('anthropicRequestToFusion handles missing system field', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.systemPrompt, undefined);
});

// ---------------------------------------------------------------------------
// anthropicRequestToFusion — messages with content blocks
// ---------------------------------------------------------------------------

test('anthropicRequestToFusion concatenates text content blocks in messages', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    ],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].content, 'Part 1Part 2');
});

test('anthropicRequestToFusion skips non-text blocks in message content', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this:' },
          { type: 'image', source: { type: 'base64', data: 'abc' } },
          { type: 'text', text: 'What do you see?' },
          { type: 'tool_use', id: 't1', name: 'search' },
        ],
      },
    ],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].content, 'Look at this:What do you see?');
});

// ---------------------------------------------------------------------------
// anthropicRequestToFusion — edge cases
// ---------------------------------------------------------------------------

test('anthropicRequestToFusion handles missing messages array', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
  };

  const result = anthropicRequestToFusion(body);
  assert.deepEqual(result.messages, []);
});

test('anthropicRequestToFusion handles non-array messages', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: 'not-an-array',
  };

  const result = anthropicRequestToFusion(body);
  assert.deepEqual(result.messages, []);
});

test('anthropicRequestToFusion defaults missing role to user', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].content, 'Hello');
});

test('anthropicRequestToFusion defaults invalid role to user', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'system', content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.messages[0].role, 'user');
});

test('anthropicRequestToFusion defaults missing content to empty string', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.messages[0].content, '');
});

test('anthropicRequestToFusion defaults non-string non-array content to empty string', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 123 }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.messages[0].content, '');
});

// ---------------------------------------------------------------------------
// anthropicRequestToFusion — stream, temperature, max_tokens
// ---------------------------------------------------------------------------

test('anthropicRequestToFusion extracts stream flag true', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.stream, true);
});

test('anthropicRequestToFusion handles missing stream flag', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.stream, undefined);
});

test('anthropicRequestToFusion extracts max_tokens', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.maxTokens, 1024);
});

test('anthropicRequestToFusion preserves max_tokens in options', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.ok(result.options);
  assert.equal(result.options!.maxTokens, 1024);
});

test('anthropicRequestToFusion preserves max_tokens zero in options', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 0,
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.ok(result.options);
  assert.equal(result.options!.maxTokens, 0);
});

test('anthropicRequestToFusion extracts temperature', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.temperature, 0.7);
});

test('anthropicRequestToFusion preserves temperature in options', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
  };

  const result = anthropicRequestToFusion(body);
  assert.ok(result.options);
  assert.equal(result.options!.temperature, 0.7);
});

test('anthropicRequestToFusion preserves temperature zero in options', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0,
  };

  const result = anthropicRequestToFusion(body);
  assert.ok(result.options);
  assert.equal(result.options!.temperature, 0);
});

// ---------------------------------------------------------------------------
// anthropicRequestToFusion — Anthropic-only fields in options
// ---------------------------------------------------------------------------

test('anthropicRequestToFusion preserves top_p in options', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    top_p: 0.9,
  };

  const result = anthropicRequestToFusion(body);
  assert.ok(result.options);
  const opts = result.options! as Record<string, unknown>;
  assert.equal(opts.top_p, 0.9);
});

test('anthropicRequestToFusion preserves top_k in options', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    top_k: 40,
  };

  const result = anthropicRequestToFusion(body);
  assert.ok(result.options);
  const opts = result.options! as Record<string, unknown>;
  assert.equal(opts.top_k, 40);
});

test('anthropicRequestToFusion preserves stop_sequences in options', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    stop_sequences: ['\n\nHuman:', '\n\nAssistant:'],
  };

  const result = anthropicRequestToFusion(body);
  assert.ok(result.options);
  const opts = result.options! as Record<string, unknown>;
  assert.deepEqual(opts.stop_sequences, ['\n\nHuman:', '\n\nAssistant:']);
});

test('anthropicRequestToFusion preserves metadata in options', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    metadata: { user_id: 'u123' },
  };

  const result = anthropicRequestToFusion(body);
  assert.ok(result.options);
  const opts = result.options! as Record<string, unknown>;
  assert.deepEqual(opts.metadata, { user_id: 'u123' });
});

test('anthropicRequestToFusion does not preserve null metadata', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    metadata: null,
  };

  const result = anthropicRequestToFusion(body);
  // options should not include metadata
  if (result.options) {
    const opts = result.options! as Record<string, unknown>;
    assert.equal(opts.metadata, undefined);
  }
});

test('anthropicRequestToFusion options undefined when no extra fields', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    messages: [{ role: 'user', content: 'Hi' }],
  };

  const result = anthropicRequestToFusion(body);
  assert.equal(result.options, undefined);
});

// ---------------------------------------------------------------------------
// anthropicRequestToFusion — non-string top_k/top_p ignored
// ---------------------------------------------------------------------------

test('anthropicRequestToFusion ignores non-number top_p', () => {
  const body: Record<string, unknown> = {
    model: 'claude-3-opus-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
    top_p: '0.9',
  };

  const result = anthropicRequestToFusion(body);
  if (result.options) {
    const opts = result.options! as Record<string, unknown>;
    assert.equal(opts.top_p, undefined);
  }
});

// ===========================================================================
// SSE Encoder (via fusionStreamToAnthropicSSE)
// ===========================================================================

test('SSE encoder emits full 6-event sequence in correct order', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'progress', stage: 'panel', message: 'Calling panel models...' },
    { type: 'content_delta', delta: 'Hello' },
    { type: 'content_delta', delta: ' world' },
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 10, completionTokens: 25, totalTokens: 35 },
      model: 'claude-3-opus-20240229',
      failedModels: [],
    },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  // Expected sequence: heartbeat, message_start, content_block_start,
  //   content_block_delta(Hello), content_block_delta( world),
  //   content_block_stop, message_delta, message_stop
  assert.ok(strings.length >= 8, `Expected at least 8 strings, got ${strings.length}`);

  assert.equal(strings[0], ': heartbeat\n\n');

  assert.ok(strings[1].startsWith('event: message_start\n'), `string 1: ${strings[1]}`);
  assert.ok(strings[1].includes('data: '));

  assert.ok(strings[2].startsWith('event: content_block_start\n'), `string 2: ${strings[2]}`);
  assert.ok(strings[2].includes('data: '));

  assert.ok(strings[3].startsWith('event: content_block_delta\n'), `string 3: ${strings[3]}`);
  assert.ok(strings[3].includes('Hello'));

  assert.ok(strings[4].startsWith('event: content_block_delta\n'), `string 4: ${strings[4]}`);
  assert.ok(strings[4].includes(' world'));

  assert.ok(strings[5].startsWith('event: content_block_stop\n'), `string 5: ${strings[5]}`);

  assert.ok(strings[6].startsWith('event: message_delta\n'), `string 6: ${strings[6]}`);

  assert.ok(strings[7].startsWith('event: message_stop\n'), `string 7: ${strings[7]}`);

  // No more events after message_stop
  assert.equal(strings.length, 8);
});

test('SSE encoder each event has both event: and data: fields', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hello' },
    {
      type: 'done',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'claude-3-opus-20240229',
      failedModels: [],
    },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  // Every non-heartbeat string should have both event: and data: lines
  for (const s of strings) {
    if (s === ': heartbeat\n\n') continue;
    assert.ok(
      s.startsWith('event: ') && s.includes('\ndata: '),
      `String missing event: or data: field: ${s}`,
    );
  }
});

test('SSE encoder emits keep-alive for progress events', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'progress', stage: 'panel', message: 'Calling panel models...' },
    { type: 'progress', stage: 'judge', message: 'Analyzing responses...' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  assert.equal(strings[0], ': heartbeat\n\n');
  assert.equal(strings[1], ': heartbeat\n\n');
});

test('SSE encoder message_start payload contains model and msg_ id', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hi' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  const msgStart = strings[0];
  assert.ok(msgStart.startsWith('event: message_start\ndata: '));

  const jsonStart = msgStart.indexOf('data: ') + 'data: '.length;
  const jsonStr = msgStart.slice(jsonStart).trim();
  const payload = JSON.parse(jsonStr);

  assert.equal(payload.type, 'message_start');
  assert.equal(payload.message.type, 'message');
  assert.equal(payload.message.role, 'assistant');
  assert.equal(payload.message.model, 'claude-3-opus-20240229');
  assert.ok(
    typeof payload.message.id === 'string' && payload.message.id.startsWith('msg_'),
    `Expected id starting with msg_, got ${payload.message.id}`,
  );
  assert.deepEqual(payload.message.content, []);
  assert.equal(payload.message.stop_reason, null);
  assert.equal(payload.message.stop_sequence, null);
  assert.equal(payload.message.usage.input_tokens, 0);
  assert.equal(payload.message.usage.output_tokens, 0);
});

test('SSE encoder message_delta has stop_reason and output_tokens', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hi' },
    {
      type: 'done',
      usage: { promptTokens: 10, completionTokens: 25, totalTokens: 35 },
      model: 'claude-3-opus-20240229',
    },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  // message_delta should be the second-to-last event
  const msgDelta = strings[strings.length - 2];
  assert.ok(msgDelta.startsWith('event: message_delta\ndata: '));

  const jsonStart = msgDelta.indexOf('data: ') + 'data: '.length;
  const jsonStr = msgDelta.slice(jsonStart).trim();
  const payload = JSON.parse(jsonStr);

  assert.equal(payload.type, 'message_delta');
  assert.equal(payload.delta.stop_reason, 'end_turn');
  assert.equal(payload.delta.stop_sequence, null);
  assert.equal(payload.usage.output_tokens, 25);
});

test('SSE encoder message_stop terminates stream', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hi' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  const last = strings[strings.length - 1];
  assert.ok(last.startsWith('event: message_stop\ndata: '));

  const jsonStart = last.indexOf('data: ') + 'data: '.length;
  const jsonStr = last.slice(jsonStart).trim();
  const payload = JSON.parse(jsonStr);
  assert.equal(payload.type, 'message_stop');
});

test('SSE encoder error event stops content without message_delta or message_stop', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'partial' },
    { type: 'error', code: 'MODEL_DOWN', message: 'Model unavailable' },
  ];

  await assert.rejects(
    async () => {
      const strings: string[] = [];
      for await (const s of fusionStreamToAnthropicSSE(
        await asyncIterableFrom(events),
        'claude-3-opus-20240229',
      )) {
        strings.push(s);
      }
    },
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      const fe = err as FusionError;
      assert.equal(fe.code, 'MODEL_DOWN');
      assert.equal(fe.message, 'Model unavailable');
      return true;
    },
  );
});

test('SSE encoder error event with no prior content emits only before throwing', async () => {
  // We need to capture what was emitted before the throw
  const events: FusionStreamEvent[] = [
    { type: 'error', code: 'UPSTREAM_FAIL', message: 'Service unavailable' },
  ];

  let emitted: string[] = [];
  await assert.rejects(
    async () => {
      for await (const s of fusionStreamToAnthropicSSE(
        await asyncIterableFrom(events),
        'claude-3-opus-20240229',
      )) {
        emitted.push(s);
      }
    },
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      // No message_start, content_block events should be emitted
      // because the error came before anything was started
      return true;
    },
  );
  // No content events should have been emitted before the throw
  assert.equal(emitted.length, 0);
});

test('SSE encoder error event after content_start stops without terminal events', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'partial' },
    { type: 'error', code: 'MODEL_DOWN', message: 'Model unavailable' },
    { type: 'done', model: 'claude-3-opus-20240229' }, // should not be reached
  ];

  const strings: string[] = [];
  await assert.rejects(
    async () => {
      for await (const s of fusionStreamToAnthropicSSE(
        await asyncIterableFrom(events),
        'claude-3-opus-20240229',
      )) {
        strings.push(s);
      }
    },
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      return true;
    },
  );

  // Should have message_start, content_block_start, content_block_delta
  // but NOT content_block_stop, message_delta, or message_stop
  const eventTypes = strings
    .filter(s => s !== ': heartbeat\n\n')
    .map(s => {
      const match = s.match(/^event: (\w+)/);
      return match ? match[1] : 'unknown';
    });

  assert.ok(eventTypes.includes('message_start'));
  assert.ok(eventTypes.includes('content_block_start'));
  assert.ok(eventTypes.includes('content_block_delta'));
  assert.ok(!eventTypes.includes('content_block_stop'));
  assert.ok(!eventTypes.includes('message_delta'));
  assert.ok(!eventTypes.includes('message_stop'));
});

test('SSE encoder emits terminal sequence for empty stream', async () => {
  const events: FusionStreamEvent[] = [];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  // Should emit message_start, content_block_start, content_block_stop, message_delta, message_stop
  assert.ok(strings.length >= 5, `Expected at least 5 strings, got ${strings.length}`);

  assert.ok(strings[0].startsWith('event: message_start\n'));
  assert.ok(strings[1].startsWith('event: content_block_start\n'));
  assert.ok(strings[2].startsWith('event: content_block_stop\n'));
  assert.ok(strings[3].startsWith('event: message_delta\n'));
  assert.ok(strings[4].startsWith('event: message_stop\n'));
  assert.equal(strings.length, 5);
});

test('SSE encoder handles stream with only content_stop and done', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'claude-3-opus-20240229',
    },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  // message_start, content_block_start, content_block_stop, message_delta, message_stop
  assert.ok(strings[0].startsWith('event: message_start\n'));
  assert.ok(strings[1].startsWith('event: content_block_start\n'));
  assert.ok(strings[2].startsWith('event: content_block_stop\n'));
  assert.ok(strings[3].startsWith('event: message_delta\n'));
  assert.ok(strings[4].startsWith('event: message_stop\n'));
});

test('SSE encoder message_delta defaults output_tokens to 0 when done has no usage', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hi' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  const msgDelta = strings[strings.length - 2];
  const jsonStart = msgDelta.indexOf('data: ') + 'data: '.length;
  const jsonStr = msgDelta.slice(jsonStart).trim();
  const payload = JSON.parse(jsonStr);

  assert.equal(payload.usage.output_tokens, 0);
});

test('SSE encoder content_block_start has correct shape', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hi' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  // content_block_start should be the second event
  const cbsIdx = strings.findIndex(s => s.startsWith('event: content_block_start\n'));
  assert.ok(cbsIdx >= 0, 'content_block_start not found');

  const cbs = strings[cbsIdx];
  const jsonStart = cbs.indexOf('data: ') + 'data: '.length;
  const jsonStr = cbs.slice(jsonStart).trim();
  const payload = JSON.parse(jsonStr);

  assert.equal(payload.type, 'content_block_start');
  assert.equal(payload.index, 0);
  assert.equal(payload.content_block.type, 'text');
  assert.equal(payload.content_block.text, '');
});

test('SSE encoder content_block_delta has correct shape', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hello' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  const cbdIdx = strings.findIndex(s => s.startsWith('event: content_block_delta\n'));
  assert.ok(cbdIdx >= 0, 'content_block_delta not found');

  const cbd = strings[cbdIdx];
  const jsonStart = cbd.indexOf('data: ') + 'data: '.length;
  const jsonStr = cbd.slice(jsonStart).trim();
  const payload = JSON.parse(jsonStr);

  assert.equal(payload.type, 'content_block_delta');
  assert.equal(payload.index, 0);
  assert.equal(payload.delta.type, 'text_delta');
  assert.equal(payload.delta.text, 'Hello');
});

test('SSE encoder generates unique message IDs per call', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'A' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ];

  const collectFirstId = async () => {
    const strings = await collectStrings(
      fusionStreamToAnthropicSSE(
        await asyncIterableFrom(events),
        'claude-3-opus-20240229',
      ),
    );
    const msgStart = strings.find(s => s.startsWith('event: message_start\n'))!;
    const jsonStart = msgStart.indexOf('data: ') + 'data: '.length;
    const jsonStr = msgStart.slice(jsonStart).trim();
    return JSON.parse(jsonStr).message.id as string;
  };

  const id1 = await collectFirstId();
  const id2 = await collectFirstId();

  assert.notEqual(id1, id2);
  assert.ok(id1.startsWith('msg_'));
  assert.ok(id2.startsWith('msg_'));
});

test('SSE encoder handles done event with 0 completionTokens', async () => {
  const events: FusionStreamEvent[] = [
    {
      type: 'done',
      usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
      model: 'claude-3-opus-20240229',
    },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  const msgDelta = strings[strings.length - 2];
  const jsonStart = msgDelta.indexOf('data: ') + 'data: '.length;
  const jsonStr = msgDelta.slice(jsonStart).trim();
  const payload = JSON.parse(jsonStr);

  assert.equal(payload.usage.output_tokens, 0);
});

test('SSE encoder content_block_stop has correct shape', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_stop' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ];

  const strings = await collectStrings(
    fusionStreamToAnthropicSSE(
      await asyncIterableFrom(events),
      'claude-3-opus-20240229',
    ),
  );

  const cbsIdx = strings.findIndex(s => s.startsWith('event: content_block_stop\n'));
  assert.ok(cbsIdx >= 0, 'content_block_stop not found');

  const cbs = strings[cbsIdx];
  const jsonStart = cbs.indexOf('data: ') + 'data: '.length;
  const jsonStr = cbs.slice(jsonStart).trim();
  const payload = JSON.parse(jsonStr);

  assert.equal(payload.type, 'content_block_stop');
  assert.equal(payload.index, 0);
});
