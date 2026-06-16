import test from 'node:test';
import assert from 'node:assert/strict';
import { RunFusionUseCase } from './run-fusion-use-case.js';
import type { FusionService } from '../ports/fusion-service.js';
import type { FusionError, PanelMeta, PanelResult } from '../../domain/model/fusion-types.js';
import type { TokenUsage } from '../../domain/model/chat-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { ModelRef } from '../../domain/model/fusion-types.js';
import type { Message } from '../../domain/model/message.js';
import type { Analysis } from '../../domain/services/analysis-schema.js';
import { PanelRunner } from './panel-runner.js';
import { JudgeStep } from './judge-step.js';
import { SynthesizeStep } from './synthesize-step.js';

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
// Shared test values
// ---------------------------------------------------------------------------

const defaultModelRef: ModelRef = {
  provider: 'openai',
  model: 'gpt-4o',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
};

const samplePanelResult: PanelResult = {
  modelId: 'gpt-4o',
  provider: 'openai',
  content: 'panel response',
  usage: { promptTokens: 5, completionTokens: 3 },
  latencyMs: 150,
};

const sampleAnalysis: Analysis = {
  agreements: ['agree on X'],
  discrepancies: [{ topic: 'Y', positions: ['A', 'B'], assessment: 'unclear' }],
  issues: [{ severity: 'low', candidate: 'gpt-4o', description: 'insight Z' }],
  gaps: ['missed W'],
  recommendation: 'Follow approach A.',
};

const sampleFailedModel = {
  modelId: 'bad-model',
  errorCode: 'TIMEOUT',
  errorMessage: 'Request timed out',
};

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

interface StubPanelRunner {
  _lastMessages: Message[] | null;
  _lastTimeoutMs: number;
  _lastSampling: { temperature?: number; maxTokens?: number } | undefined;
  _callCount: number;
  run(
    messages: Message[],
    timeoutMs: number,
    requestId?: string,
    sampling?: { temperature?: number; maxTokens?: number },
  ): Promise<PanelMeta>;
}

function stubPanelRunner(result?: PanelMeta): StubPanelRunner {
  const defaultResult: PanelMeta = {
    results: [samplePanelResult],
    failedModels: [],
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
  };
  const stub: StubPanelRunner = {
    _lastMessages: null,
    _lastTimeoutMs: -1,
    _lastSampling: undefined,
    _callCount: 0,
    async run(messages, timeoutMs, _requestId, sampling) {
      stub._callCount++;
      stub._lastMessages = messages;
      stub._lastTimeoutMs = timeoutMs;
      stub._lastSampling = sampling;
      return result ?? defaultResult;
    },
  };
  return stub;
}

function stubPanelRunnerThrowing(error: FusionError): StubPanelRunner {
  const stub: StubPanelRunner = {
    _lastMessages: null,
    _lastTimeoutMs: -1,
    _lastSampling: undefined,
    _callCount: 0,
    async run(messages, timeoutMs, _requestId, sampling) {
      stub._callCount++;
      stub._lastMessages = messages;
      stub._lastTimeoutMs = timeoutMs;
      stub._lastSampling = sampling;
      throw error;
    },
  };
  return stub;
}

interface StubJudgeStep {
  _analyzeCalls: Array<{
    panelResults: PanelResult[];
    originalMessages: Message[];
    timeoutMs: number;
  }>;
  analyze(
    panelResults: PanelResult[],
    originalMessages: Message[],
    timeoutMs: number,
  ): Promise<{ analysis: Analysis | null; usage?: TokenUsage }>;
}

function stubJudgeStep(result?: Analysis | null, usage?: TokenUsage): StubJudgeStep {
  const stub: StubJudgeStep = {
    _analyzeCalls: [],
    async analyze(panelResults, originalMessages, timeoutMs) {
      stub._analyzeCalls.push({ panelResults, originalMessages, timeoutMs });
      return { analysis: result !== undefined ? result : sampleAnalysis, usage };
    },
  };
  return stub;
}

interface StubSynthesizeStep {
  _synthesizeCalls: Array<{
    panelResults: PanelResult[];
    originalMessages: Message[];
    analysis: Analysis | null;
    sampling: { temperature?: number; maxTokens?: number } | undefined;
  }>;
  synthesize(
    panelResults: PanelResult[],
    originalMessages: Message[],
    analysis: Analysis | null,
    requestId?: string,
    sampling?: { temperature?: number; maxTokens?: number },
  ): AsyncIterable<FusionStreamEvent>;
}

function stubSynthesizeStep(events?: FusionStreamEvent[]): StubSynthesizeStep {
  const defaultEvents: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'synthesized response' },
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: 'gpt-4o',
    },
  ];
  const stub: StubSynthesizeStep = {
    _synthesizeCalls: [],
    async *synthesize(panelResults, originalMessages, analysis, _requestId, sampling) {
      stub._synthesizeCalls.push({ panelResults, originalMessages, analysis, sampling });
      for (const ev of events ?? defaultEvents) {
        yield ev;
      }
    },
  };
  return stub;
}

interface StubConfigPort extends ConfigPort {
  _panelModels: ModelRef[];
  _judgeModel: ModelRef | null;
  _synthesizerModel: ModelRef;
  _timeoutMs: number;
}

function stubConfigPort(opts?: {
  panelModels?: ModelRef[];
  judgeModel?: ModelRef | null;
  synthesizerModel?: ModelRef;
  timeoutMs?: number;
}): StubConfigPort {
  return {
    _panelModels: opts?.panelModels ?? [defaultModelRef],
    _judgeModel: opts?.judgeModel !== undefined ? opts.judgeModel : defaultModelRef,
    _synthesizerModel: opts?.synthesizerModel ?? defaultModelRef,
    _timeoutMs: opts?.timeoutMs ?? 30000,
    getPanelModels() {
      return this._panelModels;
    },
    getJudgeModel() {
      return this._judgeModel;
    },
    getSynthesizerModel() {
      return this._synthesizerModel;
    },
    getTimeoutMs() {
      return this._timeoutMs;
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
    logStageEnd(
      stage: string,
      durationMs: number,
      usage?: import('../../domain/model/chat-types.js').TokenUsage,
    ): void {
      calls.push({ method: 'logStageEnd', args: [stage, durationMs, usage] });
    },
    logFailedModels(models): void {
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

// 1. Constructor accepts new dependencies
test('constructor accepts new dependencies and satisfies FusionService interface', () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const service: FusionService = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  assert.ok(service instanceof RunFusionUseCase);
  assert.ok(typeof service.runFusion === 'function');
});

// 2. Full ensemble happy path yields correct event sequence
test('full ensemble happy path yields correct event sequence', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep(sampleAnalysis) as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'hello' }] }),
  );

  // Expected sequence: progress(panel), progress(judge), content_delta, content_stop, done
  assert.ok(events.length >= 5, `expected at least 5 events, got ${events.length}`);

  // Panel progress
  assert.deepStrictEqual(events[0], {
    type: 'progress',
    stage: 'panel',
    message: 'Panel stage complete',
  });
  // Judge progress
  assert.deepStrictEqual(events[1], {
    type: 'progress',
    stage: 'judge',
    message: 'Judge stage complete',
  });
  // Content delta from synthesis
  assert.deepStrictEqual(events[2], { type: 'content_delta', delta: 'synthesized response' });
  // Content stop from synthesis
  assert.deepStrictEqual(events[3], { type: 'content_stop' });
  // Final done event
  assert.equal(events[4].type, 'done');
  const doneEvent = events[4] as {
    type: 'done';
    failedModels?: unknown;
    usage?: unknown;
    model?: unknown;
  };
  assert.deepStrictEqual(doneEvent.failedModels, []);
  assert.ok(doneEvent.usage !== undefined);
  assert.ok(doneEvent.model !== undefined);

  // Per-stage logging is step-owned; the use case emits run-level start/end markers.
  const logCalls = (loggerPort as unknown as StubLoggerPort)._calls;
  const loggedEvents = logCalls.filter((c) => c.method === 'log').map((c) => c.args[1] as string);
  assert.ok(loggedEvents.includes('fusion_run_start'), 'expected a fusion_run_start log');
  assert.ok(loggedEvents.includes('fusion_run_end'), 'expected a fusion_run_end log');
});

// 3. Panel progress event is yielded before judge progress event
test('panel progress event is yielded before judge progress event', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'hello' }] }),
  );

  const progressEvents = events.filter((e) => e.type === 'progress');
  assert.equal(progressEvents.length, 2);
  assert.deepStrictEqual(progressEvents[0], {
    type: 'progress',
    stage: 'panel',
    message: 'Panel stage complete',
  });
  assert.deepStrictEqual(progressEvents[1], {
    type: 'progress',
    stage: 'judge',
    message: 'Judge stage complete',
  });
});

// 4. SynthesizeStep receives correct panel results
test('SynthesizeStep receives correct panel results', async () => {
  const customPanelResult: PanelResult = {
    modelId: 'custom-model',
    provider: 'anthropic',
    content: 'custom content',
    usage: { promptTokens: 1, completionTokens: 2 },
    latencyMs: 99,
  };
  const panelMeta: PanelMeta = {
    results: [customPanelResult],
    failedModels: [],
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  };
  const panelRunner = stubPanelRunner(panelMeta) as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));

  const calls = (synthesizeStep as unknown as StubSynthesizeStep)._synthesizeCalls;
  assert.equal(calls.length, 1);
  assert.deepStrictEqual(calls[0].panelResults, [customPanelResult]);
});

// 5. SynthesizeStep receives correct messages (system prompt prepended)
test('SynthesizeStep receives messages with system prompt prepended', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  await collectEvents(
    useCase.runFusion({
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: 'Be helpful',
    }),
  );

  const calls = (synthesizeStep as unknown as StubSynthesizeStep)._synthesizeCalls;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].originalMessages.length, 2);
  assert.deepStrictEqual(calls[0].originalMessages[0], { role: 'system', content: 'Be helpful' });
  assert.deepStrictEqual(calls[0].originalMessages[1], { role: 'user', content: 'hello' });
});

// 6. SynthesizeStep receives analysis from JudgeStep
test('SynthesizeStep receives analysis from JudgeStep', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep(sampleAnalysis) as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));

  const calls = (synthesizeStep as unknown as StubSynthesizeStep)._synthesizeCalls;
  assert.equal(calls.length, 1);
  assert.deepStrictEqual(calls[0].analysis, sampleAnalysis);
});

// 7. Judge null path (judgeStep = null) skips judge and passes null analysis
test('judge null path skips JudgeStep and passes null analysis', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort({ judgeModel: null }) as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    null,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }),
  );

  // Judge progress still yielded
  // Judge progress still yielded even when skipped
  const judgeProgress = events.find((e) => e.type === 'progress' && e.stage === 'judge');
  assert.ok(judgeProgress, 'expected judge progress event even when skipped');

  // SynthesizeStep called with analysis: null
  const synthCalls = (synthesizeStep as unknown as StubSynthesizeStep)._synthesizeCalls;
  assert.equal(synthCalls.length, 1);
  assert.equal(synthCalls[0].analysis, null);
});

// 8. JudgeStep returning null degrades gracefully
test('JudgeStep returning null degrades gracefully', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep(null) as unknown as JudgeStep; // returns null
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort; // judgeModel is non-null
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }),
  );

  // JudgeStep.analyze() was called (since judgeModel !== null)
  assert.equal((judgeStep as unknown as StubJudgeStep)._analyzeCalls.length, 1);

  // SynthesizeStep receives null analysis
  const synthCalls = (synthesizeStep as unknown as StubSynthesizeStep)._synthesizeCalls;
  assert.equal(synthCalls.length, 1);
  assert.equal(synthCalls[0].analysis, null);

  // Pipeline produced content events normally
  const contentEvents = events.filter(
    (e) => e.type === 'content_delta' || e.type === 'content_stop',
  );
  assert.ok(contentEvents.length > 0, 'expected content events');
});

// 9. Partial panel failure reported in done event
test('partial panel failure reported in done event', async () => {
  const panelMeta: PanelMeta = {
    results: [samplePanelResult],
    failedModels: [sampleFailedModel],
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
  };
  const panelRunner = stubPanelRunner(panelMeta) as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }),
  );

  const doneEvent = events.find((e) => e.type === 'done') as {
    type: 'done';
    failedModels?: unknown;
  };
  assert.ok(doneEvent, 'expected done event');
  assert.deepStrictEqual(doneEvent.failedModels, [sampleFailedModel]);
});

// 10. All-panels-failed error propagates
test('all-panels-failed error propagates and yields no further events', async () => {
  const { FusionError } = await import('../../domain/model/fusion-types.js');
  const error = new FusionError('all_panels_failed', 'All panel models failed');
  const panelRunner = stubPanelRunnerThrowing(error) as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  await assert.rejects(
    async () => {
      await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'hello' }] }));
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as FusionError).code, 'all_panels_failed');
      assert.equal((err as FusionError).message, 'All panel models failed');
      return true;
    },
  );

  // Judge should not have been called
  assert.equal((judgeStep as unknown as StubJudgeStep)._analyzeCalls.length, 0);
  // Synthesis should not have been called
  assert.equal((synthesizeStep as unknown as StubSynthesizeStep)._synthesizeCalls.length, 0);
});

// 11. Timeout value is passed through to PanelRunner and JudgeStep
test('timeout value is passed through to PanelRunner and JudgeStep', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort({ timeoutMs: 15000 }) as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));

  // PanelRunner received timeoutMs
  assert.equal((panelRunner as unknown as StubPanelRunner)._lastTimeoutMs, 15000);
  // JudgeStep received timeoutMs
  assert.equal((judgeStep as unknown as StubJudgeStep)._analyzeCalls[0]?.timeoutMs, 15000);
});

// 12. Empty panel models: synthesis proceeds with no panel results
test('empty panel models does not block synthesis', async () => {
  const emptyPanelMeta: PanelMeta = {
    results: [],
    failedModels: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
  const panelRunner = stubPanelRunner(emptyPanelMeta) as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort({ panelModels: [] }) as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }),
  );

  // Synthesis was called with empty panel results
  const synthCalls = (synthesizeStep as unknown as StubSynthesizeStep)._synthesizeCalls;
  assert.equal(synthCalls.length, 1);
  assert.deepStrictEqual(synthCalls[0].panelResults, []);

  // Pipeline completed with done event (no failedModels since no failures)
  const doneEvent = events.find((e) => e.type === 'done') as {
    type: 'done';
    failedModels?: unknown;
  };
  assert.ok(doneEvent, 'expected done event');
  assert.deepStrictEqual(doneEvent.failedModels, []);
});

// 13. withHeartbeat emits progress events during a slow panel stage
test('withHeartbeat emits panel heartbeat events before Panel stage complete', async () => {
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const slowPanelRunner: StubPanelRunner = {
    _lastMessages: null,
    _lastTimeoutMs: -1,
    _lastSampling: undefined,
    _callCount: 0,
    async run(messages, timeoutMs, _requestId, sampling) {
      slowPanelRunner._callCount++;
      slowPanelRunner._lastMessages = messages;
      slowPanelRunner._lastTimeoutMs = timeoutMs;
      slowPanelRunner._lastSampling = sampling;
      await delay(60);
      return {
        results: [samplePanelResult],
        failedModels: [],
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      };
    },
  };

  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    slowPanelRunner as unknown as PanelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
    10, // heartbeatIntervalMs: small value so heartbeats fire during the 60ms delay
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'hello' }] }),
  );

  const panelHeartbeats = events.filter(
    (e) =>
      e.type === 'progress' &&
      (e as { stage?: string }).stage === 'panel' &&
      (e as { message?: string }).message === 'panel running',
  );
  assert.ok(
    panelHeartbeats.length >= 1,
    `expected at least 1 panel heartbeat, got ${panelHeartbeats.length}`,
  );

  const panelCompleteIdx = events.findIndex(
    (e) => e.type === 'progress' && (e as { message?: string }).message === 'Panel stage complete',
  );
  const lastHeartbeatIdx = events.reduce(
    (max, e, i) =>
      e.type === 'progress' && (e as { message?: string }).message === 'panel running' ? i : max,
    -1,
  );
  assert.ok(
    panelCompleteIdx > lastHeartbeatIdx,
    'Panel stage complete should come after heartbeats',
  );
});

// 14. Messages from request are not mutated
test('messages from request are not mutated', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const originalMessages: Message[] = [{ role: 'user', content: 'hello' }];
  await collectEvents(useCase.runFusion({ messages: originalMessages }));

  assert.equal(originalMessages.length, 1);
  assert.deepStrictEqual(originalMessages[0], { role: 'user', content: 'hello' });
});

// 15. Sampling params are forwarded to PanelRunner and SynthesizeStep
test('sampling params from FusionRequest are forwarded to PanelRunner and SynthesizeStep', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  await collectEvents(
    useCase.runFusion({
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.7,
      maxTokens: 512,
    }),
  );

  const pr = panelRunner as unknown as StubPanelRunner;
  assert.deepStrictEqual(pr._lastSampling, { temperature: 0.7, maxTokens: 512 });

  const synthCalls = (synthesizeStep as unknown as StubSynthesizeStep)._synthesizeCalls;
  assert.equal(synthCalls.length, 1);
  assert.deepStrictEqual(synthCalls[0].sampling, { temperature: 0.7, maxTokens: 512 });
});

// 16. Absent sampling params are not forwarded (no spurious keys)
test('absent sampling params result in empty sampling object forwarded', async () => {
  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const synthesizeStep = stubSynthesizeStep() as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));

  const pr = panelRunner as unknown as StubPanelRunner;
  // sampling should be an empty object (no temperature, no maxTokens keys)
  assert.ok(pr._lastSampling !== undefined, 'sampling arg is always passed (even if empty)');
  assert.equal('temperature' in (pr._lastSampling ?? {}), false);
  assert.equal('maxTokens' in (pr._lastSampling ?? {}), false);
});

// 17. Synthesis heartbeat progress events during slow synthesis TTFT
test('withStreamHeartbeat emits synthesis progress events during slow synthesis', async () => {
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const slowSynth: StubSynthesizeStep = {
    _synthesizeCalls: [],
    async *synthesize(panelResults, originalMessages, analysis, _requestId, sampling) {
      slowSynth._synthesizeCalls.push({ panelResults, originalMessages, analysis, sampling });
      await delay(60);
      yield { type: 'content_delta', delta: 'hello' };
      yield { type: 'content_stop' };
      yield {
        type: 'done',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'test-model',
      };
    },
  };

  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    slowSynth as unknown as SynthesizeStep,
    configPort,
    loggerPort,
    clockPort,
    10, // small heartbeatIntervalMs so heartbeats fire during the 60ms delay
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }),
  );

  const synthHeartbeats = events.filter(
    (e) =>
      e.type === 'progress' &&
      (e as { stage?: string }).stage === 'synthesis' &&
      (e as { message?: string }).message === 'synthesizing',
  );
  assert.ok(
    synthHeartbeats.length >= 1,
    `expected at least 1 synthesis heartbeat, got ${synthHeartbeats.length}`,
  );

  // Done event still appears at the end
  const doneEvent = events.find((e) => e.type === 'done');
  assert.ok(doneEvent, 'expected done event after synthesis heartbeats');
});

// 18. Synthesis truncation yields error event and still logs fusion_run_end
test('synthesis truncation yields error event and still logs fusion_run_end', async () => {
  const truncatedSynth: StubSynthesizeStep = {
    _synthesizeCalls: [],
    async *synthesize(panelResults, originalMessages, analysis, _requestId, sampling) {
      truncatedSynth._synthesizeCalls.push({ panelResults, originalMessages, analysis, sampling });
      yield { type: 'content_delta', delta: 'partial content' };
      yield {
        type: 'error',
        code: 'synthesis_truncated',
        message: 'Synthesis stream aborted by timeout',
      };
    },
  };

  const panelRunner = stubPanelRunner() as unknown as PanelRunner;
  const judgeStep = stubJudgeStep() as unknown as JudgeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    truncatedSynth as unknown as SynthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }),
  );

  // Partial content was forwarded
  const deltaEvents = events.filter((e) => e.type === 'content_delta');
  assert.ok(deltaEvents.length >= 1, 'expected content_delta events before truncation');

  // Error event was emitted
  const errorEvent = events.find((e) => e.type === 'error') as
    | { type: 'error'; code: string }
    | undefined;
  assert.ok(errorEvent, 'expected error event on synthesis truncation');
  assert.equal(errorEvent!.code, 'synthesis_truncated');

  // No done event
  const doneEvent = events.find((e) => e.type === 'done');
  assert.equal(doneEvent, undefined, 'expected no done event when synthesis is truncated');

  // fusion_run_end is still logged even on truncation
  const logCalls = (loggerPort as unknown as StubLoggerPort)._calls;
  const loggedEvents = logCalls.filter((c) => c.method === 'log').map((c) => c.args[1] as string);
  assert.ok(loggedEvents.includes('fusion_run_end'), 'fusion_run_end must be logged on truncation');

  // outcome field reflects truncation
  const endLog = logCalls.find((c) => c.method === 'log' && c.args[1] === 'fusion_run_end');
  const endFields = endLog!.args[2] as { outcome?: string };
  assert.equal(endFields.outcome, 'synthesis_truncated');
});

// 19. fusion_run_end includes aggregated tokensByStage
test('fusion_run_end log includes totalTokens and tokensByStage from all stages', async () => {
  const panelMeta: PanelMeta = {
    results: [samplePanelResult],
    failedModels: [],
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  };
  const panelRunner = stubPanelRunner(panelMeta) as unknown as PanelRunner;
  const judgeUsage: TokenUsage = { promptTokens: 5, completionTokens: 10, totalTokens: 15 };
  const judgeStep = stubJudgeStep(sampleAnalysis, judgeUsage) as unknown as JudgeStep;
  const synthEvents: FusionStreamEvent[] = [
    { type: 'content_delta', delta: 'result' },
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
      model: 'synth-model',
    },
  ];
  const synthesizeStep = stubSynthesizeStep(synthEvents) as unknown as SynthesizeStep;
  const configPort = stubConfigPort() as ConfigPort;
  const loggerPort = stubLoggerPort();
  const clockPort = stubClockPort([0]);

  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  await collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'x' }] }));

  const logCalls = (loggerPort as unknown as StubLoggerPort)._calls;
  const endLog = logCalls.find((c) => c.method === 'log' && c.args[1] === 'fusion_run_end');
  assert.ok(endLog, 'expected fusion_run_end log');

  const fields = endLog!.args[2] as {
    totalTokens?: number;
    tokensByStage?: { panel: number; judge: number; synthesis: number };
  };
  assert.equal(fields.totalTokens, 195); // 30 + 15 + 150
  assert.deepStrictEqual(fields.tokensByStage, { panel: 30, judge: 15, synthesis: 150 });
});
