import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiChatAdapter } from './openai-chat-adapter.js';
import type { ChatRequest, ChatStreamChunk } from '../../../domain/model/chat-types.js';

// ---------------------------------------------------------------------------
// Minimal mock of the OpenAI client interface used by the adapter
// ---------------------------------------------------------------------------

type MockCreateFn = (
  params: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

function mockOpenAiClient(createFn: MockCreateFn): any {
  return {
    chat: {
      completions: {
        create: createFn,
      },
    },
  };
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
    delta?: { role?: string; content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

function mockOpenAiStreamingClient(
  chunks: MockStreamChunk[],
  capturedOptions?: { value: Record<string, unknown> | null },
): any {
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
  };
}

function mockOpenAiStreamingClientReject(error: Error): any {
  return {
    chat: {
      completions: {
        async create(): Promise<AsyncIterable<MockStreamChunk>> {
          throw error;
        },
      },
    },
  };
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

  const client: any = {
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
  };

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

  const client: any = {
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
  };

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

  const client: any = {
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
  };

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

  const client: any = {
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
  };

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
