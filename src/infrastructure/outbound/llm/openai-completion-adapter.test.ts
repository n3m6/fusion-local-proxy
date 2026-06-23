import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiCompletionAdapter } from './openai-completion-adapter.js';
import type {
  TextCompletionRequest,
  TextCompletionChunk,
} from '../../../domain/model/text-completion-types.js';
import type { LoggerPort } from '../../../domain/ports/logger-port.js';

const STUB_CONFIG = { baseURL: 'http://localhost/v1', apiKey: 'sk-test' } as const;

type CompletionClientArg = ConstructorParameters<typeof OpenAiCompletionAdapter>[0];

type MockCompleteFn = (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
type MockStreamFn = (
  params: Record<string, unknown>,
) => Promise<AsyncIterable<Record<string, unknown>>>;

function mockCompletionClient(
  completeFn: MockCompleteFn,
  streamFn?: MockStreamFn,
): CompletionClientArg {
  return {
    completions: {
      create: (params: Record<string, unknown>) => {
        if (params.stream) {
          return streamFn
            ? streamFn(params)
            : Promise.resolve({
                [Symbol.asyncIterator]: () => ({
                  async next() {
                    return { value: undefined as never, done: true };
                  },
                }),
              });
        }
        return completeFn(params);
      },
    },
  } as unknown as CompletionClientArg;
}

function asyncIterableOf(
  chunks: Record<string, unknown>[],
): AsyncIterable<Record<string, unknown>> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length) return { value: chunks[i++]!, done: false };
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

type CapturedLog = { event: string; fields: Record<string, unknown> };

function capturingLogger(sink: CapturedLog[]): LoggerPort {
  return {
    logStageStart() {},
    logStageEnd() {},
    logFailedModels() {},
    logError() {},
    logRequest() {},
    logResponse() {},
    log(_level: string, event: string, fields?: Record<string, unknown>) {
      sink.push({ event, fields: fields ?? {} });
    },
  };
}

const STUB_MODEL = {
  provider: 'openai' as const,
  model: 'deepseek-coder',
  baseURL: 'http://localhost/v1',
  apiKey: 'sk-test',
};

function makeRequest(overrides?: Partial<TextCompletionRequest>): TextCompletionRequest {
  return {
    prompt: 'def hello',
    model: STUB_MODEL,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// complete() — field forwarding
// ---------------------------------------------------------------------------

test('OpenAiCompletionAdapter.complete() forwards prompt and model', async () => {
  const captured: { value: Record<string, unknown> | null } = { value: null };
  const client = mockCompletionClient(async (params) => {
    captured.value = params;
    return {
      model: 'deepseek-coder',
      choices: [{ text: 'world', finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    };
  });

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  await adapter.complete(makeRequest({ prompt: 'def hello' }));

  assert.ok(captured.value, 'create() must have been called');
  assert.equal(captured.value.prompt, 'def hello');
  assert.equal(captured.value.model, 'deepseek-coder');
  assert.equal(captured.value.stream, false);
});

test('OpenAiCompletionAdapter.complete() forwards optional suffix, maxTokens, temperature, stop', async () => {
  const captured: { value: Record<string, unknown> | null } = { value: null };
  const client = mockCompletionClient(async (params) => {
    captured.value = params;
    return {
      model: 'm',
      choices: [{ text: 'x', finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  await adapter.complete(
    makeRequest({ suffix: '\n  pass', maxTokens: 64, temperature: 0.2, stop: '\\n' }),
  );

  assert.equal(captured.value!.suffix, '\n  pass');
  assert.equal(captured.value!.max_tokens, 64);
  assert.equal(captured.value!.temperature, 0.2);
  assert.equal(captured.value!.stop, '\\n');
});

test('OpenAiCompletionAdapter.complete() omits optional fields when absent', async () => {
  const captured: { value: Record<string, unknown> | null } = { value: null };
  const client = mockCompletionClient(async (params) => {
    captured.value = params;
    return {
      model: 'm',
      choices: [{ text: 'x', finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  await adapter.complete(makeRequest());

  assert.equal('suffix' in captured.value!, false);
  assert.equal('max_tokens' in captured.value!, false);
  assert.equal('temperature' in captured.value!, false);
  assert.equal('stop' in captured.value!, false);
});

// ---------------------------------------------------------------------------
// complete() — response mapping
// ---------------------------------------------------------------------------

test('OpenAiCompletionAdapter.complete() maps text, model, and usage', async () => {
  const client = mockCompletionClient(async () => ({
    model: 'returned-model',
    choices: [{ text: ' world', finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
  }));

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  const result = await adapter.complete(makeRequest());

  assert.equal(result.text, ' world');
  assert.equal(result.model, 'returned-model');
  assert.deepEqual(result.usage, {
    promptTokens: 3,
    completionTokens: 5,
    totalTokens: 8,
  });
});

test('OpenAiCompletionAdapter.complete() defaults text to empty string when choices is empty', async () => {
  const client = mockCompletionClient(async () => ({
    model: 'm',
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
  }));

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  const result = await adapter.complete(makeRequest());

  assert.equal(result.text, '');
});

test('OpenAiCompletionAdapter.complete() defaults usage to zeroes when usage is missing', async () => {
  const client = mockCompletionClient(async () => ({
    model: 'm',
    choices: [{ text: 'hi', finish_reason: 'stop' }],
  }));

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  const result = await adapter.complete(makeRequest());

  assert.deepEqual(result.usage, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
});

// ---------------------------------------------------------------------------
// complete() — logging
// ---------------------------------------------------------------------------

test('OpenAiCompletionAdapter.complete() logs openai_completion_request and openai_completion_response', async () => {
  const logs: CapturedLog[] = [];
  const client = mockCompletionClient(async () => ({
    model: 'm',
    choices: [{ text: 'hi', finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  }));

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG, capturingLogger(logs));
  await adapter.complete(makeRequest({ prompt: 'test prompt' }));

  const reqLog = logs.find((l) => l.event === 'openai_completion_request');
  assert.ok(reqLog, 'must log openai_completion_request');
  assert.equal(reqLog!.fields.modelId, 'deepseek-coder');
  assert.equal(reqLog!.fields.promptChars, 'test prompt'.length);
  assert.equal(reqLog!.fields.hasSuffix, false);

  const resLog = logs.find((l) => l.event === 'openai_completion_response');
  assert.ok(resLog, 'must log openai_completion_response');
  assert.equal(resLog!.fields.textChars, 'hi'.length);
});

test('OpenAiCompletionAdapter.complete() logs hasSuffix: true when suffix is present', async () => {
  const logs: CapturedLog[] = [];
  const client = mockCompletionClient(async () => ({
    model: 'm',
    choices: [{ text: 'x', finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG, capturingLogger(logs));
  await adapter.complete(makeRequest({ suffix: '\n  pass' }));

  const reqLog = logs.find((l) => l.event === 'openai_completion_request');
  assert.ok(reqLog);
  assert.equal(reqLog!.fields.hasSuffix, true);
});

// ---------------------------------------------------------------------------
// stream() — chunk yielding
// ---------------------------------------------------------------------------

test('OpenAiCompletionAdapter.stream() yields text_delta for each chunk with text', async () => {
  const sdkChunks = [
    { choices: [{ text: 'Hello', finish_reason: null }] },
    { choices: [{ text: ' world', finish_reason: null }] },
    { choices: [{ text: '', finish_reason: 'stop' }] },
  ];

  const client = mockCompletionClient(
    async () => ({ model: 'm', choices: [], usage: null }),
    async () => asyncIterableOf(sdkChunks),
  );

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  const chunks: TextCompletionChunk[] = [];
  for await (const chunk of adapter.stream(makeRequest())) {
    chunks.push(chunk);
  }

  const deltas = chunks.filter((c) => c.type === 'text_delta');
  assert.equal(deltas.length, 2);
  assert.equal((deltas[0] as { type: 'text_delta'; delta: string }).delta, 'Hello');
  assert.equal((deltas[1] as { type: 'text_delta'; delta: string }).delta, ' world');
});

test('OpenAiCompletionAdapter.stream() yields text_stop on finish_reason', async () => {
  const sdkChunks = [
    { choices: [{ text: 'Hi', finish_reason: null }] },
    { choices: [{ text: '', finish_reason: 'stop' }] },
  ];

  const client = mockCompletionClient(
    async () => ({ model: 'm', choices: [], usage: null }),
    async () => asyncIterableOf(sdkChunks),
  );

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  const chunks: TextCompletionChunk[] = [];
  for await (const chunk of adapter.stream(makeRequest())) {
    chunks.push(chunk);
  }

  const stops = chunks.filter((c) => c.type === 'text_stop');
  assert.equal(stops.length, 1, 'must yield exactly one text_stop');
  // text_delta before text_stop
  const deltaIdx = chunks.findIndex((c) => c.type === 'text_delta');
  const stopIdx = chunks.findIndex((c) => c.type === 'text_stop');
  assert.ok(deltaIdx < stopIdx, 'text_delta must precede text_stop');
});

test('OpenAiCompletionAdapter.stream() yields fallback text_stop when no finish_reason seen', async () => {
  const sdkChunks = [
    { choices: [{ text: 'Hello', finish_reason: null }] },
    { choices: [{ text: ' there', finish_reason: null }] },
    // no finish_reason chunk — stream ends abruptly
  ];

  const client = mockCompletionClient(
    async () => ({ model: 'm', choices: [], usage: null }),
    async () => asyncIterableOf(sdkChunks),
  );

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  const chunks: TextCompletionChunk[] = [];
  for await (const chunk of adapter.stream(makeRequest())) {
    chunks.push(chunk);
  }

  const stops = chunks.filter((c) => c.type === 'text_stop');
  assert.equal(stops.length, 1, 'fallback text_stop must be yielded when stream ends without one');
  assert.equal(chunks[chunks.length - 1].type, 'text_stop', 'text_stop must be the last chunk');
});

test('OpenAiCompletionAdapter.stream() does not yield text_stop twice when finish_reason present', async () => {
  const sdkChunks = [{ choices: [{ text: 'x', finish_reason: 'stop' }] }];

  const client = mockCompletionClient(
    async () => ({ model: 'm', choices: [], usage: null }),
    async () => asyncIterableOf(sdkChunks),
  );

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  const chunks: TextCompletionChunk[] = [];
  for await (const chunk of adapter.stream(makeRequest())) {
    chunks.push(chunk);
  }

  const stops = chunks.filter((c) => c.type === 'text_stop');
  assert.equal(stops.length, 1, 'must not yield two text_stop chunks');
});

// ---------------------------------------------------------------------------
// stream() — logging
// ---------------------------------------------------------------------------

test('OpenAiCompletionAdapter.stream() logs openai_completion_stream_request', async () => {
  const logs: CapturedLog[] = [];
  const sdkChunks = [{ choices: [{ text: 'hi', finish_reason: 'stop' }] }];

  const client = mockCompletionClient(
    async () => ({ model: 'm', choices: [], usage: null }),
    async () => asyncIterableOf(sdkChunks),
  );

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG, capturingLogger(logs));
  for await (const _ of adapter.stream(makeRequest({ prompt: 'my prompt', suffix: 'end' }))) {
    // consume
  }

  const reqLog = logs.find((l) => l.event === 'openai_completion_stream_request');
  assert.ok(reqLog, 'must log openai_completion_stream_request');
  assert.equal(reqLog!.fields.modelId, 'deepseek-coder');
  assert.equal(reqLog!.fields.promptChars, 'my prompt'.length);
  assert.equal(reqLog!.fields.hasSuffix, true);
});

// ---------------------------------------------------------------------------
// stream() — field forwarding
// ---------------------------------------------------------------------------

test('OpenAiCompletionAdapter.stream() forwards suffix, maxTokens, temperature, stop to SDK', async () => {
  const captured: { value: Record<string, unknown> | null } = { value: null };

  const client = {
    completions: {
      create: async (params: Record<string, unknown>) => {
        captured.value = params;
        return asyncIterableOf([{ choices: [{ text: 'x', finish_reason: 'stop' }] }]);
      },
    },
  } as unknown as CompletionClientArg;

  const adapter = new OpenAiCompletionAdapter(client, STUB_CONFIG);
  for await (const _ of adapter.stream(
    makeRequest({ suffix: '\n  end', maxTokens: 128, temperature: 0.5, stop: ['###'] }),
  )) {
    // consume
  }

  assert.equal(captured.value!.suffix, '\n  end');
  assert.equal(captured.value!.max_tokens, 128);
  assert.equal(captured.value!.temperature, 0.5);
  assert.deepEqual(captured.value!.stop, ['###']);
  assert.equal(captured.value!.stream, true);
});
