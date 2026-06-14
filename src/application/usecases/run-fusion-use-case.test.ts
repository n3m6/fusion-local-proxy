import test from 'node:test';
import assert from 'node:assert/strict';
import { RunFusionUseCase } from './run-fusion-use-case.js';
import type { FusionService } from '../ports/fusion-service.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { ChatRequest, ChatResponse, TokenUsage } from '../../domain/model/chat-types.js';
import type { ModelRef } from '../../domain/model/fusion-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectEvents(
  iterable: AsyncIterable<FusionStreamEvent>,
): Promise<FusionStreamEvent[]> {
  const events: FusionStreamEvent[] = [];
  for await (const ev of iterable) {
    events.push(ev);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface StubChatModelPort extends ChatModelPort {
  _lastRequest: ChatRequest | null;
}

function stubChatModelPort(response?: ChatResponse): StubChatModelPort {
  const stub: StubChatModelPort = {
    _lastRequest: null,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      stub._lastRequest = request;
      return (
        response ?? {
          content: 'Hello from stub',
          usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
          model: 'stub-model',
        }
      );
    },
  };
  return stub;
}

function stubConfigPort(synthesizerModel?: ModelRef): ConfigPort {
  return {
    getPanelModels: () => [],
    getJudgeModel: () => null,
    getSynthesizerModel: () =>
      synthesizerModel ?? {
        provider: 'openai',
        model: 'gpt-4o',
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
      },
    getTimeoutMs: () => 30000,
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
    logFailedModels(models): void {
      calls.push({ method: 'logFailedModels', args: [models] });
    },
    logError(stage: string, error: Error): void {
      calls.push({ method: 'logError', args: [stage, error] });
    },
  };
}

/**
 * Returns a ClockPort whose `now()` returns the given times in order.
 * If called more times than provided, repeats the last value.
 */
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
// Tests
// ---------------------------------------------------------------------------

test('FusionService interface shape', () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 100]);

  // RunFusionUseCase must satisfy the FusionService interface
  const service: FusionService = new RunFusionUseCase(chatModel, config, logger, clock);

  assert.ok(typeof service.runFusion === 'function');
  assert.equal(service.runFusion.length, 1); // single parameter: FusionRequest
});

test('RunFusionUseCase constructor accepts four port arguments', () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);
  assert.ok(useCase instanceof RunFusionUseCase);
});

test('passthrough happy path yields content_delta then done', async () => {
  const chatModel = stubChatModelPort({
    content: 'hi',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'test',
  });
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([100, 200]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'hello' }] }),
  );

  assert.equal(events.length, 2, 'expected exactly 2 events');
  assert.deepStrictEqual(events[0], { type: 'content_delta', delta: 'hi' });
  assert.deepStrictEqual(events[1], {
    type: 'done',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  });
});

test('system prompt is prepended to messages', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 50]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await collectEvents(
    useCase.runFusion({
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: 'Be helpful',
    }),
  );

  const req = chatModel._lastRequest;
  assert.ok(req);
  assert.equal(req!.messages.length, 2);
  assert.deepStrictEqual(req!.messages[0], { role: 'system', content: 'Be helpful' });
  assert.deepStrictEqual(req!.messages[1], { role: 'user', content: 'hello' });
});

test('temperature and maxTokens are forwarded to ChatRequest options', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 50]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await collectEvents(
    useCase.runFusion({
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.7,
      maxTokens: 200,
    }),
  );

  const req = chatModel._lastRequest;
  assert.ok(req);
  assert.equal(req!.options?.temperature, 0.7);
  assert.equal(req!.options?.maxTokens, 200);
});

test('ChatRequest omits options when neither temperature nor maxTokens is set', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 50]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }),
  );

  const req = chatModel._lastRequest;
  assert.ok(req);
  assert.equal(req!.options, undefined);
});

test('logger calls logStageStart before complete and logStageEnd after', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([500, 750]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'hello' }] }),
  );

  const startCalls = logger._calls.filter((c) => c.method === 'logStageStart');
  assert.equal(startCalls.length, 1);
  assert.deepStrictEqual(startCalls[0].args, ['synthesis']);

  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(endCalls.length, 1);
  assert.equal(endCalls[0].args[0], 'synthesis');
  assert.equal(endCalls[0].args[1], 250); // 750 - 500
  assert.deepStrictEqual(endCalls[0].args[2], {
    promptTokens: 2,
    completionTokens: 3,
    totalTokens: 5,
  });
});

test('error propagation: complete rejects, iterator rejects with same error, no events yielded', async () => {
  const upstreamError = new Error('upstream failure');
  const chatModel: ChatModelPort = {
    async complete(_request: ChatRequest): Promise<ChatResponse> {
      throw upstreamError;
    },
  };
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 50]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await assert.rejects(
    async () => {
      await collectEvents(
        useCase.runFusion({ messages: [{ role: 'user', content: 'hello' }] }),
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Error).message, 'upstream failure');
      return true;
    },
  );

  // Use case does not catch errors — no logError call
  const errorCalls = logger._calls.filter((c) => c.method === 'logError');
  assert.equal(errorCalls.length, 0);
});

test('synthesizer model ref is resolved from ConfigPort.getSynthesizerModel', async () => {
  const chatModel = stubChatModelPort();
  const expectedModel: ModelRef = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseURL: 'https://example.com/v1',
    apiKey: 'sk-key',
  };
  const config = stubConfigPort(expectedModel);
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }),
  );

  const req = chatModel._lastRequest;
  assert.ok(req);
  assert.deepStrictEqual(req!.model, expectedModel);
});

test('messages from request are shallow-copied (not mutated)', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 50]);

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  const originalMessages = [{ role: 'user' as const, content: 'hello' }];
  await collectEvents(
    useCase.runFusion({ messages: originalMessages }),
  );

  // Original messages array must not be modified
  assert.equal(originalMessages.length, 1);
  assert.deepStrictEqual(originalMessages[0], { role: 'user', content: 'hello' });
});
