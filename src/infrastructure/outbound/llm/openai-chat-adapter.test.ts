import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiChatAdapter } from './openai-chat-adapter.js';
import type { ChatRequest, ChatStreamChunk } from '../../../domain/model/chat-types.js';
import { FusionError } from '../../../domain/model/fusion-types.js';

// ---------------------------------------------------------------------------
// Minimal mock of the OpenAI client interface used by the adapter
// ---------------------------------------------------------------------------

// The adapter's constructor expects the concrete `OpenAI` SDK client, but the
// `openai` package must not be imported here (architectural boundary). We derive
// the parameter type from the constructor and feed structurally minimal mocks
// through an `unknown` cast.
type OpenAiClientArg = ConstructorParameters<typeof OpenAiChatAdapter>[0];

type MockCreateFn = (
  params: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

function mockOpenAiClient(createFn: MockCreateFn): OpenAiClientArg {
  return {
    chat: {
      completions: {
        create: createFn,
      },
    },
  } as unknown as OpenAiClientArg;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('OpenAiChatAdapter.complete maps ChatRequest to SDK params', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Date.now() / 1000,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello, how can I help?',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 10,
        total_tokens: 15,
      },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [
      { role: 'system', content: 'Be concise' },
      { role: 'user', content: 'What is TypeScript?' },
    ],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
    options: { temperature: 0.7, maxTokens: 100 },
  };

  const response = await adapter.complete(request);

  // Verify the SDK params
  const params = capturedParams.value!;
  assert.ok(params);
  assert.equal(params.model, 'gpt-4o');
  assert.deepEqual(params.messages, [
    { role: 'system', content: 'Be concise' },
    { role: 'user', content: 'What is TypeScript?' },
  ]);
  assert.equal(params.temperature, 0.7);
  assert.equal(params.max_tokens, 100);

  // Verify the response mapping
  assert.equal(response.content, 'Hello, how can I help?');
  assert.equal(response.model, 'gpt-4o');
  assert.deepEqual(response.usage, {
    promptTokens: 5,
    completionTokens: 10,
    totalTokens: 15,
  });
});

test('OpenAiChatAdapter handles null message content gracefully', async () => {
  const client = mockOpenAiClient(async () => ({
    id: 'chatcmpl-456',
    object: 'chat.completion',
    created: Date.now() / 1000,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
        },
        finish_reason: 'stop',
      },
    ],
    usage: null,
  }));

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const response = await adapter.complete(request);

  assert.equal(response.content, '');
  assert.deepEqual(response.usage, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
});

test('OpenAiChatAdapter handles missing usage object', async () => {
  const client = mockOpenAiClient(async () => ({
    id: 'chatcmpl-789',
    object: 'chat.completion',
    created: Date.now() / 1000,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'OK',
        },
        finish_reason: 'stop',
      },
    ],
    // usage key missing entirely
  }));

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const response = await adapter.complete(request);

  assert.equal(response.content, 'OK');
  assert.deepEqual(response.usage, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
});

test('OpenAiChatAdapter passes responseFormat json_object when provided', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Output JSON' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
    options: {
      responseFormat: { type: 'json_object' },
    },
  };

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.ok(params);
  const rf = params.response_format as Record<string, unknown> | undefined;
  assert.ok(rf);
  assert.equal(rf.type, 'json_object');
});

test('OpenAiChatAdapter passes responseFormat json_schema when provided', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const schema = { type: 'object', properties: { answer: { type: 'string' } } };
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Output JSON' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
    options: {
      responseFormat: { type: 'json_schema', schema },
    },
  };

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.ok(params);
  const rf = params.response_format as Record<string, unknown> | undefined;
  assert.ok(rf);
  assert.equal(rf.type, 'json_schema');
  const js = rf.json_schema as Record<string, unknown>;
  assert.ok(js);
  assert.equal(js.name, 'response');
  assert.equal(js.strict, true);
  assert.deepEqual(js.schema, schema);
});

test('OpenAiChatAdapter completes without options', async () => {
  const client = mockOpenAiClient(async (_params) => {
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'Yes' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Yes?' }],
    model: {
      provider: 'openai',
      model: 'test-model',
      baseURL: 'http://localhost/v1',
      apiKey: 'sk-test',
    },
  };

  const response = await adapter.complete(request);

  assert.equal(response.content, 'Yes');
  assert.equal(response.model, 'test-model');
});

test('OpenAiChatAdapter does not send response_format for text type', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
    options: {
      responseFormat: { type: 'text' },
    },
  };

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.ok(params);
  assert.equal('response_format' in params, false);
});

test('OpenAiChatAdapter propagates SDK errors', async () => {
  const sdkError = new Error('Network failure');
  const client = mockOpenAiClient(async () => {
    throw sdkError;
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  await assert.rejects(adapter.complete(request), (err: unknown) => {
    assert.strictEqual(err, sdkError);
    return true;
  });
});

test('OpenAiChatAdapter forwards AbortSignal to SDK', async () => {
  const capturedOptions: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (_params, options) => {
    capturedOptions.value = options ?? null;
    return {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Date.now() / 1000,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const controller = new AbortController();
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
    options: { signal: controller.signal },
  };

  await adapter.complete(request);

  assert.ok(capturedOptions.value);
  assert.ok(capturedOptions.value!.signal);
  assert.strictEqual(capturedOptions.value!.signal, controller.signal);
});

// ---------------------------------------------------------------------------
// Streaming mock helpers
// ---------------------------------------------------------------------------

type MockStreamChunk = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: { role?: string; content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

function mockOpenAiStreamingClient(
  chunks: MockStreamChunk[],
  capturedOptions?: { value: Record<string, unknown> | null },
): OpenAiClientArg {
  return {
    chat: {
      completions: {
        async create(
          _params: Record<string, unknown>,
          options?: Record<string, unknown>,
        ): Promise<AsyncIterable<MockStreamChunk>> {
          if (capturedOptions) capturedOptions.value = options ?? null;
          return {
            [Symbol.asyncIterator]() {
              let i = 0;
              return {
                async next() {
                  if (i < chunks.length) {
                    return { value: chunks[i++]!, done: false };
                  }
                  return { value: undefined as never, done: true };
                },
              };
            },
          };
        },
      },
    },
  } as unknown as OpenAiClientArg;
}

function mockOpenAiStreamingClientReject(error: Error): OpenAiClientArg {
  return {
    chat: {
      completions: {
        async create(): Promise<AsyncIterable<MockStreamChunk>> {
          throw error;
        },
      },
    },
  } as unknown as OpenAiClientArg;
}

// ---------------------------------------------------------------------------
// Stream tests
// ---------------------------------------------------------------------------

test('OpenAiChatAdapter.stream() yields content_delta chunks', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  // content_delta for "Hello"
  assert.equal(chunks[0].type, 'content_delta');
  assert.equal((chunks[0] as { type: 'content_delta'; delta: string }).delta, 'Hello');

  // content_delta for " world"
  assert.equal(chunks[1].type, 'content_delta');
  assert.equal((chunks[1] as { type: 'content_delta'; delta: string }).delta, ' world');

  // content_stop from finish_reason
  assert.equal(chunks[2].type, 'content_stop');

  // usage from final chunk
  assert.equal(chunks[3].type, 'usage');
  const usageChunk = chunks[3] as {
    type: 'usage';
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  assert.equal(usageChunk.usage.promptTokens, 5);
  assert.equal(usageChunk.usage.completionTokens, 3);
  assert.equal(usageChunk.usage.totalTokens, 8);

  // Exactly 4 chunks
  assert.equal(chunks.length, 4);
});

test('OpenAiChatAdapter.stream() yields content_stop from finish_reason', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-2',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  // Should yield: content_delta, content_stop, usage
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].type, 'content_delta');
  assert.equal(chunks[1].type, 'content_stop');
  assert.equal(chunks[2].type, 'usage');
});

test('OpenAiChatAdapter.stream() yields content_stop at end when no finish_reason', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-3',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  // Should yield: content_delta, content_stop (fallback at stream end)
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].type, 'content_delta');
  assert.equal(chunks[1].type, 'content_stop');
});

test('OpenAiChatAdapter.stream() yields usage from final chunk', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-4',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].type, 'content_stop');
  assert.equal(chunks[1].type, 'usage');
  const usageChunk = chunks[1] as {
    type: 'usage';
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  assert.equal(usageChunk.usage.promptTokens, 100);
  assert.equal(usageChunk.usage.completionTokens, 200);
  assert.equal(usageChunk.usage.totalTokens, 300);
});

test('OpenAiChatAdapter.stream() ignores null content delta', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-5',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: null }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-5',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  // No content_delta for null content, just content_stop and usage
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].type, 'content_stop');
  assert.equal(chunks[1].type, 'usage');
});

test('OpenAiChatAdapter.stream() forwards AbortSignal to SDK', async () => {
  const capturedOptions: { value: Record<string, unknown> | null } = { value: null };
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-6',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks, capturedOptions);
  const adapter = new OpenAiChatAdapter(client);

  const controller = new AbortController();
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
    options: { signal: controller.signal },
  };

  for await (const _ of adapter.stream(request)) {
    // consume stream
  }

  assert.ok(capturedOptions.value);
  assert.ok(capturedOptions.value!.signal);
  assert.strictEqual(capturedOptions.value!.signal, controller.signal);
});

test('OpenAiChatAdapter.stream() propagates SDK create errors', async () => {
  const sdkError = new Error('Network failure');
  const client = mockOpenAiStreamingClientReject(sdkError);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  await assert.rejects(
    async () => {
      for await (const _ of adapter.stream(request)) {
        // should not reach
      }
    },
    (err: unknown) => {
      assert.strictEqual(err, sdkError);
      return true;
    },
  );
});

test('OpenAiChatAdapter.stream() sets stream: true in SDK params', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-7',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = {
    chat: {
      completions: {
        create: async (
          params: Record<string, unknown>,
          _options?: Record<string, unknown>,
        ): Promise<AsyncIterable<MockStreamChunk>> => {
          capturedParams.value = params;
          return {
            [Symbol.asyncIterator]() {
              let i = 0;
              return {
                async next() {
                  if (i < sdkChunks.length) {
                    return { value: sdkChunks[i++]!, done: false };
                  }
                  return { value: undefined as never, done: true };
                },
              };
            },
          };
        },
      },
    },
  } as unknown as OpenAiClientArg;

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  for await (const _ of adapter.stream(request)) {
    // consume
  }

  assert.ok(capturedParams.value);
  assert.equal(capturedParams.value!.stream, true);
});

test('OpenAiChatAdapter.stream() sends stream_options.include_usage in params', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-su1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ];

  const client = {
    chat: {
      completions: {
        async create(params: Record<string, unknown>): Promise<AsyncIterable<MockStreamChunk>> {
          capturedParams.value = params;
          return {
            [Symbol.asyncIterator]() {
              let i = 0;
              return {
                async next() {
                  if (i < sdkChunks.length) return { value: sdkChunks[i++]!, done: false };
                  return { value: undefined as never, done: true };
                },
              };
            },
          };
        },
      },
    },
  } as unknown as OpenAiClientArg;

  const adapter = new OpenAiChatAdapter(client);
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  for await (const _ of adapter.stream(request)) {
    /* consume */
  }

  assert.ok(capturedParams.value);
  const streamOpts = capturedParams.value!.stream_options as Record<string, unknown> | undefined;
  assert.ok(streamOpts, 'stream_options should be present in params');
  assert.equal(streamOpts!.include_usage, true);
});

test('OpenAiChatAdapter.stream() retries without stream_options on 400 error', async () => {
  let callCount = 0;
  const capturedParamsList: Record<string, unknown>[] = [];
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-su2',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }],
    },
  ];

  const client = {
    chat: {
      completions: {
        async create(params: Record<string, unknown>): Promise<AsyncIterable<MockStreamChunk>> {
          callCount++;
          capturedParamsList.push(params);
          if (callCount === 1) {
            const error = new Error('Bad request') as Error & { status: number };
            error.status = 400;
            throw error;
          }
          return {
            [Symbol.asyncIterator]() {
              let i = 0;
              return {
                async next() {
                  if (i < sdkChunks.length) return { value: sdkChunks[i++]!, done: false };
                  return { value: undefined as never, done: true };
                },
              };
            },
          };
        },
      },
    },
  } as unknown as OpenAiClientArg;

  const adapter = new OpenAiChatAdapter(client);
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  assert.equal(callCount, 2, 'should have made 2 create() calls (1 failing + 1 retry)');
  assert.ok('stream_options' in capturedParamsList[0]!, 'first call should include stream_options');
  assert.equal(
    'stream_options' in capturedParamsList[1]!,
    false,
    'retry call should omit stream_options',
  );
  assert.ok(
    chunks.some((c) => c.type === 'content_delta'),
    'stream should have yielded content after retry',
  );
});

// ---------------------------------------------------------------------------
// thinkingStrength / reasoning_effort
// ---------------------------------------------------------------------------

test('OpenAiChatAdapter.complete() sets reasoning_effort when thinkingStrength is low', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'o3',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'o3',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      thinkingStrength: 'low',
    },
  };

  await adapter.complete(request);

  const params = capturedParams.value!;
  assert.ok(params);
  assert.equal(params.reasoning_effort, 'low');
});

test('OpenAiChatAdapter.complete() sets reasoning_effort high', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'o3',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'o3',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      thinkingStrength: 'high',
    },
  };

  await adapter.complete(request);

  assert.equal(capturedParams.value!.reasoning_effort, 'high');
});

test('OpenAiChatAdapter.complete() passes reasoning_effort xhigh through to the SDK', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-5.5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-5.5',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      thinkingStrength: 'xhigh',
    },
  };

  await adapter.complete(request);

  assert.equal(capturedParams.value!.reasoning_effort, 'xhigh');
});

test('OpenAiChatAdapter.complete() omits reasoning_effort when thinkingStrength is off', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      thinkingStrength: 'off',
    },
  };

  await adapter.complete(request);

  assert.equal('reasoning_effort' in capturedParams.value!, false);
});

test('OpenAiChatAdapter.complete() omits reasoning_effort when thinkingStrength is absent', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };

  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  await adapter.complete(request);

  assert.equal('reasoning_effort' in capturedParams.value!, false);
});

test('OpenAiChatAdapter.stream() sets reasoning_effort when thinkingStrength is medium', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-re1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'o3',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = {
    chat: {
      completions: {
        async create(params: Record<string, unknown>): Promise<AsyncIterable<MockStreamChunk>> {
          capturedParams.value = params;
          return {
            [Symbol.asyncIterator]() {
              let i = 0;
              return {
                async next() {
                  if (i < sdkChunks.length) return { value: sdkChunks[i++]!, done: false };
                  return { value: undefined as never, done: true };
                },
              };
            },
          };
        },
      },
    },
  } as unknown as OpenAiClientArg;

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'o3',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      thinkingStrength: 'medium',
    },
  };

  for await (const _ of adapter.stream(request)) {
    // consume
  }

  assert.ok(capturedParams.value);
  assert.equal(capturedParams.value!.reasoning_effort, 'medium');
});

test('OpenAiChatAdapter.stream() omits reasoning_effort when thinkingStrength is off', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-re2',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ];

  const client = {
    chat: {
      completions: {
        async create(params: Record<string, unknown>): Promise<AsyncIterable<MockStreamChunk>> {
          capturedParams.value = params;
          return {
            [Symbol.asyncIterator]() {
              let i = 0;
              return {
                async next() {
                  if (i < sdkChunks.length) return { value: sdkChunks[i++]!, done: false };
                  return { value: undefined as never, done: true };
                },
              };
            },
          };
        },
      },
    },
  } as unknown as OpenAiClientArg;

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      thinkingStrength: 'off',
    },
  };

  for await (const _ of adapter.stream(request)) {
    // consume
  }

  assert.ok(capturedParams.value);
  assert.equal('reasoning_effort' in capturedParams.value!, false);
});

test('OpenAiChatAdapter.stream() passes responseFormat json_schema in params', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-8',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = {
    chat: {
      completions: {
        async create(
          params: Record<string, unknown>,
          _options?: Record<string, unknown>,
        ): Promise<AsyncIterable<MockStreamChunk>> {
          capturedParams.value = params;
          return {
            [Symbol.asyncIterator]() {
              let i = 0;
              return {
                async next() {
                  if (i < sdkChunks.length) {
                    return { value: sdkChunks[i++]!, done: false };
                  }
                  return { value: undefined as never, done: true };
                },
              };
            },
          };
        },
      },
    },
  } as unknown as OpenAiClientArg;

  const adapter = new OpenAiChatAdapter(client);
  const schema = { type: 'object', properties: { answer: { type: 'string' } } };

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
    options: { responseFormat: { type: 'json_schema', schema } },
  };

  for await (const _ of adapter.stream(request)) {
    // consume
  }

  const params = capturedParams.value!;
  const rf = params.response_format as Record<string, unknown> | undefined;
  assert.ok(rf);
  assert.equal(rf.type, 'json_schema');
  const js = rf.json_schema as Record<string, unknown>;
  assert.ok(js);
  assert.equal(js.name, 'response');
  assert.equal(js.strict, true);
  assert.deepEqual(js.schema, schema);
});

// ---------------------------------------------------------------------------
// reasoning_progress detection (DeepSeek-compatible reasoning_content)
// ---------------------------------------------------------------------------

test('OpenAiChatAdapter.stream() yields reasoning_progress for non-empty reasoning_content delta', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-rp1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [
        { index: 0, delta: { reasoning_content: 'Thinking step 1...' }, finish_reason: null },
      ],
    },
    {
      id: 'chatcmpl-rp1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [{ index: 0, delta: { content: 'Answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'deepseek-v4-pro',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  // reasoning_progress must appear before the first content_delta
  const rpIdx = chunks.findIndex((c) => c.type === 'reasoning_progress');
  const cdIdx = chunks.findIndex((c) => c.type === 'content_delta');
  assert.ok(rpIdx >= 0, 'expected at least one reasoning_progress chunk');
  assert.ok(cdIdx >= 0, 'expected at least one content_delta chunk');
  assert.ok(rpIdx < cdIdx, 'reasoning_progress must precede the first content_delta');

  // reasoning_progress must never be a content_delta
  const contentDeltas = chunks.filter((c) => c.type === 'content_delta');
  assert.equal(contentDeltas.length, 1);
  assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Answer');
});

test('OpenAiChatAdapter.stream() does not yield reasoning_progress for null reasoning_content', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-rp2',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { reasoning_content: null }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-rp2',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  const rpChunks = chunks.filter((c) => c.type === 'reasoning_progress');
  assert.equal(rpChunks.length, 0, 'null reasoning_content must not yield reasoning_progress');
});

test('OpenAiChatAdapter.stream() does not yield reasoning_progress for empty-string reasoning_content', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-rp3',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { reasoning_content: '' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-rp3',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  const rpChunks = chunks.filter((c) => c.type === 'reasoning_progress');
  assert.equal(rpChunks.length, 0, 'empty reasoning_content must not yield reasoning_progress');
});

// ---------------------------------------------------------------------------
// Reasoning token / reasoning char accounting
// ---------------------------------------------------------------------------

type CapturedLog = { event: string; fields: Record<string, unknown> };

function capturingLogger(sink: CapturedLog[]) {
  return {
    logStageStart() {},
    logStageEnd() {},
    logFailedModels() {},
    logError() {},
    logRequest(fields: Record<string, unknown>) {
      sink.push({ event: 'request', fields });
    },
    logResponse(fields: Record<string, unknown>) {
      sink.push({ event: 'response', fields });
    },
    log() {},
  };
}

test('OpenAiChatAdapter.complete() extracts reasoning_tokens into usage', async () => {
  const client = mockOpenAiClient(async () => ({
    id: 'id',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-v4-pro',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 50,
      total_tokens: 60,
      completion_tokens_details: { reasoning_tokens: 40 },
    },
  }));

  const adapter = new OpenAiChatAdapter(client);
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'deepseek-v4-pro',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    },
  };

  const response = await adapter.complete(request);

  assert.deepEqual(response.usage, {
    promptTokens: 10,
    completionTokens: 50,
    totalTokens: 60,
    reasoningTokens: 40,
  });
});

test('OpenAiChatAdapter.complete() omits reasoningTokens when details absent', async () => {
  const client = mockOpenAiClient(async () => ({
    id: 'id',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
  }));

  const adapter = new OpenAiChatAdapter(client);
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const response = await adapter.complete(request);

  assert.equal('reasoningTokens' in response.usage, false);
});

test('OpenAiChatAdapter.complete() logs reasoningChars from reasoning_content', async () => {
  const logs: CapturedLog[] = [];
  const client = mockOpenAiClient(async () => ({
    id: 'id',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-v4-pro',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Answer', reasoning_content: 'thinking hard' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
  }));

  const adapter = new OpenAiChatAdapter(
    client,
    capturingLogger(logs) as unknown as ConstructorParameters<typeof OpenAiChatAdapter>[1],
  );
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'deepseek-v4-pro',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    },
  };

  await adapter.complete(request);

  const responseLog = logs.find((l) => l.event === 'response');
  assert.ok(responseLog);
  assert.equal(responseLog!.fields.reasoningChars, 'thinking hard'.length);
});

test('OpenAiChatAdapter.stream() includes reasoning_tokens in the usage chunk', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-rt1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [{ index: 0, delta: { content: 'Answer' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 50,
        total_tokens: 60,
        completion_tokens_details: { reasoning_tokens: 40 },
      },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'deepseek-v4-pro',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  const usageChunk = chunks.find((c) => c.type === 'usage') as {
    type: 'usage';
    usage: { reasoningTokens?: number };
  };
  assert.ok(usageChunk);
  assert.equal(usageChunk.usage.reasoningTokens, 40);
});

test('OpenAiChatAdapter.stream() accumulates reasoningChars from reasoning_content deltas', async () => {
  const logs: CapturedLog[] = [];
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-rc1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [{ index: 0, delta: { reasoning_content: 'step1' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-rc1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [{ index: 0, delta: { reasoning_content: 'step2!' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-rc1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [{ index: 0, delta: { content: 'Answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(
    client,
    capturingLogger(logs) as unknown as ConstructorParameters<typeof OpenAiChatAdapter>[1],
  );
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'deepseek-v4-pro',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    },
  };

  for await (const _ of adapter.stream(request)) {
    // consume
  }

  const responseLog = logs.find((l) => l.event === 'response');
  assert.ok(responseLog);
  // 'step1' (5) + 'step2!' (6) = 11
  assert.equal(responseLog!.fields.reasoningChars, 11);
});

test('OpenAiChatAdapter.stream() yields reasoning_progress before content_delta when a single chunk carries both fields', async () => {
  // vLLM-served DeepSeek can populate reasoning_content and content in one chunk.
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-rp4',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          delta: { reasoning_content: 'Thinking...', content: 'Answer' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'deepseek-v4-pro',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  const rpIdx = chunks.findIndex((c) => c.type === 'reasoning_progress');
  const cdIdx = chunks.findIndex((c) => c.type === 'content_delta');
  assert.ok(rpIdx >= 0, 'expected at least one reasoning_progress chunk');
  assert.ok(cdIdx >= 0, 'expected at least one content_delta chunk');
  assert.ok(
    rpIdx < cdIdx,
    'reasoning_progress must precede content_delta even within a mixed chunk',
  );

  const contentDeltas = chunks.filter((c) => c.type === 'content_delta');
  assert.equal(contentDeltas.length, 1);
  assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Answer');
});

test('OpenAiChatAdapter rejects a tool message missing tool_call_id instead of sending an empty string', async () => {
  let createCalled = false;
  const client = mockOpenAiClient(async () => {
    createCalled = true;
    return {};
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'tool', content: 'result payload' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  await assert.rejects(
    () => adapter.complete(request),
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      assert.equal(err.code, 'invalid_tool_message');
      return true;
    },
  );
  assert.equal(createCalled, false, 'adapter must not call the API with a malformed tool message');
});

test('OpenAiChatAdapter rejects a tool message with an empty tool_call_id', async () => {
  const client = mockOpenAiClient(async () => ({}));
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'tool', content: 'result payload', toolCallId: '' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  await assert.rejects(() => adapter.complete(request), {
    name: 'FusionError',
    code: 'invalid_tool_message',
  });
});

test('OpenAiChatAdapter maps a valid tool message to tool_call_id', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'chatcmpl-tool',
      object: 'chat.completion',
      created: Date.now() / 1000,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'tool', content: 'result payload', toolCallId: 'call_abc123' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  await adapter.complete(request);

  const sdkMessages = capturedParams.value?.messages as Array<Record<string, unknown>>;
  assert.equal(sdkMessages[0]?.role, 'tool');
  assert.equal(sdkMessages[0]?.tool_call_id, 'call_abc123');
});

// ---------------------------------------------------------------------------
// Tool-calling — request mapping (tools + toolChoice)
// ---------------------------------------------------------------------------

test('OpenAiChatAdapter.complete() maps tools to SDK function format', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [
        { index: 0, message: { role: 'assistant', content: null }, finish_reason: 'tool_calls' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);
  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
    options: {
      tools: [
        {
          type: 'function',
          name: 'search',
          description: 'Search the web',
          parameters: { type: 'object' },
        },
      ],
    },
  };

  await adapter.complete(request);

  const params = capturedParams.value!;
  const tools = params.tools as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(tools) && tools.length === 1, 'tools must be forwarded');
  assert.equal(tools[0].type, 'function');
  const fn = tools[0].function as Record<string, unknown>;
  assert.equal(fn.name, 'search');
  assert.equal(fn.description, 'Search the web');
  assert.deepEqual(fn.parameters, { type: 'object' });
});

test('OpenAiChatAdapter.complete() passes toolChoice: "none"', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);
  await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
    options: {
      tools: [{ type: 'function', name: 'fn' }],
      toolChoice: 'none',
    },
  });

  assert.equal(capturedParams.value!.tool_choice, 'none');
});

test('OpenAiChatAdapter.complete() passes toolChoice: "auto"', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);
  await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
    options: { tools: [{ type: 'function', name: 'fn' }], toolChoice: 'auto' },
  });

  assert.equal(capturedParams.value!.tool_choice, 'auto');
});

test('OpenAiChatAdapter.complete() passes toolChoice: "required"', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);
  await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
    options: { tools: [{ type: 'function', name: 'fn' }], toolChoice: 'required' },
  });

  assert.equal(capturedParams.value!.tool_choice, 'required');
});

test('OpenAiChatAdapter.complete() passes named toolChoice as object', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);
  await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
    options: {
      tools: [{ type: 'function', name: 'search' }],
      toolChoice: { type: 'function', function: { name: 'search' } },
    },
  });

  const tc = capturedParams.value!.tool_choice as Record<string, unknown>;
  assert.equal(tc.type, 'function');
  const fn = tc.function as Record<string, unknown>;
  assert.equal(fn.name, 'search');
});

test('OpenAiChatAdapter.complete() maps assistant toolCalls to SDK tool_calls with content null', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);
  await adapter.complete({
    messages: [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'search', arguments: '{"q":"hi"}' }],
      },
    ],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
  });

  const sdkMessages = capturedParams.value!.messages as Array<Record<string, unknown>>;
  const assistantMsg = sdkMessages[0]!;
  assert.equal(assistantMsg.role, 'assistant');
  assert.equal(assistantMsg.content, null, 'empty content must map to null in SDK message');
  const sdkToolCalls = assistantMsg.tool_calls as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(sdkToolCalls) && sdkToolCalls.length === 1);
  assert.equal(sdkToolCalls[0].id, 'call_1');
  assert.equal(sdkToolCalls[0].type, 'function');
  const sdkFn = sdkToolCalls[0].function as Record<string, unknown>;
  assert.equal(sdkFn.name, 'search');
  assert.equal(sdkFn.arguments, '{"q":"hi"}');
});

// ---------------------------------------------------------------------------
// Tool-calling — response mapping (complete)
// ---------------------------------------------------------------------------

test('OpenAiChatAdapter.complete() maps SDK tool_calls in response to domain toolCalls', async () => {
  const client = mockOpenAiClient(async () => ({
    id: 'id',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"TypeScript"}' },
            },
            {
              id: 'call_2',
              type: 'function',
              function: { name: 'lookup', arguments: '{"id":42}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
  }));

  const adapter = new OpenAiChatAdapter(client);
  const response = await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
  });

  assert.ok(response.toolCalls, 'toolCalls must be present');
  assert.equal(response.toolCalls!.length, 2);
  assert.equal(response.toolCalls![0].id, 'call_1');
  assert.equal(response.toolCalls![0].name, 'search');
  assert.equal(response.toolCalls![0].arguments, '{"q":"TypeScript"}');
  assert.equal(response.toolCalls![1].id, 'call_2');
});

test('OpenAiChatAdapter.complete() omits toolCalls from response when not present', async () => {
  const client = mockOpenAiClient(async () => ({
    id: 'id',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));

  const adapter = new OpenAiChatAdapter(client);
  const response = await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
  });

  assert.equal('toolCalls' in response, false, 'toolCalls must be absent when not in SDK response');
});

test('OpenAiChatAdapter.complete() propagates finishReason from SDK', async () => {
  const client = mockOpenAiClient(async () => ({
    id: 'id',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [
      { index: 0, message: { role: 'assistant', content: null }, finish_reason: 'tool_calls' },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));

  const adapter = new OpenAiChatAdapter(client);
  const response = await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
  });

  assert.equal(response.finishReason, 'tool_calls');
});

test('OpenAiChatAdapter.complete() omits finishReason when finish_reason is absent', async () => {
  const client = mockOpenAiClient(async () => ({
    id: 'id',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));

  const adapter = new OpenAiChatAdapter(client);
  const response = await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
  });

  assert.equal('finishReason' in response, false, 'finishReason must be absent when not provided');
});

// ---------------------------------------------------------------------------
// Tool-calling — stream() tool_call_delta
// ---------------------------------------------------------------------------

test('OpenAiChatAdapter.stream() emits tool_call_delta chunks for tool_calls in delta', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-tc1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '' } }],
          } as unknown as NonNullable<NonNullable<MockStreamChunk['choices']>[0]['delta']>,
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-tc1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { name: '', arguments: '{"q":"TypeScript"}' } }],
          } as unknown as NonNullable<NonNullable<MockStreamChunk['choices']>[0]['delta']>,
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-tc1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  const toolCallDeltas = chunks.filter((c) => c.type === 'tool_call_delta');
  assert.ok(toolCallDeltas.length >= 1, 'must emit at least one tool_call_delta');

  // First tool_call_delta should have the id and name from the first chunk
  const first = toolCallDeltas[0] as {
    type: 'tool_call_delta';
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  assert.equal(first.index, 0);
  assert.equal(first.id, 'call_1');
  assert.equal(first.name, 'search');

  // Second tool_call_delta should have the arguments delta
  const second = toolCallDeltas[1] as {
    type: 'tool_call_delta';
    index: number;
    argumentsDelta?: string;
  };
  assert.equal(second.index, 0);
  assert.equal(second.argumentsDelta, '{"q":"TypeScript"}');
  assert.equal('name' in second, false, 'empty name must be omitted from tool_call_delta');
});

test('OpenAiChatAdapter.stream() content_stop carries finishReason', async () => {
  const sdkChunks: MockStreamChunk[] = [
    {
      id: 'chatcmpl-fr1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  const client = mockOpenAiStreamingClient(sdkChunks);
  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  };

  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of adapter.stream(request)) {
    chunks.push(chunk);
  }

  const stop = chunks.find((c) => c.type === 'content_stop') as
    | { type: 'content_stop'; finishReason?: string }
    | undefined;
  assert.ok(stop, 'expected content_stop chunk');
  assert.equal(stop!.finishReason, 'length');
});

test('OpenAiChatAdapter.complete() forwards top_p and stop (stopSequences) to SDK', async () => {
  const capturedParams: { value: Record<string, unknown> | null } = { value: null };
  const client = mockOpenAiClient(async (params) => {
    capturedParams.value = params;
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);
  await adapter.complete({
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: '', apiKey: '' },
    options: { topP: 0.9, stopSequences: ['END', '---'] },
  });

  assert.equal(capturedParams.value!.top_p, 0.9);
  assert.deepEqual(capturedParams.value!.stop, ['END', '---']);
});
