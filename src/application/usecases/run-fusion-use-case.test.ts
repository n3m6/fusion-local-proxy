import test from 'node:test';
import assert from 'node:assert/strict';
import { RunFusionUseCase } from './run-fusion-use-case.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { ChatRequest, ChatResponse, TokenUsage } from '../../domain/model/chat-types.js';

// ---------------------------------------------------------------------------
// Helpers to collect async iterable results
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
// Stub / fake implementations
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

function stubChatModelPortThatThrows(error: Error): ChatModelPort {
  return {
    async complete(_request: ChatRequest): Promise<ChatResponse> {
      throw error;
    },
  };
}

function stubConfigPort(panelModels?: Array<{ provider: 'openai'; model: string; baseURL: string; apiKey: string }>): ConfigPort {
  const models = panelModels ?? [
    { provider: 'openai' as const, model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
  ];
  return {
    getPanelModels: () => models,
    getJudgeModel: () => null,
    getSynthesizerModel: () => null,
    getTimeoutMs: () => 30000,
  };
}

function stubLoggerPort(): LoggerPort & { _calls: Array<{ method: string; args: unknown[] }> } {
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

function stubClockPort(): ClockPort {
  let current = 0;
  return {
    now: () => current++,
    // allow setting for testing
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('RunFusionUseCase yields content_delta, content_stop, and done events', async () => {
  const chatModel = stubChatModelPort({
    content: 'Hello world',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: 'gpt-4o',
  });
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort();

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  const request: FusionRequest = {
    messages: [{ role: 'user', content: 'Hi' }],
  };

  const events = await collectEvents(useCase.runFusion(request));

  assert.ok(events.length >= 3, 'expected at least 3 events');

  const contentDelta = events.find((e) => e.type === 'content_delta');
  assert.ok(contentDelta);
  assert.equal((contentDelta as { type: 'content_delta'; delta: string }).delta, 'Hello world');

  const contentStop = events.find((e) => e.type === 'content_stop');
  assert.ok(contentStop);

  const done = events.find((e) => e.type === 'done');
  assert.ok(done);
  const doneEv = done as { type: 'done'; usage: TokenUsage; failedModels: unknown[]; model?: string };
  assert.equal(doneEv.usage.promptTokens, 10);
  assert.equal(doneEv.usage.completionTokens, 5);
  assert.equal(doneEv.usage.totalTokens, 15);
  assert.equal(doneEv.model, 'gpt-4o');
  assert.deepEqual(doneEv.failedModels, []);
});

test('RunFusionUseCase passes ChatRequest with messages and model ref', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort([
    { provider: 'openai', model: 'gpt-4o-mini', baseURL: 'https://example.com/v1', apiKey: 'sk-key' },
  ]);
  const logger = stubLoggerPort();
  const clock = stubClockPort();

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  const request: FusionRequest = {
    messages: [{ role: 'system', content: 'Be helpful' }, { role: 'user', content: 'Hello' }],
    options: { temperature: 0.5, maxTokens: 100 },
  };

  await collectEvents(useCase.runFusion(request));

  const lastRequest = (chatModel as StubChatModelPort)._lastRequest;
  assert.ok(lastRequest);
  assert.equal(lastRequest!.messages.length, 2);
  assert.equal(lastRequest!.messages[0].role, 'system');
  assert.equal(lastRequest!.messages[0].content, 'Be helpful');
  assert.equal(lastRequest!.model.model, 'gpt-4o-mini');
  assert.equal(lastRequest!.model.provider, 'openai');
  assert.equal(lastRequest!.options?.temperature, 0.5);
  assert.equal(lastRequest!.options?.maxTokens, 100);
});

test('RunFusionUseCase logs stage start and end', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort();

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));

  const startCalls = logger._calls.filter((c) => c.method === 'logStageStart');
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].args[0], 'passthrough');

  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(endCalls.length, 1);
  assert.equal(endCalls[0].args[0], 'passthrough');
  assert.equal(typeof endCalls[0].args[1], 'number');
});

test('RunFusionUseCase throws on empty panel models', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort([]); // empty panel
  const logger = stubLoggerPort();
  const clock = stubClockPort();

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await assert.rejects(
    async () => {
      await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok((err as Error).message.includes('panel'));
      return true;
    },
  );
});

test('RunFusionUseCase propagates chat adapter errors', async () => {
  const chatModel = stubChatModelPortThatThrows(new Error('API key invalid'));
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort();

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await assert.rejects(
    async () => {
      await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Error).message, 'API key invalid');
      return true;
    },
  );

  // verify error was logged
  const errorCalls = logger._calls.filter((c) => c.method === 'logError');
  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0].args[0], 'passthrough');
});

test('RunFusionUseCase handles non-Error throws from adapter', async () => {
  const chatModel: ChatModelPort = {
    async complete(_request: ChatRequest): Promise<ChatResponse> {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'string error';
    },
  };
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort();

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await assert.rejects(
    async () => {
      await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));
    },
    (err: unknown) => {
      assert.equal(err, 'string error');
      return true;
    },
  );
});

test('RunFusionUseCase uses first panel model from config', async () => {
  const chatModel = stubChatModelPort();
  const config = stubConfigPort([
    { provider: 'openai', model: 'first-model', baseURL: 'http://a', apiKey: 'k1' },
    { provider: 'openai', model: 'second-model', baseURL: 'http://b', apiKey: 'k2' },
  ]);
  const logger = stubLoggerPort();
  const clock = stubClockPort();

  const useCase = new RunFusionUseCase(chatModel, config, logger, clock);

  await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));

  assert.equal((chatModel as StubChatModelPort)._lastRequest?.model.model, 'first-model');
});
