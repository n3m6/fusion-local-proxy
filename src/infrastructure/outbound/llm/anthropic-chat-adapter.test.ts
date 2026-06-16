import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicChatAdapter } from './anthropic-chat-adapter.js';
import type { ChatRequest, ChatStreamChunk } from '../../../domain/model/chat-types.js';

const STUB_CONFIG = { baseURL: '', apiKey: '' } as const;

// ---------------------------------------------------------------------------
// Stub helpers for the Anthropic SDK client used by the adapter
// ---------------------------------------------------------------------------

// The adapter's constructor expects the concrete `Anthropic` SDK client, but
// `@anthropic-ai/sdk` must not be imported here (architectural boundary). We
// derive the parameter type from the constructor and feed structurally minimal
// stubs through an `unknown` cast.
type AnthropicClientArg = ConstructorParameters<typeof AnthropicChatAdapter>[0];

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

interface StubCreateResult {
  content: ContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

type CreateFn = (
  params: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<StubCreateResult>;

function stubAnthropicClient(
  createFn: CreateFn,
  streamFn?: (
    params: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => AsyncIterable<Record<string, unknown>>,
): AnthropicClientArg {
  return {
    messages: {
      create: createFn,
      stream: streamFn ?? async function* () {},
    },
  } as unknown as AnthropicClientArg;
}

// ---------------------------------------------------------------------------
// Helper to build a minimal ChatRequest
// ---------------------------------------------------------------------------

function makeRequest(overrides?: Partial<ChatRequest>): ChatRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    model: {
      provider: 'anthropic',
      model: 'claude-3',
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
    },
    options: undefined,
    ...overrides,
  };
}

// ===========================================================================
// complete() tests
// ===========================================================================

test('System message extraction: system message removed from messages, placed in system param', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'response' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-3',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);

  const request = makeRequest({
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ],
  });

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.ok(params);
  assert.equal(params.system, 'You are helpful.');
  assert.deepEqual(params.messages, [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]);
});

test('Multiple system messages concatenation: two system messages joined by newlines', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'response' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-3',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);

  const request = makeRequest({
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello' },
    ],
  });

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.equal(params.system, 'You are helpful.\n\nBe concise.');
  assert.deepEqual(params.messages, [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]);
});

test('No system messages: system param absent', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'response' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-3',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);

  const request = makeRequest({
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ],
  });

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.equal('system' in params, false);
  assert.deepEqual(params.messages, [
    { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
  ]);
});

test('User/assistant message mapping: roles and content block format', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'response' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-3',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);

  const request = makeRequest({
    messages: [
      { role: 'user', content: 'Question?' },
      { role: 'assistant', content: 'Answer.' },
    ],
  });

  await adapter.complete(request);

  const params = capturedParams.value!;
  const messages = params.messages as Array<{
    role: string;
    content: Array<{ type: string; text: string }>;
  }>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'Question?' }]);
  assert.equal(messages[1].role, 'assistant');
  assert.deepEqual(messages[1].content, [{ type: 'text', text: 'Answer.' }]);
});

test('Options mapping: max_tokens and temperature for json_object (no output_config)', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-3',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);

  const request = makeRequest({
    options: {
      maxTokens: 1024,
      temperature: 0.7,
      responseFormat: { type: 'json_object' },
    },
  });

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.equal(params.max_tokens, 1024);
  assert.equal(params.temperature, 0.7);
  // Anthropic's output_config only supports json_schema; json_object mode relies
  // on the system-prompt JSON instruction instead, so output_config is not set.
  assert.equal(params.output_config, undefined);
});

test('Options mapping: output_config set for json_schema responseFormat', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-3',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const schema = { type: 'object', properties: { answer: { type: 'string' } } };

  const request = makeRequest({
    options: {
      responseFormat: { type: 'json_schema', schema },
    },
  });

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.ok(params);
  const outputConfig = params.output_config as Record<string, unknown> | undefined;
  assert.ok(outputConfig, 'output_config should be set for json_schema');
  const format = outputConfig.format as Record<string, unknown>;
  assert.equal(format.type, 'json_schema');
  assert.deepEqual(format.schema, schema);
});

test('Response content extraction: first text block text returned', async () => {
  const client = stubAnthropicClient(async () => ({
    content: [{ type: 'text', text: 'Hello world' }],
    usage: { input_tokens: 10, output_tokens: 5 },
    model: 'claude-3',
  }));

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const request = makeRequest();
  const response = await adapter.complete(request);

  assert.equal(response.content, 'Hello world');
  assert.equal(response.model, 'claude-3');
  assert.deepEqual(response.usage, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  });
});

test('Empty response content: no text blocks throws error', async () => {
  const client = stubAnthropicClient(async () => ({
    content: [{ type: 'tool_use', id: 'tu1', name: 'get_weather', input: { city: 'Paris' } }],
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'claude-3',
  }));

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const request = makeRequest();

  await assert.rejects(adapter.complete(request), {
    name: 'Error',
    message: 'Anthropic response contained no text content block',
  });
});

test('SDK error propagation for complete(): rejected promise propagates', async () => {
  const sdkError = new Error('API error');
  const client = stubAnthropicClient(async () => {
    throw sdkError;
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const request = makeRequest();

  await assert.rejects(adapter.complete(request), (err: unknown) => {
    assert.strictEqual(err, sdkError);
    return true;
  });
});

test('AbortSignal forwarding for complete(): signal passed in second argument', async () => {
  const capturedOptions: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (_params, options) => {
    capturedOptions.value = options ?? null;
    return {
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-3',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const controller = new AbortController();

  const request = makeRequest({
    options: { signal: controller.signal },
  });

  await adapter.complete(request);

  assert.ok(capturedOptions.value);
  assert.ok(capturedOptions.value!.signal);
  assert.strictEqual(capturedOptions.value!.signal, controller.signal);
});

// ===========================================================================
// stream() tests
// ===========================================================================

// Helper: create an async iterable from an array of events
function asyncIterable<T>(events: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < events.length) {
            return { value: events[i++]!, done: false };
          }
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

function stubAnthropicStreamingClient(
  events: Record<string, unknown>[],
  capturedOptions?: { value: Record<string, unknown> | null },
): AnthropicClientArg {
  return {
    messages: {
      async create() {
        return { content: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'claude-3' };
      },
      stream(
        _params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ): AsyncIterable<Record<string, unknown>> {
        if (capturedOptions) capturedOptions.value = options ?? null;
        return asyncIterable(events);
      },
    },
  } as unknown as AnthropicClientArg;
}

function stubAnthropicStreamingClientReject(error: Error): AnthropicClientArg {
  return {
    messages: {
      async create() {
        return { content: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'claude-3' };
      },
      stream(): AsyncIterable<Record<string, unknown>> {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw error;
              },
            };
          },
        };
      },
    },
  } as unknown as AnthropicClientArg;
}

async function collectStreamChunks(
  adapter: AnthropicChatAdapter,
  request: ChatRequest,
): Promise<ChatStreamChunk[]> {
  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }
  return chunks;
}

test('Stream content delta mapping: text_delta yields content_delta', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'message_delta', usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  const contentDeltas = chunks.filter((c) => c.type === 'content_delta');
  assert.equal(contentDeltas.length, 1);
  assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Hello');
});

test('Stream multiple deltas: three sequential text_delta events yield three content_delta chunks', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'B' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'C' } },
    { type: 'message_delta', usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  const contentDeltas = chunks.filter((c) => c.type === 'content_delta');
  assert.equal(contentDeltas.length, 3);
  assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'A');
  assert.equal((contentDeltas[1] as { type: 'content_delta'; delta: string }).delta, 'B');
  assert.equal((contentDeltas[2] as { type: 'content_delta'; delta: string }).delta, 'C');
});

test('Stream content_stop before usage: message_stop yields content_stop then usage', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 100 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
    { type: 'message_delta', usage: { output_tokens: 50 } },
    { type: 'message_stop' },
  ];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  // Find the positions of content_stop and usage
  const stopIndex = chunks.findIndex((c) => c.type === 'content_stop');
  const usageIndex = chunks.findIndex((c) => c.type === 'usage');
  assert.ok(stopIndex >= 0, 'content_stop not found');
  assert.ok(usageIndex >= 0, 'usage not found');
  assert.ok(
    stopIndex < usageIndex,
    `content_stop (index ${stopIndex}) must precede usage (index ${usageIndex})`,
  );

  const usageChunk = chunks[usageIndex] as {
    type: 'usage';
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  assert.equal(usageChunk.usage.promptTokens, 100);
  assert.equal(usageChunk.usage.completionTokens, 50);
  assert.equal(usageChunk.usage.totalTokens, 150);
});

test('Stream usage is final element: last chunk is always usage', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 5 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'X' } },
    { type: 'message_delta', usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  assert.ok(chunks.length > 0);
  assert.equal(chunks[chunks.length - 1].type, 'usage');
});

test('Non-text content ignored in stream: thinking_delta does not yield content_delta', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me think...' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Result' } },
    { type: 'message_delta', usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  const contentDeltas = chunks.filter((c) => c.type === 'content_delta');
  // Only the text_delta event should produce a content_delta; thinking_delta is not content
  assert.equal(contentDeltas.length, 1);
  assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Result');
});

test('thinking_delta yields reasoning_progress before the first content_delta', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Evaluating...' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } },
    { type: 'message_delta', usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  const rpIdx = chunks.findIndex((c) => c.type === 'reasoning_progress');
  const cdIdx = chunks.findIndex((c) => c.type === 'content_delta');
  assert.ok(rpIdx >= 0, 'expected at least one reasoning_progress chunk');
  assert.ok(cdIdx >= 0, 'expected at least one content_delta chunk');
  assert.ok(rpIdx < cdIdx, 'reasoning_progress must precede the first content_delta');
});

test('multiple thinking_deltas each yield a reasoning_progress chunk', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Step 1' } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Step 2' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Result' } },
    { type: 'message_delta', usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  const rpChunks = chunks.filter((c) => c.type === 'reasoning_progress');
  assert.equal(rpChunks.length, 2, 'each thinking_delta should produce one reasoning_progress');

  const contentDeltas = chunks.filter((c) => c.type === 'content_delta');
  assert.equal(contentDeltas.length, 1);
  assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Result');
});

test('Stream error propagation: error thrown when iteration begins', async () => {
  const sdkError = new Error('Connection failed');
  const client = stubAnthropicStreamingClientReject(sdkError);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);

  await assert.rejects(
    async () => {
      for await (const _ of adapter.stream(makeRequest())) {
        // should not reach
      }
    },
    (err: unknown) => {
      assert.strictEqual(err, sdkError);
      return true;
    },
  );
});

test('AbortSignal forwarding for stream(): signal passed in second argument', async () => {
  const capturedOptions: { value: Record<string, unknown> | null } = { value: null };

  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 1 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } },
    { type: 'message_delta', usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];

  const client = stubAnthropicStreamingClient(events, capturedOptions);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);

  const controller = new AbortController();
  const request = makeRequest({
    options: { signal: controller.signal },
  });

  for await (const _ of adapter.stream(request)) {
    // consume stream
  }

  assert.ok(capturedOptions.value);
  assert.ok(capturedOptions.value!.signal);
  assert.strictEqual(capturedOptions.value!.signal, controller.signal);
});

// ===========================================================================
// Additional edge cases for stream()
// ===========================================================================

test('Stream yields content_stop at end when no message_stop event', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 5 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'message_delta', usage: { output_tokens: 3 } },
    // No message_stop event
  ];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  // Should have content_delta, then content_stop (fallback after loop)
  const stopChunks = chunks.filter((c) => c.type === 'content_stop');
  assert.equal(stopChunks.length, 1);
});

test('Stream handles empty event stream gracefully', async () => {
  const events: Record<string, unknown>[] = [];

  const client = stubAnthropicStreamingClient(events);
  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const chunks = await collectStreamChunks(adapter, makeRequest());

  // Should yield only content_stop (fallback)
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].type, 'content_stop');
});

test('Stream default max_tokens is 4096 when not specified', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = {
    messages: {
      async create() {
        return { content: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'claude-3' };
      },
      stream(params: Record<string, unknown>): AsyncIterable<Record<string, unknown>> {
        capturedParams.value = params;
        return asyncIterable([
          { type: 'message_start', message: { usage: { input_tokens: 0 } } },
          { type: 'message_stop' },
        ]);
      },
    },
  } as unknown as AnthropicClientArg;

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const request = makeRequest({ options: undefined });

  for await (const _ of adapter.stream(request)) {
    // consume
  }

  assert.ok(capturedParams.value);
  assert.equal(capturedParams.value!.max_tokens, 4096);
});

// ===========================================================================
// thinkingStrength / extended thinking
// ===========================================================================

test('Thinking medium: budget_tokens=4096, max_tokens bumped, temperature omitted', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-sonnet',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);

  const request = makeRequest({
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet',
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      thinkingStrength: 'medium',
    },
    options: { temperature: 0.7 },
  });

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.ok(params);

  const thinking = params.thinking as Record<string, unknown> | undefined;
  assert.ok(thinking, 'thinking param should be set');
  assert.equal(thinking.type, 'enabled');
  assert.equal(thinking.budget_tokens, 4096);

  // max_tokens must be > budget_tokens: Math.max(4096, 4096+4096) = 8192
  assert.ok(
    (params.max_tokens as number) > (thinking.budget_tokens as number),
    `max_tokens (${params.max_tokens}) must exceed budget_tokens (${thinking.budget_tokens})`,
  );
  assert.equal(params.max_tokens, 8192);

  // temperature must be absent when thinking is enabled
  assert.equal('temperature' in params, false);
});

test('Thinking low: budget_tokens=1024, max_tokens=5120', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-sonnet',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  await adapter.complete(
    makeRequest({
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet',
        baseURL: 'https://api.anthropic.com',
        apiKey: 'sk-test',
        thinkingStrength: 'low',
      },
    }),
  );

  const params = capturedParams.value!;
  const thinking = params.thinking as Record<string, unknown>;
  assert.equal(thinking.budget_tokens, 1024);
  assert.equal(params.max_tokens, 5120); // Math.max(4096, 1024+4096)
});

test('Thinking high: budget_tokens=12000, max_tokens=16096', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-sonnet',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  await adapter.complete(
    makeRequest({
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet',
        baseURL: 'https://api.anthropic.com',
        apiKey: 'sk-test',
        thinkingStrength: 'high',
      },
    }),
  );

  const params = capturedParams.value!;
  const thinking = params.thinking as Record<string, unknown>;
  assert.equal(thinking.budget_tokens, 12000);
  assert.equal(params.max_tokens, 16096); // Math.max(4096, 12000+4096)
});

test('Thinking xhigh: budget_tokens=24000, max_tokens=28096', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-sonnet',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  await adapter.complete(
    makeRequest({
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet',
        baseURL: 'https://api.anthropic.com',
        apiKey: 'sk-test',
        thinkingStrength: 'xhigh',
      },
    }),
  );

  const params = capturedParams.value!;
  const thinking = params.thinking as Record<string, unknown>;
  assert.equal(thinking.budget_tokens, 24000);
  assert.equal(params.max_tokens, 28096); // Math.max(4096, 24000+4096)
});

test('Thinking off: thinking param absent, temperature and max_tokens unaffected', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-sonnet',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  await adapter.complete(
    makeRequest({
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet',
        baseURL: 'https://api.anthropic.com',
        apiKey: 'sk-test',
        thinkingStrength: 'off',
      },
      options: { temperature: 0.5, maxTokens: 1024 },
    }),
  );

  const params = capturedParams.value!;
  assert.equal('thinking' in params, false);
  assert.equal(params.temperature, 0.5);
  assert.equal(params.max_tokens, 1024);
});

test('Thinking absent: thinking param absent, temperature forwarded normally', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-sonnet',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  await adapter.complete(
    makeRequest({
      options: { temperature: 0.3 },
    }),
  );

  const params = capturedParams.value!;
  assert.equal('thinking' in params, false);
  assert.equal(params.temperature, 0.3);
});

test('Thinking respects explicit maxTokens when larger than budget+4096', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = stubAnthropicClient(async (params) => {
    capturedParams.value = params;
    return {
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-sonnet',
    };
  });

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  await adapter.complete(
    makeRequest({
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet',
        baseURL: 'https://api.anthropic.com',
        apiKey: 'sk-test',
        thinkingStrength: 'low',
      },
      options: { maxTokens: 32000 },
    }),
  );

  const params = capturedParams.value!;
  // Math.max(32000, 1024+4096) = 32000 — explicit large value wins
  assert.equal(params.max_tokens, 32000);
});

test('Stream does not expose output_config when responseFormat is not json_object', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = {
    messages: {
      async create() {
        return { content: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'claude-3' };
      },
      stream(params: Record<string, unknown>): AsyncIterable<Record<string, unknown>> {
        capturedParams.value = params;
        return asyncIterable([
          { type: 'message_start', message: { usage: { input_tokens: 0 } } },
          { type: 'message_stop' },
        ]);
      },
    },
  } as unknown as AnthropicClientArg;

  const adapter = new AnthropicChatAdapter(client, STUB_CONFIG);
  const request = makeRequest({
    options: { responseFormat: { type: 'text' } },
  });

  for await (const _ of adapter.stream(request)) {
    // consume
  }

  assert.ok(capturedParams.value);
  assert.equal('output_config' in capturedParams.value!, false);
});
