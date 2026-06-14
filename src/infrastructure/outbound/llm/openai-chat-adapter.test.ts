import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiChatAdapter } from './openai-chat-adapter.js';
import type { ChatRequest } from '../../../domain/model/chat-types.js';

// ---------------------------------------------------------------------------
// Minimal mock of the OpenAI client interface used by the adapter
// ---------------------------------------------------------------------------

type MockCreateFn = (params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    model: { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
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
    model: { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
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
    model: { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
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
    model: { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
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
    model: { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
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
  const client = mockOpenAiClient(async (params) => {
    return {
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Yes' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Yes?' }],
    model: { provider: 'openai', model: 'test-model', baseURL: 'http://localhost/v1', apiKey: 'sk-test' },
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
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiChatAdapter(client);

  const request: ChatRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
    model: { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
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
    model: { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
  };

  await assert.rejects(
    adapter.complete(request),
    (err: unknown) => {
      assert.strictEqual(err, sdkError);
      return true;
    },
  );
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
    model: { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
    options: { signal: controller.signal },
  };

  await adapter.complete(request);

  assert.ok(capturedOptions.value);
  assert.ok(capturedOptions.value!.signal);
  assert.strictEqual(capturedOptions.value!.signal, controller.signal);
});
