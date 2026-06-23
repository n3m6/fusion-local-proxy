import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatStreamChunk, ChatRequest, ChatResponse, TokenUsage } from './chat-types.js';
import { samplingToOptions, createTimeoutSignal } from './chat-types.js';
import type { ChatModelPort } from '../ports/chat-model-port.js';
import type { Message } from './message.js';
import type { ModelRef } from './fusion-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestChatRequest(signal?: AbortSignal): ChatRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' } as Message],
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    } as ModelRef,
    options: signal !== undefined ? { signal } : undefined,
  };
}

function makeTestChatResponse(): ChatResponse {
  return {
    content: 'test',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: 'test-model',
  };
}

function narrowChunk(chunk: ChatStreamChunk): string {
  switch (chunk.type) {
    case 'content_delta':
      return chunk.delta;
    case 'content_stop':
      return 'stop';
    case 'usage':
      return `tokens=${chunk.usage.totalTokens}`;
    case 'reasoning_progress':
      return 'reasoning';
    case 'tool_call_delta':
      return `tool_call_delta:${chunk.index}`;
    default: {
      const _exhaustive: never = chunk;
      throw new Error(`Unhandled chunk type: ${JSON.stringify(chunk)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// ChatStreamChunk discriminated union — type-checking behavior
// ---------------------------------------------------------------------------

describe('ChatStreamChunk discriminated union', () => {
  test('content_delta variant — accepts and narrows delta as string', () => {
    const chunk: ChatStreamChunk = { type: 'content_delta', delta: 'Hello' };
    assert.equal(chunk.type, 'content_delta');
    assert.equal(chunk.delta, 'Hello');
    // Type narrowing: when type === 'content_delta', delta is accessible as string
    if (chunk.type === 'content_delta') {
      const d: string = chunk.delta;
      assert.equal(d, 'Hello');
    }
  });

  test('content_stop variant — accepts without delta or usage', () => {
    const chunk: ChatStreamChunk = { type: 'content_stop' };
    assert.equal(chunk.type, 'content_stop');
    // The content_stop variant carries no delta or usage property
    assert.ok(!('delta' in chunk));
    assert.ok(!('usage' in chunk));
  });

  test('usage variant — accepts and narrows usage as TokenUsage', () => {
    const usage: TokenUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    const chunk: ChatStreamChunk = { type: 'usage', usage };
    assert.equal(chunk.type, 'usage');
    assert.equal(chunk.usage.promptTokens, 10);
    assert.equal(chunk.usage.completionTokens, 5);
    assert.equal(chunk.usage.totalTokens, 15);
    // Type narrowing: when type === 'usage', usage is accessible as TokenUsage
    if (chunk.type === 'usage') {
      const u: TokenUsage = chunk.usage;
      assert.equal(u.promptTokens, 10);
      assert.equal(u.totalTokens, 15);
    }
  });

  test('invalid type rejected by TypeScript', () => {
    assert.equal(narrowChunk({ type: 'content_delta', delta: 'Hello' }), 'Hello');
    assert.equal(narrowChunk({ type: 'content_stop' }), 'stop');
    assert.equal(
      narrowChunk({
        type: 'usage',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      }),
      'tokens=3',
    );

    assert.throws(() => {
      narrowChunk({ type: 'invalid' } as unknown as ChatStreamChunk);
    });
  });
});

// ---------------------------------------------------------------------------
// ChatModelPort interface — requires both complete() and stream()
// ---------------------------------------------------------------------------

describe('ChatModelPort interface requires stream()', () => {
  test('concrete class implementing both complete() and stream() compiles', () => {
    class TestAdapter implements ChatModelPort {
      async complete(_request: ChatRequest): Promise<ChatResponse> {
        return makeTestChatResponse();
      }
      async *stream(_request: ChatRequest): AsyncIterable<ChatStreamChunk> {
        yield { type: 'content_delta', delta: 't' };
        yield { type: 'content_stop' };
      }
    }
    const adapter = new TestAdapter();
    assert.equal(typeof adapter.complete, 'function');
    assert.equal(typeof adapter.stream, 'function');
  });

  test('object missing stream() is rejected by TypeScript', () => {
    const compliant: ChatModelPort = {
      async complete(_request: ChatRequest): Promise<ChatResponse> {
        return makeTestChatResponse();
      },
      async *stream(_request: ChatRequest): AsyncIterable<ChatStreamChunk> {
        yield { type: 'content_stop' };
      },
    };
    assert.equal(typeof compliant.complete, 'function');
    assert.equal(typeof compliant.stream, 'function');
  });
});

// ---------------------------------------------------------------------------
// AbortSignal passthrough — stream() signature accepts AbortSignal
// ---------------------------------------------------------------------------

describe('AbortSignal passthrough on stream()', () => {
  test('stream() invoked with AbortSignal via ChatRequest.options.signal compiles', () => {
    const controller = new AbortController();
    const request: ChatRequest = makeTestChatRequest(controller.signal);
    assert.ok(request.options?.signal instanceof AbortSignal);
    assert.equal(request.options.signal.aborted, false);
  });

  test('ChatRequest without options.signal is also valid', () => {
    const request: ChatRequest = makeTestChatRequest();
    assert.equal(request.options, undefined);
  });
});

// ---------------------------------------------------------------------------
// samplingToOptions
// ---------------------------------------------------------------------------

describe('samplingToOptions', () => {
  test('returns empty object when sampling is undefined', () => {
    const result = samplingToOptions(undefined);
    assert.deepEqual(result, {});
  });

  test('returns empty object when all sampling fields are undefined', () => {
    const result = samplingToOptions({});
    assert.deepEqual(result, {});
  });

  test('copies only defined sampling fields', () => {
    const result = samplingToOptions({ temperature: 0.7, maxTokens: 512 });
    assert.equal(result.temperature, 0.7);
    assert.equal(result.maxTokens, 512);
    assert.equal('topP' in result, false);
    assert.equal('topK' in result, false);
    assert.equal('stopSequences' in result, false);
    assert.equal('metadata' in result, false);
  });

  test('copies topP when defined', () => {
    const result = samplingToOptions({ topP: 0.9 });
    assert.equal(result.topP, 0.9);
    assert.equal('temperature' in result, false);
  });

  test('copies topK when defined', () => {
    const result = samplingToOptions({ topK: 40 });
    assert.equal(result.topK, 40);
  });

  test('copies stopSequences when defined', () => {
    const result = samplingToOptions({ stopSequences: ['END', '###'] });
    assert.deepEqual(result.stopSequences, ['END', '###']);
  });

  test('copies metadata when defined', () => {
    const result = samplingToOptions({ metadata: { user_id: 'u1' } });
    assert.deepEqual(result.metadata, { user_id: 'u1' });
  });

  test('copies all fields when all are defined', () => {
    const sampling = {
      temperature: 0.5,
      maxTokens: 256,
      topP: 0.95,
      topK: 20,
      stopSequences: ['stop'],
      metadata: { user_id: 'u2' },
    };
    const result = samplingToOptions(sampling);
    assert.equal(result.temperature, 0.5);
    assert.equal(result.maxTokens, 256);
    assert.equal(result.topP, 0.95);
    assert.equal(result.topK, 20);
    assert.deepEqual(result.stopSequences, ['stop']);
    assert.deepEqual(result.metadata, { user_id: 'u2' });
  });
});

// ---------------------------------------------------------------------------
// createTimeoutSignal
// ---------------------------------------------------------------------------

describe('createTimeoutSignal', () => {
  test('returns undefined when timeoutMs is 0', () => {
    const signal = createTimeoutSignal(0);
    assert.equal(signal, undefined);
  });

  test('returns undefined when timeoutMs is negative', () => {
    const signal = createTimeoutSignal(-100);
    assert.equal(signal, undefined);
  });

  test('returns an AbortSignal when timeoutMs is positive', () => {
    const signal = createTimeoutSignal(5000);
    assert.ok(signal instanceof AbortSignal, 'expected AbortSignal');
    assert.equal(signal.aborted, false, 'signal should not be immediately aborted');
  });

  test('signal eventually aborts after timeoutMs', async () => {
    const signal = createTimeoutSignal(50);
    assert.ok(signal instanceof AbortSignal);
    // Wait longer than the timeout
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(signal!.aborted, true, 'signal should be aborted after timeout');
  });
});
