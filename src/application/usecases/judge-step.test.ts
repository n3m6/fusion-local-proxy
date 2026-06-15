import test from 'node:test';
import assert from 'node:assert/strict';
import { JudgeStep } from './judge-step.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  TokenUsage,
} from '../../domain/model/chat-types.js';
import type { ModelRef, PanelResult } from '../../domain/model/fusion-types.js';
import type { Message } from '../../domain/model/message.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface StubChatModelPort extends ChatModelPort {
  _calls: ChatRequest[];
}

function stubChatPort(response?: ChatResponse): StubChatModelPort {
  const calls: ChatRequest[] = [];
  return {
    _calls: calls,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request);
      return (
        response ?? {
          content: 'stub response',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: 'stub-model',
        }
      );
    },
    stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
      calls.push(request);
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              return { value: undefined as never, done: true };
            },
          };
        },
      };
    },
  };
}

function stubChatPortReject(error: Error): StubChatModelPort {
  const calls: ChatRequest[] = [];
  return {
    _calls: calls,
    async complete(_request: ChatRequest): Promise<ChatResponse> {
      calls.push(_request);
      throw error;
    },
    stream(_request: ChatRequest): AsyncIterable<ChatStreamChunk> {
      calls.push(_request);
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
  };
}

interface StubLoggerPort extends LoggerPort {
  _calls: Array<{ method: string; args: unknown[] }>;
}

function stubLoggerPort(): StubLoggerPort {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    _calls: calls,
    logStageStart(stage: string): void {
      calls.push({ method: 'logStageStart', args: [stage] });
    },
    logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void {
      calls.push({ method: 'logStageEnd', args: [stage, durationMs, usage] });
    },
    logFailedModels(): void {
      calls.push({ method: 'logFailedModels', args: [] });
    },
    logError(stage: string, error: Error): void {
      calls.push({ method: 'logError', args: [stage, error] });
    },
  };
}

function stubClockPort(times: number[]): ClockPort & { _callCount: number } {
  let idx = 0;
  const port = {
    _callCount: 0,
    now(): number {
      port._callCount++;
      const t = times[idx] ?? times[times.length - 1];
      if (idx < times.length) idx++;
      return t;
    },
  };
  return port;
}

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const validAnalysisJson = JSON.stringify({
  consensus: ['All models agree Paris is the capital of France'],
  contradictions: [{ topic: 'Best cuisine', perspectives: ['French', 'Italian'] }],
  unique_insights: [{ model: 'gpt-4o', insight: 'Paris has over 400 parks' }],
  blind_spots: ['No model mentioned the Paris catacombs'],
});

const validAnalysisMissingConsensus = JSON.stringify({
  contradictions: [],
  unique_insights: [],
  blind_spots: [],
});

function judgeModel(overrides?: Partial<ModelRef>): ModelRef {
  return {
    provider: 'openai',
    model: 'gpt-4o-judge',
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-judge',
    ...overrides,
  };
}

function panelResult(overrides?: Partial<PanelResult>): PanelResult {
  return {
    modelId: 'gpt-4o',
    provider: 'openai',
    content: 'Paris is the capital of France.',
    usage: { promptTokens: 10, completionTokens: 20 },
    latencyMs: 300,
    ...overrides,
  };
}

const sampleMessages: Message[] = [{ role: 'user', content: 'What is the capital of France?' }];

const responseWithUsage: TokenUsage = {
  promptTokens: 50,
  completionTokens: 100,
  totalTokens: 150,
};

// ---------------------------------------------------------------------------
// Test: Successful analysis parse
// ---------------------------------------------------------------------------

test('successful analysis parse returns Analysis with all fields populated', async () => {
  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([100, 250]);

  const step = new JudgeStep(chatPort, logger, clock);
  const result = await step.analyze([panelResult()], sampleMessages, judgeModel(), 0);

  assert.ok(result !== null, 'expected non-null Analysis');
  assert.equal(result!.consensus.length, 1);
  assert.equal(result!.consensus[0], 'All models agree Paris is the capital of France');
  assert.equal(result!.contradictions.length, 1);
  assert.equal(result!.unique_insights.length, 1);
  assert.equal(result!.blind_spots.length, 1);

  // loggerPort.logStageStart('judge') called once
  const startCalls = logger._calls.filter((c) => c.method === 'logStageStart');
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].args[0], 'judge');

  // loggerPort.logStageEnd('judge', durationMs, usage) called once
  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(endCalls.length, 1);
  assert.equal(endCalls[0].args[0], 'judge');
  assert.equal(endCalls[0].args[1], 150); // 250 - 100
  assert.deepStrictEqual(endCalls[0].args[2], responseWithUsage);

  // loggerPort.logError() NOT called
  const errorCalls = logger._calls.filter((c) => c.method === 'logError');
  assert.equal(errorCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Test: Schema validation failure returns null
// ---------------------------------------------------------------------------

test('schema validation failure (missing consensus) returns null', async () => {
  const chatPort = stubChatPort({
    content: validAnalysisMissingConsensus,
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new JudgeStep(chatPort, logger, clock);
  const result = await step.analyze([panelResult()], sampleMessages, judgeModel(), 0);

  assert.equal(result, null);

  // loggerPort.logError('judge', error) called once with ZodError
  const errorCalls = logger._calls.filter((c) => c.method === 'logError');
  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0].args[0], 'judge');
  assert.ok(errorCalls[0].args[1] instanceof Error);
  // ZodError has .issues property
  const zodError = errorCalls[0].args[1] as Error & { issues?: unknown[] };
  assert.ok(zodError.issues !== undefined, 'expected ZodError with issues');

  // loggerPort.logStageEnd() NOT called
  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(endCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Test: Judge model error returns null
// ---------------------------------------------------------------------------

test('judge model error (chatPort rejects) returns null', async () => {
  const sdkError = new Error('Network timeout');
  const chatPort = stubChatPortReject(sdkError);
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new JudgeStep(chatPort, logger, clock);
  const result = await step.analyze([panelResult()], sampleMessages, judgeModel(), 0);

  assert.equal(result, null);

  // loggerPort.logError('judge', error) called once with the rejected error
  const errorCalls = logger._calls.filter((c) => c.method === 'logError');
  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0].args[0], 'judge');
  assert.equal(errorCalls[0].args[1], sdkError);

  // Should not throw - we reached this line, so no throw occurred
});

// ---------------------------------------------------------------------------
// Test: Invalid JSON response returns null
// ---------------------------------------------------------------------------

test('invalid JSON response returns null and logs SyntaxError', async () => {
  const chatPort = stubChatPort({
    content: 'This is not valid JSON at all!',
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new JudgeStep(chatPort, logger, clock);
  const result = await step.analyze([panelResult()], sampleMessages, judgeModel(), 0);

  assert.equal(result, null);

  // loggerPort.logError('judge', error) called once with SyntaxError
  const errorCalls = logger._calls.filter((c) => c.method === 'logError');
  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0].args[0], 'judge');
  assert.ok(errorCalls[0].args[1] instanceof SyntaxError, 'expected SyntaxError');
});

// ---------------------------------------------------------------------------
// Test: Empty panel results handled
// ---------------------------------------------------------------------------

test('empty panel results does not throw and proceeds with judge call', async () => {
  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([100, 200]);

  const step = new JudgeStep(chatPort, logger, clock);
  const result = await step.analyze([], sampleMessages, judgeModel(), 0);

  // Should not throw and should return an Analysis
  assert.ok(result !== null, 'expected non-null Analysis with empty panels');
  assert.equal(result!.consensus.length, 1);

  // The judge call should have proceeded normally
  assert.equal(chatPort._calls.length, 1);
  const req = chatPort._calls[0];
  assert.ok(req.messages.length >= 2, 'should have system + user messages');
  const userMsg = req.messages.find((m) => m.role === 'user');
  assert.ok(userMsg !== undefined, 'should have user message');
  assert.ok(userMsg!.content.length > 0, 'user message should be non-empty');
});

// ---------------------------------------------------------------------------
// Test: Logger called on failure (combined failure scenarios)
// ---------------------------------------------------------------------------

test('logger called exactly once on each failure scenario', async () => {
  // Test 1: SDK error
  {
    const chatPort = stubChatPortReject(new Error('fail'));
    const logger = stubLoggerPort();
    const step = new JudgeStep(chatPort, logger, stubClockPort([0, 0]));
    const result = await step.analyze([], sampleMessages, judgeModel(), 0);
    assert.equal(result, null);
    const errorCalls = logger._calls.filter((c) => c.method === 'logError');
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0].args[0], 'judge');
  }

  // Test 2: Invalid JSON
  {
    const chatPort = stubChatPort({ content: 'bad json', usage: responseWithUsage, model: 'm' });
    const logger = stubLoggerPort();
    const step = new JudgeStep(chatPort, logger, stubClockPort([0, 0]));
    const result = await step.analyze([], sampleMessages, judgeModel(), 0);
    assert.equal(result, null);
    const errorCalls = logger._calls.filter((c) => c.method === 'logError');
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0].args[0], 'judge');
  }

  // Test 3: Schema validation failure
  {
    const chatPort = stubChatPort({
      content: validAnalysisMissingConsensus,
      usage: responseWithUsage,
      model: 'm',
    });
    const logger = stubLoggerPort();
    const step = new JudgeStep(chatPort, logger, stubClockPort([0, 0]));
    const result = await step.analyze([], sampleMessages, judgeModel(), 0);
    assert.equal(result, null);
    const errorCalls = logger._calls.filter((c) => c.method === 'logError');
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0].args[0], 'judge');
  }
});

// ---------------------------------------------------------------------------
// Test: Timeout signal attached when timeoutMs > 0
// ---------------------------------------------------------------------------

test('timeout signal attached when timeoutMs > 0', async () => {
  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([100, 200]);

  const step = new JudgeStep(chatPort, logger, clock);
  await step.analyze(
    [panelResult()],
    sampleMessages,
    judgeModel(),
    5000, // timeoutMs > 0
  );

  assert.equal(chatPort._calls.length, 1);
  const req = chatPort._calls[0];
  assert.ok(req.options !== undefined, 'expected options to be defined');
  assert.ok(req.options!.signal !== undefined, 'expected signal to be defined');
  assert.ok(req.options!.signal instanceof AbortSignal);
  assert.equal(req.options!.signal.aborted, false, 'signal should not be aborted on success');
});

// ---------------------------------------------------------------------------
// Test: No timeout signal when timeoutMs is 0
// ---------------------------------------------------------------------------

test('no timeout signal when timeoutMs is 0', async () => {
  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([100, 200]);

  const step = new JudgeStep(chatPort, logger, clock);
  await step.analyze(
    [panelResult()],
    sampleMessages,
    judgeModel(),
    0, // timeoutMs === 0
  );

  assert.equal(chatPort._calls.length, 1);
  const req = chatPort._calls[0];
  assert.ok(req.options !== undefined, 'expected options to be defined');
  assert.equal(req.options!.signal, undefined, 'expected no signal when timeoutMs is 0');
});

// ---------------------------------------------------------------------------
// Test: Cleanup on success — clearTimeout prevents dangling timer
// ---------------------------------------------------------------------------

test('cleanup on success clears timeout', async () => {
  // Use a spy-like approach: override global setTimeout/clearTimeout to track calls
  // Actually, we can test that clearTimeout is called by observing the signal state
  // The real test is that the finally block clears the timeout.
  // We verify that the AbortSignal does not fire after a delay.

  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([100, 200]);

  const step = new JudgeStep(chatPort, logger, clock);

  // Track setTimeout and clearTimeout calls
  let setTimeoutCallCount = 0;
  let clearTimeoutCallCount = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  try {
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number) => {
      setTimeoutCallCount++;
      return originalSetTimeout(fn, ms);
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
      clearTimeoutCallCount++;
      return originalClearTimeout(id);
    }) as typeof clearTimeout;

    await step.analyze([panelResult()], sampleMessages, judgeModel(), 5000);

    // setTimeout should have been called (to create the timeout)
    assert.ok(setTimeoutCallCount >= 1, 'setTimeout should have been called');
    // clearTimeout should have been called in the finally block
    assert.ok(clearTimeoutCallCount >= 1, 'clearTimeout should have been called for cleanup');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

// ---------------------------------------------------------------------------
// Test: Cleanup on error also clears timeout
// ---------------------------------------------------------------------------

test('cleanup on error also clears timeout', async () => {
  const chatPort = stubChatPortReject(new Error('crash'));
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new JudgeStep(chatPort, logger, clock);

  let clearTimeoutCallCount = 0;
  const originalClearTimeout = globalThis.clearTimeout;

  try {
    globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
      clearTimeoutCallCount++;
      return originalClearTimeout(id);
    }) as typeof clearTimeout;

    await step.analyze([panelResult()], sampleMessages, judgeModel(), 5000);

    // clearTimeout should have been called in the finally block
    assert.ok(clearTimeoutCallCount >= 1, 'clearTimeout should be called even on error');
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
  }
});

// ---------------------------------------------------------------------------
// Test: failed_models from FusionError during judge do NOT block (graceful degradation)
// ---------------------------------------------------------------------------

test('judge failure with FusionError does not throw (graceful degradation)', async () => {
  const fusionError = new (await import('../../domain/model/fusion-types.js')).FusionError(
    'model_overload',
    'Judge model overloaded',
  );
  const chatPort = stubChatPortReject(fusionError);
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new JudgeStep(chatPort, logger, clock);
  const result = await step.analyze([panelResult()], sampleMessages, judgeModel(), 0);

  // Must not throw and must return null
  assert.equal(result, null);

  // Must log the error
  const errorCalls = logger._calls.filter((c) => c.method === 'logError');
  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0].args[0], 'judge');
  assert.ok(errorCalls[0].args[1] instanceof Error);
});

// ---------------------------------------------------------------------------
// Test: logStageEnd receives correct usage from response
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test: responseFormat selection based on judgeModel.jsonMode
// ---------------------------------------------------------------------------

test('judge uses json_schema responseFormat by default (jsonMode absent)', async () => {
  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new JudgeStep(chatPort, logger, clock);
  await step.analyze([panelResult()], sampleMessages, judgeModel(), 0);

  assert.equal(chatPort._calls.length, 1);
  const req = chatPort._calls[0];
  assert.ok(req.options?.responseFormat !== undefined, 'expected responseFormat');
  assert.equal(req.options!.responseFormat!.type, 'json_schema');
});

test('judge uses json_schema responseFormat when jsonMode is explicitly json_schema', async () => {
  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: responseWithUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new JudgeStep(chatPort, logger, clock);
  await step.analyze([panelResult()], sampleMessages, judgeModel({ jsonMode: 'json_schema' }), 0);

  assert.equal(chatPort._calls.length, 1);
  const req = chatPort._calls[0];
  assert.equal(req.options!.responseFormat!.type, 'json_schema');
});

test('judge uses json_object responseFormat when judgeModel.jsonMode is json_object', async () => {
  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: responseWithUsage,
    model: 'deepseek-v4-pro',
  });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new JudgeStep(chatPort, logger, clock);
  await step.analyze([panelResult()], sampleMessages, judgeModel({ jsonMode: 'json_object' }), 0);

  assert.equal(chatPort._calls.length, 1);
  const req = chatPort._calls[0];
  assert.ok(req.options?.responseFormat !== undefined, 'expected responseFormat');
  assert.equal(req.options!.responseFormat!.type, 'json_object');
});

test('logStageEnd receives correct duration and usage', async () => {
  const customUsage: TokenUsage = { promptTokens: 42, completionTokens: 58, totalTokens: 100 };
  const chatPort = stubChatPort({
    content: validAnalysisJson,
    usage: customUsage,
    model: 'gpt-4o-judge',
  });
  const logger = stubLoggerPort();
  // clock: first call at 500 (startTime), second at 700 → duration 200
  const clock = stubClockPort([500, 700]);

  const step = new JudgeStep(chatPort, logger, clock);
  await step.analyze([panelResult()], sampleMessages, judgeModel(), 0);

  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(endCalls.length, 1);
  assert.equal(endCalls[0].args[0], 'judge');
  assert.equal(endCalls[0].args[1], 200); // 700 - 500
  assert.deepStrictEqual(endCalls[0].args[2], customUsage);
});
