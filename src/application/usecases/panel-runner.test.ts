import test from 'node:test';
import assert from 'node:assert/strict';
import { PanelRunner } from './panel-runner.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  TokenUsage,
} from '../../domain/model/chat-types.js';
import type { ModelRef } from '../../domain/model/fusion-types.js';
import type { FailedModelInfo } from '../../domain/model/stream-types.js';
import { FusionError } from '../../domain/model/fusion-types.js';

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
    async complete(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request);
      throw error;
    },
    stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
      calls.push(request);
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
    logFailedModels(models: FailedModelInfo[]): void {
      calls.push({ method: 'logFailedModels', args: [models] });
    },
    logError(stage: string, error: Error): void {
      calls.push({ method: 'logError', args: [stage, error] });
    },
    logRequest(fields): void {
      calls.push({ method: 'logRequest', args: [fields] });
    },
    logResponse(fields): void {
      calls.push({ method: 'logResponse', args: [fields] });
    },
    log(level, event, fields): void {
      calls.push({ method: 'log', args: [level, event, fields] });
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

const sampleMessage = { role: 'user' as const, content: 'hello' };

function modelRef(overrides?: Partial<ModelRef>): ModelRef {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('all-success: 3 panel models, all resolve', async () => {
  const port0 = stubChatPort({
    content: 'response-0',
    usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
    model: 'gpt-4o',
  });
  const port1 = stubChatPort({
    content: 'response-1',
    usage: { promptTokens: 8, completionTokens: 12, totalTokens: 20 },
    model: 'claude-3',
  });
  const port2 = stubChatPort({
    content: 'response-2',
    usage: { promptTokens: 3, completionTokens: 7, totalTokens: 10 },
    model: 'gpt-4o-mini',
  });

  const logger = stubLoggerPort();
  // 8 clock calls: stageStart, start0..2, end0..2, stageEnd
  const clock = stubClockPort([50, 100, 200, 300, 350, 480, 600, 700]);

  const runner = new PanelRunner([port0, port1, port2], logger, clock);

  const panelModels: ModelRef[] = [
    modelRef({ model: 'gpt-4o', provider: 'openai' }),
    modelRef({ model: 'claude-3', provider: 'anthropic' }),
    modelRef({ model: 'gpt-4o-mini', provider: 'openai' }),
  ];

  const result = await runner.run([sampleMessage], panelModels, 30000);

  assert.equal(result.results.length, 3);
  assert.equal(result.failedModels.length, 0);

  // First result
  assert.equal(result.results[0].modelId, 'gpt-4o');
  assert.equal(result.results[0].provider, 'openai');
  assert.equal(result.results[0].content, 'response-0');
  assert.deepStrictEqual(result.results[0].usage, { promptTokens: 5, completionTokens: 10 });
  assert.ok(result.results[0].latencyMs > 0);

  // Second result
  assert.equal(result.results[1].modelId, 'claude-3');
  assert.equal(result.results[1].provider, 'anthropic');
  assert.equal(result.results[1].content, 'response-1');
  assert.deepStrictEqual(result.results[1].usage, { promptTokens: 8, completionTokens: 12 });
  assert.ok(result.results[1].latencyMs > 0);

  // Third result
  assert.equal(result.results[2].modelId, 'gpt-4o-mini');
  assert.equal(result.results[2].provider, 'openai');
  assert.equal(result.results[2].content, 'response-2');
  assert.deepStrictEqual(result.results[2].usage, { promptTokens: 3, completionTokens: 7 });
  assert.ok(result.results[2].latencyMs > 0);

  // Stage lifecycle is symmetric: exactly one start paired with one end,
  // regardless of how many panel models succeed.
  const startCalls = logger._calls.filter((c) => c.method === 'logStageStart');
  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(startCalls.length, 1);
  assert.equal(endCalls.length, 1);
  assert.equal(endCalls[0].args[0], 'panel');
  assert.ok(typeof endCalls[0].args[1] === 'number' && (endCalls[0].args[1] as number) > 0);
  assert.ok(endCalls[0].args[2] !== undefined);
});

test('partial-failure: 2 resolve, 1 rejects with FusionError', async () => {
  const port0 = stubChatPort({
    content: 'ok-0',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'm0',
  });
  const port1 = stubChatPortReject(new FusionError('timeout', 'timed out'));
  const port2 = stubChatPort({
    content: 'ok-2',
    usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
    model: 'm2',
  });

  const logger = stubLoggerPort();
  const clock = stubClockPort([10, 20, 30, 40, 50, 60]);

  const runner = new PanelRunner([port0, port1, port2], logger, clock);

  const panelModels: ModelRef[] = [
    modelRef({ model: 'm0' }),
    modelRef({ model: 'm1' }),
    modelRef({ model: 'm2', provider: 'anthropic' }),
  ];

  const result = await runner.run([sampleMessage], panelModels, 30000);

  assert.equal(result.results.length, 2);
  assert.equal(result.failedModels.length, 1);

  // Verify failedModel entry
  assert.equal(result.failedModels[0].modelId, 'm1');
  assert.equal(result.failedModels[0].errorCode, 'timeout');
  assert.equal(result.failedModels[0].errorMessage, 'timed out');

  // logFailedModels called once with the single-entry array
  const failCalls = logger._calls.filter((c) => c.method === 'logFailedModels');
  assert.equal(failCalls.length, 1);
  const loggedModels = failCalls[0].args[0] as FailedModelInfo[];
  assert.equal(loggedModels.length, 1);
  assert.equal(loggedModels[0].modelId, 'm1');
});

test('all-failure: 2 panel models, both reject, throws all_panels_failed', async () => {
  const port0 = stubChatPortReject(new Error('fail-0'));
  const port1 = stubChatPortReject(new Error('fail-1'));

  const logger = stubLoggerPort();
  // 4 clock calls: stageStart, start0, start1, stageEnd (no per-model latency reads — both reject)
  const clock = stubClockPort([0, 10, 20, 30]);

  const runner = new PanelRunner([port0, port1], logger, clock);

  const panelModels: ModelRef[] = [
    modelRef({ model: 'm0' }),
    modelRef({ model: 'm1', provider: 'anthropic' }),
  ];

  await assert.rejects(
    () => runner.run([sampleMessage], panelModels, 30000),
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      const fe = err as FusionError;
      assert.equal(fe.code, 'all_panels_failed');
      assert.ok(fe.details);
      const failedModels = fe.details!.failedModels as FailedModelInfo[];
      assert.equal(failedModels.length, 2);
      return true;
    },
  );

  // logFailedModels called
  const failCalls = logger._calls.filter((c) => c.method === 'logFailedModels');
  assert.equal(failCalls.length, 1);

  // Stage lifecycle stays symmetric even when every panel model fails: the
  // single logStageStart must be paired with exactly one logStageEnd before throw.
  const startCalls = logger._calls.filter((c) => c.method === 'logStageStart');
  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(startCalls.length, 1);
  assert.equal(endCalls.length, 1);
  assert.equal(endCalls[0].args[0], 'panel');
  assert.equal(endCalls[0].args[1], 30); // stageEnd - stageStart = 30 - 0
});

test('empty panel models: returns empty results, no port calls', async () => {
  const port = stubChatPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0]);

  const runner = new PanelRunner([port], logger, clock);

  const result = await runner.run([sampleMessage], [], 30000);

  assert.deepStrictEqual(result, { results: [], failedModels: [] });
  assert.equal(port._calls.length, 0);

  // No log calls either
  assert.equal(logger._calls.length, 0);
});

test('AbortSignal passthrough: signal is set on ChatRequest', async () => {
  const port = stubChatPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const runner = new PanelRunner([port], logger, clock);

  await runner.run([sampleMessage], [modelRef({ model: 'm0' })], 5000);

  assert.ok(port._calls.length >= 1);
  const req = port._calls[0];
  assert.ok(req.options !== undefined, 'expected options to be defined');
  assert.ok(req.options.signal instanceof AbortSignal);
});

test('latency measurement: PanelResult.latencyMs equals clock difference', async () => {
  const port = stubChatPort({
    content: 'latency-test',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'm0',
  });
  const logger = stubLoggerPort();
  // 4 clock calls: stageStart, start0, end0, stageEnd
  const clock = stubClockPort([50, 100, 250, 300]);

  const runner = new PanelRunner([port], logger, clock);

  const result = await runner.run([sampleMessage], [modelRef({ model: 'm0' })], 30000);

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].latencyMs, 150); // 250 - 100
});

test('FailedModelInfo from FusionError: errorCode and errorMessage copied', async () => {
  const port = stubChatPortReject(new FusionError('timeout', 'timed out'));
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const runner = new PanelRunner([port], logger, clock);

  await assert.rejects(
    () => runner.run([sampleMessage], [modelRef({ model: 'm0' })], 30000),
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      const fe = err as FusionError;
      assert.equal(fe.code, 'all_panels_failed');
      const failedModels = fe.details!.failedModels as FailedModelInfo[];
      assert.equal(failedModels.length, 1);
      assert.equal(failedModels[0].errorCode, 'timeout');
      assert.equal(failedModels[0].errorMessage, 'timed out');
      return true;
    },
  );
});

test('FailedModelInfo from generic Error: errorCode is Error, message truncated', async () => {
  // 300-character message (should be truncated to 200)
  const longMessage = 'abc'.repeat(100);
  assert.ok(longMessage.length === 300);

  const port = stubChatPortReject(new Error(longMessage));
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const runner = new PanelRunner([port], logger, clock);

  await assert.rejects(
    () => runner.run([sampleMessage], [modelRef({ model: 'm0' })], 30000),
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      const fe = err as FusionError;
      const failedModels = fe.details!.failedModels as FailedModelInfo[];
      assert.equal(failedModels.length, 1);
      assert.equal(failedModels[0].errorCode, 'Error');
      assert.ok(failedModels[0].errorMessage.length <= 200);
      assert.equal(failedModels[0].errorMessage, longMessage.slice(0, 200));
      return true;
    },
  );
});

test('loggerPort.logStageEnd called once for the whole stage with aggregate usage', async () => {
  const port0 = stubChatPort({
    content: 'a',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'm0',
  });
  const port1 = stubChatPort({
    content: 'b',
    usage: { promptTokens: 5, completionTokens: 15, totalTokens: 20 },
    model: 'm1',
  });

  const logger = stubLoggerPort();
  // 6 clock calls: stageStart, start0, start1, end0, end1, stageEnd
  const clock = stubClockPort([50, 100, 200, 350, 500, 700]);

  const runner = new PanelRunner([port0, port1], logger, clock);

  await runner.run(
    [sampleMessage],
    [modelRef({ model: 'm0' }), modelRef({ model: 'm1', provider: 'anthropic' })],
    30000,
  );

  // The stage end pairs 1:1 with the stage start and wraps the entire panel run.
  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(endCalls.length, 1);
  assert.equal(endCalls[0].args[0], 'panel');
  assert.equal(endCalls[0].args[1], 650); // stageEnd - stageStart = 700 - 50

  // Usage is aggregated across all successful panel models.
  assert.deepStrictEqual(endCalls[0].args[2], {
    promptTokens: 15, // 10 + 5
    completionTokens: 35, // 20 + 15
    totalTokens: 50, // 30 + 20
  });

  // Per-model detail is still emitted, one logResponse per successful model.
  const responseCalls = logger._calls.filter((c) => c.method === 'logResponse');
  assert.equal(responseCalls.length, 2);
});

test('FailedModelInfo from generic Error uses constructor.name as errorCode', async () => {
  class CustomError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'CustomError';
    }
  }

  const port = stubChatPortReject(new CustomError('custom failure'));
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const runner = new PanelRunner([port], logger, clock);

  await assert.rejects(
    () => runner.run([sampleMessage], [modelRef({ model: 'm0' })], 30000),
    (err: unknown) => {
      assert.ok(err instanceof FusionError);
      const fe = err as FusionError;
      const failedModels = fe.details!.failedModels as FailedModelInfo[];
      assert.equal(failedModels.length, 1);
      assert.equal(failedModels[0].errorCode, 'CustomError');
      assert.equal(failedModels[0].errorMessage, 'custom failure');
      return true;
    },
  );
});

test('partial-failure does not throw (non-zero successes)', async () => {
  const port0 = stubChatPort({
    content: 'survivor',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'm0',
  });
  const port1 = stubChatPortReject(new Error('dead'));

  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10, 20, 30]);

  const runner = new PanelRunner([port0, port1], logger, clock);

  // Should not throw
  const result = await runner.run(
    [sampleMessage],
    [modelRef({ model: 'm0' }), modelRef({ model: 'm1', provider: 'anthropic' })],
    30000,
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.failedModels.length, 1);
  assert.equal(result.results[0].modelId, 'm0');
});

test('chatRequest includes model ref and messages for each panel model', async () => {
  const port0 = stubChatPort({
    content: 'r0',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'x',
  });
  const port1 = stubChatPort({
    content: 'r1',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'y',
  });

  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10, 20, 30]);

  const runner = new PanelRunner([port0, port1], logger, clock);

  const messages = [
    { role: 'system' as const, content: 'be helpful' },
    { role: 'user' as const, content: 'query' },
  ];

  const m0 = modelRef({ model: 'm0', provider: 'openai', baseURL: 'http://a', apiKey: 'k0' });
  const m1 = modelRef({ model: 'm1', provider: 'anthropic', baseURL: 'http://b', apiKey: 'k1' });

  await runner.run(messages, [m0, m1], 30000);

  assert.equal(port0._calls.length, 1);
  assert.equal(port1._calls.length, 1);

  // port0 received messages and model
  assert.deepStrictEqual(port0._calls[0].messages, messages);
  assert.deepStrictEqual(port0._calls[0].model, m0);

  // port1 received messages and model
  assert.deepStrictEqual(port1._calls[0].messages, messages);
  assert.deepStrictEqual(port1._calls[0].model, m1);
});
