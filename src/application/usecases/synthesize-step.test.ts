import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthesizeStep } from './synthesize-step.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  TokenUsage,
} from '../../domain/model/chat-types.js';
import type { ModelRef, PanelResult } from '../../domain/model/fusion-types.js';
import type { Analysis } from '../../domain/services/analysis-schema.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import { buildSynthesisSystemPrompt } from '../../domain/services/synthesis-prompt.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface StubChatModelPort extends ChatModelPort {
  _calls: ChatRequest[];
}

function stubChatPort(response?: ChatResponse): StubChatModelPort {
  const calls: ChatRequest[] = [];
  const resp = response ?? {
    content: 'stub synthesis response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'synth-model',
  };
  return {
    _calls: calls,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request);
      return resp;
    },
    stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
      calls.push(request);
      const chunks: ChatStreamChunk[] = [
        { type: 'content_delta', delta: resp.content },
        { type: 'content_stop' },
        { type: 'usage', usage: resp.usage },
      ];
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
  };
}

/**
 * A chat port stub that emits `reasoningCount` reasoning_progress chunks
 * (with configurable inter-chunk clock offsets) before the normal content.
 */
function stubChatPortWithReasoning(
  reasoningCount: number,
  response?: ChatResponse,
): StubChatModelPort {
  const calls: ChatRequest[] = [];
  const resp = response ?? {
    content: 'answer after reasoning',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'synth-model',
  };
  return {
    _calls: calls,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request);
      return resp;
    },
    stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
      calls.push(request);
      const chunks: ChatStreamChunk[] = [
        ...Array.from(
          { length: reasoningCount },
          (): ChatStreamChunk => ({
            type: 'reasoning_progress',
          }),
        ),
        { type: 'content_delta', delta: resp.content },
        { type: 'content_stop' },
        { type: 'usage', usage: resp.usage },
      ];
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

interface StubConfigPort extends ConfigPort {
  _calls: { getSynthesizerModel: number; getTimeoutMs: number };
}

function stubConfigPort(overrides?: {
  synthesizerModel?: ModelRef;
  timeoutMs?: number;
  /**
   * Controls getJudgeModel(). Pass null to simulate "no judge configured" (selfJudge mode).
   * Defaults to a non-null ModelRef so existing tests run in non-self-judge mode.
   */
  judgeModel?: ModelRef | null;
}): StubConfigPort {
  const calls = { getSynthesizerModel: 0, getTimeoutMs: 0 };
  const synthesizerModel =
    overrides?.synthesizerModel ?? modelRef({ model: 'gpt-4o', provider: 'openai' });
  const timeoutMs = overrides?.timeoutMs ?? 30000;
  const judgeModel =
    overrides !== undefined && Object.prototype.hasOwnProperty.call(overrides, 'judgeModel')
      ? (overrides.judgeModel ?? null)
      : modelRef({ model: 'judge-model', provider: 'openai' });
  return {
    _calls: calls,
    getPanelModels(): ModelRef[] {
      return [];
    },
    getJudgeModel(): ModelRef | null {
      return judgeModel;
    },
    getSynthesizerModel(): ModelRef {
      calls.getSynthesizerModel++;
      return synthesizerModel;
    },
    getTimeoutMs(): number {
      calls.getTimeoutMs++;
      return timeoutMs;
    },
    getAgentModel(): ModelRef | null {
      return null;
    },
    getAutocompleteModel(): ModelRef | null {
      return null;
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

const sampleOriginalMessages = [
  { role: 'user' as const, content: 'What is the capital of France?' },
];

function modelRef(overrides?: Partial<ModelRef>): ModelRef {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    ...overrides,
  };
}

function samplePanelResults(): PanelResult[] {
  return [
    {
      modelId: 'gpt-4o',
      provider: 'openai',
      content: 'The capital of France is Paris.',
      usage: { promptTokens: 5, completionTokens: 10 },
      latencyMs: 150,
    },
    {
      modelId: 'claude-3',
      provider: 'anthropic',
      content: 'Paris is the capital city of France.',
      usage: { promptTokens: 6, completionTokens: 12 },
      latencyMs: 200,
    },
  ];
}

function sampleAnalysis(): Analysis {
  return {
    agreements: ['Paris is the capital of France'],
    discrepancies: [],
    issues: [
      {
        severity: 'low',
        candidate: 'gpt-4o',
        description: 'Noted that Paris has been the capital since the 10th century',
      },
    ],
    gaps: ['No model mentioned the population of Paris'],
    recommendation: 'Both models are essentially correct. Prefer the more detailed response.',
  };
}

async function collectEvents(
  iterable: AsyncIterable<FusionStreamEvent>,
): Promise<FusionStreamEvent[]> {
  const events: FusionStreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('happy path with analysis: yields three events in correct order', async () => {
  const chat = stubChatPort({
    content: 'Based on the analysis, Paris is the capital of France.',
    usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    model: 'synth-model',
  });
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([100, 250]);

  const step = new SynthesizeStep(chat, config, logger, clock);
  const analysis = sampleAnalysis();

  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, analysis),
  );

  // Exactly three events
  assert.equal(events.length, 3);

  // Correct types in order
  assert.equal(events[0].type, 'content_delta');
  assert.equal(events[1].type, 'content_stop');
  assert.equal(events[2].type, 'done');

  // content_delta carries the stub response content
  const delta = events[0] as { type: 'content_delta'; delta: string };
  assert.equal(delta.delta, 'Based on the analysis, Paris is the capital of France.');

  // done carries usage and model
  const done = events[2] as { type: 'done'; usage?: TokenUsage; model?: string };
  assert.deepStrictEqual(done.usage, { promptTokens: 50, completionTokens: 30, totalTokens: 80 });
  assert.equal(done.model, config.getSynthesizerModel().model);

  // ChatPort received one call with correct structure
  assert.equal(chat._calls.length, 1);
  const req = chat._calls[0];
  assert.equal(req.messages.length, 2);
  assert.equal(req.messages[0].role, 'system');
  assert.equal(req.messages[1].role, 'user');
  assert.deepStrictEqual(req.model, config.getSynthesizerModel());
});

test('happy path with null analysis: yields three events in correct order', async () => {
  const chat = stubChatPort({
    content: 'Based on the panel responses, Paris is the capital.',
    usage: { promptTokens: 40, completionTokens: 25, totalTokens: 65 },
    model: 'synth-model',
  });
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([200, 400]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, null),
  );

  // Exactly three events
  assert.equal(events.length, 3);

  // Correct types in order
  assert.equal(events[0].type, 'content_delta');
  assert.equal(events[1].type, 'content_stop');
  assert.equal(events[2].type, 'done');

  // ChatPort still received a valid request
  assert.equal(chat._calls.length, 1);
  const req = chat._calls[0];
  assert.equal(req.messages.length, 2);
  assert.equal(req.messages[0].role, 'system');
  assert.equal(req.messages[1].role, 'user');

  // The system prompt should be the standard synthesis system prompt
  assert.equal(req.messages[0].content, buildSynthesisSystemPrompt());
});

test('correct event sequence: exactly three events, no extras', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 50]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  const events = await collectEvents(step.synthesize([], [], null));

  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'content_delta');
  assert.equal(events[1].type, 'content_stop');
  assert.equal(events[2].type, 'done');

  // No progress, error, or other event types
  for (const event of events) {
    assert.ok(
      event.type === 'content_delta' || event.type === 'content_stop' || event.type === 'done',
      `unexpected event type: ${event.type}`,
    );
  }
});

test('logger calls: logStageStart and logStageEnd called correctly', async () => {
  const response: ChatResponse = {
    content: 'response',
    usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
    model: 'synth',
  };
  const chat = stubChatPort(response);
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  // Clock returns 100 on first call, 350 on second call -> duration = 250
  const clock = stubClockPort([100, 350]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis()),
  );

  // logStageStart('synthesis') called exactly once
  const startCalls = logger._calls.filter((c) => c.method === 'logStageStart');
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].args[0], 'synthesis');

  // logStageEnd('synthesis', durationMs, usage) called exactly once
  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(endCalls.length, 1);
  assert.equal(endCalls[0].args[0], 'synthesis');
  assert.equal(endCalls[0].args[1], 250); // 350 - 100
  assert.deepStrictEqual(endCalls[0].args[2], response.usage);

  // logStageStart must come before logStageEnd in call order
  const startIdx = logger._calls.findIndex((c) => c.method === 'logStageStart');
  const endIdx = logger._calls.findIndex((c) => c.method === 'logStageEnd');
  assert.ok(startIdx < endIdx, 'logStageStart must be called before logStageEnd');
});

test('clock usage: clockPort.now() called exactly twice on success path (startTime + durationMs)', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  // startTime and final durationMs — ttftMs tracking was removed with logResponse.
  const clock = stubClockPort([100, 300]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis()),
  );

  assert.equal(clock._callCount, 2);
});

test('error propagation: iterator rejects with same error, logStageStart called, logStageEnd not called', async () => {
  const modelError = new Error('model unavailable');
  const chat = stubChatPortReject(modelError);
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([100]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  const iterator = step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis());

  // Iterating should reject with the same error
  await assert.rejects(
    async () => {
      for await (const _ of iterator) {
        // should not reach
      }
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Error).message, 'model unavailable');
      return true;
    },
  );

  // logStageStart was called (it happens before complete())
  const startCalls = logger._calls.filter((c) => c.method === 'logStageStart');
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].args[0], 'synthesis');

  // logStageEnd was NOT called (never reached after error)
  const endCalls = logger._calls.filter((c) => c.method === 'logStageEnd');
  assert.equal(endCalls.length, 0);

  // ChatPort was called exactly once
  assert.equal(chat._calls.length, 1);
});

test('timeout signal: ChatRequest.options.signal is an AbortSignal when timeoutMs is positive', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort({ timeoutMs: 5000 });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis()),
  );

  assert.equal(chat._calls.length, 1);
  const req = chat._calls[0];
  assert.ok(req.options !== undefined, 'expected options to be defined');
  assert.ok(req.options.signal instanceof AbortSignal, 'expected signal to be an AbortSignal');
});

test('prompt builder integration: user prompt includes analysis agreements when analysis is present', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis()),
  );

  assert.equal(chat._calls.length, 1);
  const userContent = chat._calls[0].messages[1].content;
  // The user prompt should contain the analysis agreements text
  assert.ok(
    userContent.includes('Paris is the capital of France'),
    'user prompt should include agreements point',
  );
  assert.ok(userContent.includes('PANEL ANALYSIS'), 'user prompt should include analysis section');
});

test('prompt builder integration: user prompt includes fallback note when analysis is null', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(step.synthesize(samplePanelResults(), sampleOriginalMessages, null));

  assert.equal(chat._calls.length, 1);
  const userContent = chat._calls[0].messages[1].content;
  // The user prompt should contain the fallback note about unavailable analysis
  assert.ok(
    userContent.includes('Panel-level analysis is unavailable'),
    'user prompt should include fallback note when analysis is null',
  );
  // Should NOT contain PANEL ANALYSIS section
  assert.ok(
    !userContent.includes('PANEL ANALYSIS'),
    'user prompt should not include analysis section when null',
  );
});

test('system prompt is always included in the ChatRequest', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  // Test with analysis present
  await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis()),
  );

  const expectedSystemPrompt = buildSynthesisSystemPrompt();
  assert.equal(chat._calls[0].messages[0].content, expectedSystemPrompt);
});

test('ChatRequest includes correct model reference', async () => {
  const customModel = modelRef({
    model: 'custom-synth',
    provider: 'anthropic',
    baseURL: 'http://custom',
    apiKey: 'k',
  });
  const chat = stubChatPort();
  const config = stubConfigPort({ synthesizerModel: customModel });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis()),
  );

  assert.equal(chat._calls.length, 1);
  assert.deepStrictEqual(chat._calls[0].model, customModel);
});

test('done event includes usage and model from synthesizerModel ref', async () => {
  const customUsage: TokenUsage = { promptTokens: 123, completionTokens: 456, totalTokens: 579 };
  const chat = stubChatPort({
    content: 'response',
    usage: customUsage,
    model: 'the-model-id',
  });
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis()),
  );

  const done = events[2] as { type: 'done'; usage?: TokenUsage; model?: string };
  assert.deepStrictEqual(done.usage, customUsage);
  assert.equal(done.model, config.getSynthesizerModel().model);
});

test('no signal timeout for zero or negative timeoutMs', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort({ timeoutMs: 0 });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, sampleAnalysis()),
  );

  // When timeoutMs=0 (or negative), no timer is set, so the synthesize
  // call completes successfully and yields all three events without abort.
  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'content_delta');
  assert.equal(events[1].type, 'content_stop');
  assert.equal(events[2].type, 'done');
});

test('synthesis_truncated: yields error event when timeoutSignal fires before stream finishes', async () => {
  // A streaming port that delays each chunk long enough for a short timeout to fire first.
  // Crucially, it does NOT throw when the signal is aborted — it just completes normally
  // after the delay. This simulates an adapter that finishes yielding without raising an error.
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const slowUsage: TokenUsage = { promptTokens: 5, completionTokens: 10, totalTokens: 15 };
  const slowChat: StubChatModelPort = {
    _calls: [],
    async complete(request: ChatRequest): Promise<ChatResponse> {
      slowChat._calls.push(request);
      return { content: 'slow', usage: slowUsage, model: 'm' };
    },
    stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
      slowChat._calls.push(request);
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          const chunks: ChatStreamChunk[] = [
            { type: 'content_delta', delta: 'partial' },
            { type: 'content_stop' },
            { type: 'usage', usage: slowUsage },
          ];
          return {
            async next() {
              await delay(100); // delay longer than timeoutMs below
              if (i < chunks.length) return { value: chunks[i++]!, done: false };
              return { value: undefined as never, done: true };
            },
          };
        },
      };
    },
  };

  // timeoutMs: 10 — the 10ms AbortSignal.timeout fires before the 100ms per-chunk delay
  const config = stubConfigPort({ timeoutMs: 10 });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0]);

  const step = new SynthesizeStep(slowChat, config, logger, clock);

  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, null),
  );

  // The stream completes after timeout fires (no throw from stub), so truncation is detected
  const errorEvent = events.find((e) => e.type === 'error') as
    | { type: 'error'; code: string; message: string }
    | undefined;
  assert.ok(errorEvent, 'expected synthesis_truncated error event');
  assert.equal(errorEvent!.code, 'synthesis_truncated');

  // No done event when truncated
  const doneEvent = events.find((e) => e.type === 'done');
  assert.equal(doneEvent, undefined, 'expected no done event when truncated');
});

// ---------------------------------------------------------------------------
// selfJudge mode (judgeModel === null in config)
// ---------------------------------------------------------------------------

test('selfJudge mode: system prompt equals buildSynthesisSystemPrompt({ selfJudge: true }) when judge not configured', async () => {
  const chat = stubChatPort();
  // null judgeModel => selfJudge = true
  const config = stubConfigPort({ judgeModel: null });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(step.synthesize(samplePanelResults(), sampleOriginalMessages, null));

  assert.equal(chat._calls.length, 1);
  const systemContent = chat._calls[0].messages[0].content;
  assert.equal(
    systemContent,
    buildSynthesisSystemPrompt({ selfJudge: true }),
    'system prompt must be the self-judging variant when no judge is configured',
  );
});

test('selfJudge mode: user prompt includes SELF-EVALUATION DIRECTIVE, not minimal fallback', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort({ judgeModel: null });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(step.synthesize(samplePanelResults(), sampleOriginalMessages, null));

  const userContent = chat._calls[0].messages[1].content;
  assert.ok(
    userContent.includes('SELF-EVALUATION DIRECTIVE'),
    'user prompt must include SELF-EVALUATION DIRECTIVE section',
  );
  assert.ok(
    !userContent.includes('Panel-level analysis is unavailable'),
    'user prompt must not include the minimal fallback note in selfJudge mode',
  );
});

test('selfJudge mode: standard 3-event sequence is preserved', async () => {
  const chat = stubChatPort();
  const config = stubConfigPort({ judgeModel: null });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, null),
  );

  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'content_delta');
  assert.equal(events[1].type, 'content_stop');
  assert.equal(events[2].type, 'done');
});

test('non-selfJudge mode (judge configured): null analysis still uses minimal fallback prompt', async () => {
  const chat = stubChatPort();
  // Default stub has a non-null judgeModel => selfJudge = false
  const config = stubConfigPort();
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);

  await collectEvents(step.synthesize(samplePanelResults(), sampleOriginalMessages, null));

  const userContent = chat._calls[0].messages[1].content;
  assert.ok(
    userContent.includes('Panel-level analysis is unavailable'),
    'when judge is configured but failed, user prompt must use the minimal fallback note',
  );
  assert.ok(
    !userContent.includes('SELF-EVALUATION DIRECTIVE'),
    'when judge is configured but failed, user prompt must not include SELF-EVALUATION DIRECTIVE',
  );
});

// ---------------------------------------------------------------------------
// reasoning_progress → synthesis progress event
// ---------------------------------------------------------------------------

test('reasoning_progress: first chunk emits a synthesis progress event immediately', async () => {
  const chat = stubChatPortWithReasoning(1);
  const config = stubConfigPort({ judgeModel: null });
  const logger = stubLoggerPort();
  // startTime=0, reasoning_progress check=0, durationMs=10
  const clock = stubClockPort([0, 0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);
  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, null),
  );

  const progressEvents = events.filter((e) => e.type === 'progress');
  assert.equal(progressEvents.length, 1);
  const prog = progressEvents[0] as { type: 'progress'; stage: string; message: string };
  assert.equal(prog.stage, 'synthesis');
  assert.equal(prog.message, 'evaluating candidates');
});

test('reasoning_progress: progress event appears before the first content_delta', async () => {
  const chat = stubChatPortWithReasoning(1);
  const config = stubConfigPort({ judgeModel: null });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);
  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, null),
  );

  const progIdx = events.findIndex((e) => e.type === 'progress');
  const cdIdx = events.findIndex((e) => e.type === 'content_delta');
  assert.ok(progIdx >= 0, 'expected a progress event');
  assert.ok(cdIdx >= 0, 'expected a content_delta event');
  assert.ok(progIdx < cdIdx, 'progress must precede content_delta');
});

test('reasoning_progress: reasoning chunks never leak into content_delta output', async () => {
  const chat = stubChatPortWithReasoning(3);
  const config = stubConfigPort({ judgeModel: null });
  const logger = stubLoggerPort();
  // startTime=0, three throttle checks (0, 0, 0), durationMs=10
  const clock = stubClockPort([0, 0, 0, 0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);
  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, null),
  );

  // content_delta events must only carry actual answer text, not reasoning content
  const contentDeltas = events.filter((e) => e.type === 'content_delta');
  assert.equal(contentDeltas.length, 1);
  assert.equal(
    (contentDeltas[0] as { type: 'content_delta'; delta: string }).delta,
    'answer after reasoning',
  );

  // progress events must have the synthesis stage, not be answer content
  const progressEvents = events.filter((e) => e.type === 'progress');
  for (const e of progressEvents) {
    assert.equal(e.type, 'progress');
    assert.equal((e as { type: 'progress'; stage: string }).stage, 'synthesis');
  }
});

test('reasoning_progress: throttled to at most one progress per 1000ms', async () => {
  // 3 reasoning_progress chunks; clock values for the throttle checks:
  //   first check:  t=0   (undefined prev → emit, lastMs=0)
  //   second check: t=500 (500 - 0 = 500 < 1000 → skip)
  //   third check:  t=1100 (1100 - 0 = 1100 >= 1000 → emit, lastMs=1100)
  const chat = stubChatPortWithReasoning(3);
  const config = stubConfigPort({ judgeModel: null });
  const logger = stubLoggerPort();
  // [startTime=0, check1=0, check2=500, check3=1100, durationMs=1200]
  const clock = stubClockPort([0, 0, 500, 1100, 1200]);

  const step = new SynthesizeStep(chat, config, logger, clock);
  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, null),
  );

  const progressEvents = events.filter((e) => e.type === 'progress');
  assert.equal(
    progressEvents.length,
    2,
    'only 2 of 3 reasoning_progress chunks should emit (one throttled)',
  );
});

test('reasoning_progress: no progress events when model emits no reasoning chunks', async () => {
  // Standard stub emits no reasoning_progress chunks
  const chat = stubChatPort();
  const config = stubConfigPort({ judgeModel: null });
  const logger = stubLoggerPort();
  const clock = stubClockPort([0, 10]);

  const step = new SynthesizeStep(chat, config, logger, clock);
  const events = await collectEvents(
    step.synthesize(samplePanelResults(), sampleOriginalMessages, null),
  );

  const progressEvents = events.filter((e) => e.type === 'progress');
  assert.equal(
    progressEvents.length,
    0,
    'no reasoning_progress chunks means no synthesis progress events',
  );
});
