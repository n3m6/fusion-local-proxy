import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeOpenAiSSE } from './sse-encoder.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';

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
// progress / keep-alive comments
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE emits keep-alive comment for panel progress', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'progress', stage: 'panel', message: 'running' },
    { type: 'done' },
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  assert.ok(strings[0].startsWith(': panel'));
  assert.ok(strings[0].includes('running'));
  assert.ok(strings[0].endsWith('\n\n'));
});

test('encodeOpenAiSSE emits keep-alive comment for judge progress', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'progress', stage: 'judge', message: 'judging' },
    { type: 'done' },
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  assert.ok(strings[0].startsWith(': judging'));
  assert.ok(strings[0].endsWith('\n\n'));
});

test('encodeOpenAiSSE emits keep-alive comment for generic progress', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'progress', stage: 'custom', message: 'working' },
    { type: 'done' },
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  assert.ok(strings[0].startsWith(': custom working'));
  assert.ok(strings[0].endsWith('\n\n'));
});

test('encodeOpenAiSSE emits just the message (no stage prefix) for synthesis progress', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'progress', stage: 'synthesis', message: 'evaluating candidates' },
    { type: 'done' },
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  assert.equal(strings[0], ': evaluating candidates\n\n');
});

test('encodeOpenAiSSE synthesis progress is an SSE comment, not a data chunk', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'progress', stage: 'synthesis', message: 'evaluating candidates' },
    { type: 'content_delta', delta: 'Answer' },
    { type: 'done' },
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  // First string must be the SSE comment, not a data line
  assert.ok(strings[0].startsWith(':'), 'synthesis progress must be an SSE comment');
  assert.ok(!strings[0].startsWith('data:'), 'synthesis progress must not be a data line');

  // Content delta must still appear separately as a data line
  const dataLines = strings.filter((s) => s.startsWith('data: ') && !s.includes('[DONE]'));
  assert.equal(dataLines.length, 1);
  const obj = JSON.parse(dataLines[0].slice('data: '.length).trim());
  assert.equal(obj.choices[0].delta.content, 'Answer');
});

// ---------------------------------------------------------------------------
// content_delta
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE emits chat.completion.chunk for content_delta', async () => {
  const events: FusionStreamEvent[] = [{ type: 'content_delta', delta: 'Hello' }, { type: 'done' }];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  assert.ok(strings[0].startsWith('data: '));
  const jsonStr = strings[0].slice('data: '.length).trim();
  const obj = JSON.parse(jsonStr);

  assert.equal(obj.object, 'chat.completion.chunk');
  assert.equal(typeof obj.id, 'string');
  assert.ok((obj.id as string).startsWith('chatcmpl-'));
  assert.equal(typeof obj.created, 'number');
  assert.ok(obj.created > 0);
  assert.equal(obj.model, 'gpt-4o');

  const choices = obj.choices as Array<Record<string, unknown>>;
  assert.equal(choices.length, 1);
  assert.equal(choices[0].index, 0);
  const delta = choices[0].delta as Record<string, unknown>;
  assert.equal(delta.content, 'Hello');

  assert.ok(strings[0].endsWith('\n\n'));
});

test('encodeOpenAiSSE emits ordered chunks for multiple content_delta events', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hello' },
    { type: 'content_delta', delta: ' there' },
    { type: 'done' },
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  const chunkDeltas = strings
    .filter((s) => s.startsWith('data: ') && s.includes('chat.completion.chunk'))
    .map((s) => {
      const obj = JSON.parse(s.slice('data: '.length).trim());
      const choices = obj.choices as Array<Record<string, unknown>>;
      return (choices[0].delta as Record<string, unknown>).content;
    });

  assert.deepEqual(chunkDeltas, ['Hello', ' there']);
});

// ---------------------------------------------------------------------------
// content_stop
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE emits chat.completion.chunk with finish_reason stop for content_stop', async () => {
  const events: FusionStreamEvent[] = [{ type: 'content_stop' }, { type: 'done' }];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  assert.ok(strings[0].startsWith('data: '));
  const jsonStr = strings[0].slice('data: '.length).trim();
  const obj = JSON.parse(jsonStr);

  assert.equal(obj.object, 'chat.completion.chunk');
  assert.equal(obj.model, 'gpt-4o');

  const choices = obj.choices as Array<Record<string, unknown>>;
  assert.equal(choices.length, 1);
  assert.equal(choices[0].index, 0);
  assert.equal(choices[0].finish_reason, 'stop');

  const delta = choices[0].delta as Record<string, unknown>;
  assert.deepEqual(delta, {});
});

// ---------------------------------------------------------------------------
// done → [DONE]
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE emits [DONE] on done event', async () => {
  const events: FusionStreamEvent[] = [{ type: 'content_delta', delta: 'Hi' }, { type: 'done' }];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  // Last string should be [DONE]
  const last = strings[strings.length - 1];
  assert.equal(last.trim(), 'data: [DONE]');
});

test('encodeOpenAiSSE emits [DONE] when stream ends without done event', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hi' },
    { type: 'content_stop' },
    // No done event!
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  // Last string should be [DONE]
  const last = strings[strings.length - 1];
  assert.equal(last.trim(), 'data: [DONE]');
});

// ---------------------------------------------------------------------------
// id and created consistency within a stream
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE uses consistent id and created across all chunks', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'A' },
    { type: 'content_delta', delta: 'B' },
    { type: 'done' },
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  const ids = new Set<string>();
  const createds = new Set<number>();

  for (const s of strings) {
    if (s.startsWith('data: ') && !s.includes('[DONE]')) {
      const jsonStr = s.slice('data: '.length).trim();
      const obj = JSON.parse(jsonStr);
      ids.add(obj.id as string);
      createds.add(obj.created as number);
    }
  }

  // All chunks should share the same id and created timestamp
  assert.equal(ids.size, 1);
  assert.equal(createds.size, 1);
});

// ---------------------------------------------------------------------------
// error event terminates stream (no [DONE])
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE yields error JSON line and stops without [DONE]', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'partial' },
    { type: 'error', code: 'ALL_PANELS_FAILED', message: 'all models failed' },
    { type: 'done' }, // should never be reached
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  // Should have content_delta line and error line, but NO [DONE]
  assert.equal(strings.length, 2);
  assert.ok(strings[0].startsWith('data: '));

  // Error line should contain the error JSON
  assert.ok(strings[1].startsWith('data: '));
  const errJson = strings[1].slice('data: '.length).trim();
  const errObj = JSON.parse(errJson);
  const error = errObj.error as Record<string, unknown>;
  assert.equal(error.code, 'ALL_PANELS_FAILED');
  assert.equal(error.message, 'all models failed');

  // No [DONE] should be present
  for (const s of strings) {
    assert.ok(!s.includes('[DONE]'), 'should not contain [DONE] after error');
  }
});

// ---------------------------------------------------------------------------
// error event with details
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE handles error event with details', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'error', code: 'TIMEOUT', message: 'timed out', details: { retry: true } },
  ];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  assert.equal(strings.length, 1);
  assert.ok(strings[0].startsWith('data: '));

  const jsonStr = strings[0].slice('data: '.length).trim();
  const obj = JSON.parse(jsonStr);
  const error = obj.error as Record<string, unknown>;
  assert.equal(error.code, 'TIMEOUT');
  assert.equal(error.message, 'timed out');
});

// ---------------------------------------------------------------------------
// empty stream
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE emits only [DONE] for empty stream', async () => {
  const events: FusionStreamEvent[] = [];

  const strings = await collectStrings(encodeOpenAiSSE(await asyncIterableFrom(events), 'gpt-4o'));

  assert.equal(strings.length, 1);
  assert.equal(strings[0].trim(), 'data: [DONE]');
});

// ---------------------------------------------------------------------------
// model passthrough
// ---------------------------------------------------------------------------

test('encodeOpenAiSSE uses provided model in each chunk', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hello' },
    { type: 'content_stop' },
    { type: 'done' },
  ];

  const strings = await collectStrings(
    encodeOpenAiSSE(await asyncIterableFrom(events), 'custom-model-v2'),
  );

  for (const s of strings) {
    if (s.startsWith('data: ') && !s.includes('[DONE]')) {
      const jsonStr = s.slice('data: '.length).trim();
      const obj = JSON.parse(jsonStr);
      assert.equal(obj.model, 'custom-model-v2');
    }
  }
});
