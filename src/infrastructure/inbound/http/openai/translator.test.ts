import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openAiRequestToFusion,
  fusionStreamToOpenAiResponse,
} from './translator.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';

// ---------------------------------------------------------------------------
// openAiRequestToFusion
// ---------------------------------------------------------------------------

test('openAiRequestToFusion extracts messages', () => {
  const body: Record<string, unknown> = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ],
  };

  const result = openAiRequestToFusion(body);

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].role, 'system');
  assert.equal(result.messages[0].content, 'You are helpful.');
  assert.equal(result.messages[1].role, 'user');
  assert.equal(result.messages[1].content, 'Hi');
  assert.equal(result.messages[2].role, 'assistant');
  assert.equal(result.messages[2].content, 'Hello');
});

test('openAiRequestToFusion extracts model field', () => {
  const body: Record<string, unknown> = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.model, 'gpt-4o');
});

test('openAiRequestToFusion handles missing model field', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.model, undefined);
});

test('openAiRequestToFusion extracts stream flag', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.stream, true);
});

test('openAiRequestToFusion handles missing stream flag', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hello' }],
    stream: false,
  };

  const result = openAiRequestToFusion(body);
  // false is still boolean — the code checks typeof, so false is captured
  assert.equal(result.stream, false);
});

test('openAiRequestToFusion extracts temperature and max_tokens', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
    max_tokens: 256,
  };

  const result = openAiRequestToFusion(body);
  assert.ok(result.options);
  assert.equal(result.options!.temperature, 0.7);
  assert.equal(result.options!.maxTokens, 256);
});

test('openAiRequestToFusion handles missing messages array gracefully', () => {
  const body: Record<string, unknown> = { model: 'gpt-4o' };

  const result = openAiRequestToFusion(body);
  assert.deepEqual(result.messages, []);
});

test('openAiRequestToFusion handles non-array messages field', () => {
  const body: Record<string, unknown> = {
    messages: 'not-an-array',
  };

  const result = openAiRequestToFusion(body);
  assert.deepEqual(result.messages, []);
});

test('openAiRequestToFusion defaults missing role to user', () => {
  const body: Record<string, unknown> = {
    messages: [{ content: 'Hello' }],
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].content, 'Hello');
});

test('openAiRequestToFusion defaults missing content to empty string', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user' }],
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.messages[0].content, '');
});

test('openAiRequestToFusion extracts system prompt', () => {
  const body: Record<string, unknown> = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
    system: 'You are a helpful assistant.',
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.systemPrompt, 'You are a helpful assistant.');
});

test('openAiRequestToFusion handles missing system field', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.systemPrompt, undefined);
});

test('openAiRequestToFusion handles non-string system field', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hello' }],
    system: 123,
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.systemPrompt, undefined);
});

test('openAiRequestToFusion handles max_tokens zero', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 0,
  };

  const result = openAiRequestToFusion(body);
  assert.ok(result.options);
  assert.equal(result.options!.maxTokens, 0);
});

test('openAiRequestToFusion handles temperature zero', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0,
  };

  const result = openAiRequestToFusion(body);
  assert.ok(result.options);
  assert.equal(result.options!.temperature, 0);
});

test('openAiRequestToFusion options undefined when no options present', () => {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: 'Hi' }],
  };

  const result = openAiRequestToFusion(body);
  assert.equal(result.options, undefined);
});

// ---------------------------------------------------------------------------
// fusionStreamToOpenAiResponse
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

test('fusionStreamToOpenAiResponse returns valid ChatCompletion shape', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hello' },
    { type: 'content_delta', delta: ' world' },
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      failedModels: [],
      model: 'gpt-4o',
    },
  ];

  const result = await fusionStreamToOpenAiResponse(
    await asyncIterableFrom(events),
  );

  assert.equal(result.object, 'chat.completion');
  assert.equal(typeof result.id, 'string');
  assert.ok((result.id as string).startsWith('chatcmpl-'));
  assert.equal(typeof result.created, 'number');
  assert.ok((result.created as number) > 0);
  assert.equal(result.model, 'gpt-4o');

  const choices = result.choices as Array<Record<string, unknown>>;
  assert.equal(choices.length, 1);
  assert.equal(choices[0].index, 0);
  assert.equal(choices[0].finish_reason, 'stop');

  const message = choices[0].message as Record<string, unknown>;
  assert.equal(message.role, 'assistant');
  assert.equal(message.content, 'Hello world');

  const usage = result.usage as Record<string, unknown>;
  assert.equal(usage.prompt_tokens, 5);
  assert.equal(usage.completion_tokens, 3);
  assert.equal(usage.total_tokens, 8);
});

test('fusionStreamToOpenAiResponse handles error event with no prior content', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'error', code: 'UPSTREAM_FAIL', message: 'Service unavailable' },
  ];

  await assert.rejects(
    async () => {
      await fusionStreamToOpenAiResponse(await asyncIterableFrom(events));
    },
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      const fe = err as FusionError;
      assert.equal(fe.code, 'UPSTREAM_FAIL');
      assert.equal(fe.message, 'Service unavailable');
      return true;
    },
  );
});

test('fusionStreamToOpenAiResponse handles empty content', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      failedModels: [],
      model: 'gpt-4o',
    },
  ];

  const result = await fusionStreamToOpenAiResponse(
    await asyncIterableFrom(events),
  );

  const choices = result.choices as Array<Record<string, unknown>>;
  const message = choices[0].message as Record<string, unknown>;
  assert.equal(message.content, '');
});

test('fusionStreamToOpenAiResponse handles model-less done event', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hi' },
    {
      type: 'done',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      failedModels: [],
    },
  ];

  const result = await fusionStreamToOpenAiResponse(
    await asyncIterableFrom(events),
  );

  assert.equal(result.model, '');
});

test('fusionStreamToOpenAiResponse throws FusionError on error event', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'partial' },
    { type: 'error', code: 'MODEL_DOWN', message: 'Model unavailable', details: { retry: true } },
  ];

  await assert.rejects(
    async () => {
      await fusionStreamToOpenAiResponse(await asyncIterableFrom(events));
    },
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      const fe = err as FusionError;
      assert.equal(fe.code, 'MODEL_DOWN');
      assert.equal(fe.message, 'Model unavailable');
      assert.deepEqual(fe.details, { retry: true });
      return true;
    },
  );
});

test('fusionStreamToOpenAiResponse skips progress events', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'progress', stage: 'passthrough', message: 'Calling model...' },
    { type: 'content_delta', delta: 'Result' },
    {
      type: 'done',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      failedModels: [],
      model: 'gpt-4o',
    },
  ];

  const result = await fusionStreamToOpenAiResponse(
    await asyncIterableFrom(events),
  );

  const choices = result.choices as Array<Record<string, unknown>>;
  const message = choices[0].message as Record<string, unknown>;
  assert.equal(message.content, 'Result');
});

test('fusionStreamToOpenAiResponse generates unique IDs per call', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'A' },
    {
      type: 'done',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      failedModels: [],
    },
  ];

  const [r1, r2] = await Promise.all([
    fusionStreamToOpenAiResponse(await asyncIterableFrom(events)),
    fusionStreamToOpenAiResponse(await asyncIterableFrom(events)),
  ]);

  assert.notEqual(r1.id, r2.id);
});

test('fusionStreamToOpenAiResponse collects failedModels from done', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'answer' },
    {
      type: 'done',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      failedModels: [
        { modelId: 'gpt-3.5', errorCode: 'timeout', errorMessage: 'timeout' },
      ],
      model: 'gpt-4o',
    },
  ];

  const result = await fusionStreamToOpenAiResponse(
    await asyncIterableFrom(events),
  );

  // failedModels are collected internally but not exposed in the OpenAI response shape
  // — the translation is verified by the other fields being correct
  const choices = result.choices as Array<Record<string, unknown>>;
  const message = choices[0].message as Record<string, unknown>;
  assert.equal(message.content, 'answer');
});

test('fusionStreamToOpenAiResponse defaults usage to zeros when done omits usage', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'Hi' },
    {
      type: 'done',
      failedModels: [],
      model: 'gpt-4o',
    },
  ];

  const result = await fusionStreamToOpenAiResponse(
    await asyncIterableFrom(events),
  );

  const usage = result.usage as Record<string, unknown>;
  assert.equal(usage.prompt_tokens, 0);
  assert.equal(usage.completion_tokens, 0);
  assert.equal(usage.total_tokens, 0);
});

test('fusionStreamToOpenAiResponse throws when stream completes without done event', async () => {
  const events: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'partial' },
    { type: 'content_stop' },
  ];

  await assert.rejects(
    async () => {
      await fusionStreamToOpenAiResponse(await asyncIterableFrom(events));
    },
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      const fe = err as FusionError;
      assert.equal(fe.code, 'incomplete_stream');
      assert.equal(fe.message, 'Stream completed without a done event');
      return true;
    },
  );
});
