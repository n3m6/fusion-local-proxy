import test from 'node:test';
import assert from 'node:assert/strict';
import { RunFusionUseCase } from './run-fusion-use-case.js';
import { PanelRunner } from './panel-runner.js';
import { JudgeStep } from './judge-step.js';
import { SynthesizeStep } from './synthesize-step.js';
import { FusionError, type ModelRef } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  TokenUsage,
} from '../../domain/model/chat-types.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';

// ---------------------------------------------------------------------------
// Configurable fake ChatModelPort
// ---------------------------------------------------------------------------

type FakePort = ChatModelPort & {
  completeCalls: ChatRequest[];
  streamCalls: ChatRequest[];
};

/** Fake that resolves complete() with a fixed response (panel/judge use case). */
function fakeCompletingPort(response: ChatResponse): FakePort {
  const completeCalls: ChatRequest[] = [];
  const streamCalls: ChatRequest[] = [];
  return {
    completeCalls,
    streamCalls,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      completeCalls.push(request);
      return response;
    },
    async *stream(request: ChatRequest): AsyncGenerator<ChatStreamChunk> {
      streamCalls.push(request);
      yield { type: 'content_stop' as const };
    },
  };
}

/** Fake that always rejects (panel failure use case). */
function fakeRejectingPort(error: Error): FakePort {
  const completeCalls: ChatRequest[] = [];
  const streamCalls: ChatRequest[] = [];
  return {
    completeCalls,
    streamCalls,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      completeCalls.push(request);
      throw error;
    },
    async *stream(request: ChatRequest): AsyncGenerator<ChatStreamChunk> {
      streamCalls.push(request);
      throw error;
    },
  };
}

/** Fake that streams content_delta + content_stop + usage (synthesizer use case). */
function fakeStreamingPort(content: string, usage: TokenUsage, model = 'synth-model'): FakePort {
  const completeCalls: ChatRequest[] = [];
  const streamCalls: ChatRequest[] = [];
  return {
    completeCalls,
    streamCalls,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      completeCalls.push(request);
      return { content, usage, model };
    },
    async *stream(request: ChatRequest): AsyncGenerator<ChatStreamChunk> {
      streamCalls.push(request);
      yield { type: 'content_delta' as const, delta: content };
      yield { type: 'content_stop' as const };
      yield { type: 'usage' as const, usage };
    },
  };
}

// ---------------------------------------------------------------------------
// Infrastructure helpers
// ---------------------------------------------------------------------------

function noopLogger(): LoggerPort {
  return {
    logStageStart(): void {},
    logStageEnd(): void {},
    logFailedModels(): void {},
    logError(): void {},
    logRequest(): void {},
    logResponse(): void {},
    log(): void {},
  };
}

const clock: ClockPort = { now: () => Date.now() };

// ---------------------------------------------------------------------------
// Fixture model refs
// ---------------------------------------------------------------------------

const panel1: ModelRef = {
  provider: 'openai',
  model: 'panel-1',
  baseURL: 'http://x/v1',
  apiKey: 'k',
};
const panel2: ModelRef = {
  provider: 'openai',
  model: 'panel-2',
  baseURL: 'http://x/v1',
  apiKey: 'k',
};
const judgeRef: ModelRef = {
  provider: 'openai',
  model: 'judge',
  baseURL: 'http://x/v1',
  apiKey: 'k',
};
const synthRef: ModelRef = {
  provider: 'openai',
  model: 'synth',
  baseURL: 'http://x/v1',
  apiKey: 'k',
};

// ---------------------------------------------------------------------------
// Valid analysis fixture (matches analysisSchema)
// ---------------------------------------------------------------------------

const validAnalysis = {
  agreements: ['Both panels agree the answer is correct'],
  discrepancies: [],
  issues: [],
  gaps: [],
  recommendation: 'Use the combined answer.',
};

// ---------------------------------------------------------------------------
// Wire up the real pipeline with fake ports
// ---------------------------------------------------------------------------

function buildUseCase(opts: {
  panelPorts: ChatModelPort[];
  panelModels: ModelRef[];
  judgePort: ChatModelPort | null;
  judgeModel: ModelRef | null;
  synthPort: ChatModelPort;
  timeoutMs?: number;
}): RunFusionUseCase {
  const logger = noopLogger();
  const configPort: ConfigPort = {
    getPanelModels: () => opts.panelModels,
    getJudgeModel: () => opts.judgeModel,
    getSynthesizerModel: () => synthRef,
    getTimeoutMs: () => opts.timeoutMs ?? 30000,
  };
  const panelPairs = opts.panelModels.map((m, i) => ({ modelRef: m, port: opts.panelPorts[i]! }));
  const panelRunner = new PanelRunner(panelPairs, logger, clock);
  const judgeStep =
    opts.judgePort && opts.judgeModel
      ? new JudgeStep(opts.judgePort, logger, clock)
      : null;
  const synthesizeStep = new SynthesizeStep(opts.synthPort, configPort, logger, clock);
  return new RunFusionUseCase(panelRunner, judgeStep, synthesizeStep, configPort, logger, clock);
}

async function collectEvents(it: AsyncIterable<FusionStreamEvent>): Promise<FusionStreamEvent[]> {
  const events: FusionStreamEvent[] = [];
  for await (const ev of it) {
    events.push(ev);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('happy path: full ensemble produces correct event sequence and analysis flows to synth prompt', async () => {
  const panelPort1 = fakeCompletingPort({
    content: 'Panel 1 response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'panel-1',
  });
  const panelPort2 = fakeCompletingPort({
    content: 'Panel 2 response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'panel-2',
  });
  const judgePort = fakeCompletingPort({
    content: JSON.stringify(validAnalysis),
    usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
    model: 'judge',
  });
  const synthUsage: TokenUsage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
  const synthPort = fakeStreamingPort('Synthesized answer', synthUsage, 'synth');

  const useCase = buildUseCase({
    panelPorts: [panelPort1, panelPort2],
    panelModels: [panel1, panel2],
    judgePort,
    judgeModel: judgeRef,
    synthPort,
  });

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'What is 2+2?' }] }),
  );

  // Both panel and judge progress events must appear
  const progressStages = events
    .filter((e): e is Extract<FusionStreamEvent, { type: 'progress' }> => e.type === 'progress')
    .map((e) => e.stage);
  assert.ok(progressStages.includes('panel'), 'expected panel progress event');
  assert.ok(progressStages.includes('judge'), 'expected judge progress event');

  // Content must flow through
  assert.ok(
    events.some((e) => e.type === 'content_delta'),
    'expected content_delta',
  );
  assert.ok(
    events.some((e) => e.type === 'content_stop'),
    'expected content_stop',
  );

  // Done event with empty failedModels and real usage from synth port
  const done = events.find(
    (e): e is Extract<FusionStreamEvent, { type: 'done' }> => e.type === 'done',
  );
  assert.ok(done, 'expected done event');
  assert.deepEqual(done.failedModels, []);
  assert.deepEqual(done.usage, synthUsage);
  assert.equal(done.model, synthRef.model);

  // Cross-step contract: analysis text must reach the synthesizer's user prompt
  assert.equal(synthPort.streamCalls.length, 1);
  const synthUserPrompt = synthPort.streamCalls[0]!.messages[1]!.content;
  assert.ok(
    synthUserPrompt.includes('=== PANEL ANALYSIS ==='),
    'synth prompt must contain PANEL ANALYSIS section',
  );
  assert.ok(
    synthUserPrompt.includes('Both panels agree the answer is correct'),
    'synth prompt must include the agreement text from judge analysis',
  );
});

test('judge degradation: invalid JSON from judge → analysis null → synth prompt contains fallback note', async () => {
  const panelPort = fakeCompletingPort({
    content: 'Panel response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'panel-1',
  });
  const judgePort = fakeCompletingPort({
    content: 'NOT_VALID_JSON {{{',
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    model: 'judge',
  });
  const synthPort = fakeStreamingPort(
    'Fallback synthesis',
    { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
    'synth',
  );

  const useCase = buildUseCase({
    panelPorts: [panelPort],
    panelModels: [panel1],
    judgePort,
    judgeModel: judgeRef,
    synthPort,
  });

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'Hello' }] }),
  );

  assert.ok(
    events.some((e) => e.type === 'done'),
    'run must complete with done event even when judge returns invalid JSON',
  );

  assert.equal(synthPort.streamCalls.length, 1);
  const synthUserPrompt = synthPort.streamCalls[0]!.messages[1]!.content;
  assert.ok(
    synthUserPrompt.includes('Panel-level analysis is unavailable'),
    'synth prompt must include fallback note when judge returns invalid JSON',
  );
  assert.ok(
    !synthUserPrompt.includes('=== PANEL ANALYSIS ==='),
    'synth prompt must NOT include PANEL ANALYSIS section when analysis is null',
  );
});

test('judge degradation: schema-failing JSON from judge → analysis null → synth gets fallback', async () => {
  const panelPort = fakeCompletingPort({
    content: 'Panel response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'panel-1',
  });
  // Valid JSON but fails analysis schema: agreements must be an array, not a string
  const badSchema = {
    agreements: 'not an array',
    discrepancies: [],
    issues: [],
    gaps: [],
    recommendation: 'x',
  };
  const judgePort = fakeCompletingPort({
    content: JSON.stringify(badSchema),
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    model: 'judge',
  });
  const synthPort = fakeStreamingPort(
    'Fallback synthesis',
    { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
    'synth',
  );

  const useCase = buildUseCase({
    panelPorts: [panelPort],
    panelModels: [panel1],
    judgePort,
    judgeModel: judgeRef,
    synthPort,
  });

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'Hello' }] }),
  );

  assert.ok(
    events.some((e) => e.type === 'done'),
    'run must complete with done event even when judge JSON fails schema validation',
  );

  assert.equal(synthPort.streamCalls.length, 1);
  const synthUserPrompt = synthPort.streamCalls[0]!.messages[1]!.content;
  assert.ok(
    synthUserPrompt.includes('Panel-level analysis is unavailable'),
    'synth prompt must include fallback note when judge JSON fails schema validation',
  );
});

test('partial panel failure: one panel rejects → done.failedModels has one entry', async () => {
  const panelPort1 = fakeCompletingPort({
    content: 'Surviving panel response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'panel-1',
  });
  const panelPort2 = fakeRejectingPort(new Error('Model panel-2 unavailable'));
  const judgePort = fakeCompletingPort({
    content: JSON.stringify(validAnalysis),
    usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
    model: 'judge',
  });
  const synthPort = fakeStreamingPort(
    'Synthesized',
    { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
    'synth',
  );

  const useCase = buildUseCase({
    panelPorts: [panelPort1, panelPort2],
    panelModels: [panel1, panel2],
    judgePort,
    judgeModel: judgeRef,
    synthPort,
  });

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'Hello' }] }),
  );

  const done = events.find(
    (e): e is Extract<FusionStreamEvent, { type: 'done' }> => e.type === 'done',
  );
  assert.ok(done, 'expected done event');
  assert.equal(done.failedModels?.length, 1, 'exactly one failed model entry');
  assert.equal(done.failedModels?.[0]?.modelId, panel2.model);
});

test('total panel failure: all panels reject → runFusion rejects with all_panels_failed; judge and synth never called', async () => {
  const panelPort1 = fakeRejectingPort(new Error('panel-1 down'));
  const panelPort2 = fakeRejectingPort(new Error('panel-2 down'));
  const judgePort = fakeCompletingPort({
    content: JSON.stringify(validAnalysis),
    usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
    model: 'judge',
  });
  const synthPort = fakeStreamingPort('Should not run', {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });

  const useCase = buildUseCase({
    panelPorts: [panelPort1, panelPort2],
    panelModels: [panel1, panel2],
    judgePort,
    judgeModel: judgeRef,
    synthPort,
  });

  await assert.rejects(
    () => collectEvents(useCase.runFusion({ messages: [{ role: 'user', content: 'Hi' }] })),
    (err: unknown) => {
      assert.ok(err instanceof FusionError, 'error must be a FusionError');
      assert.equal(err.code, 'all_panels_failed');
      return true;
    },
  );

  assert.equal(
    judgePort.completeCalls.length,
    0,
    'judge must never be called when all panels fail',
  );
  assert.equal(synthPort.streamCalls.length, 0, 'synth must never be called when all panels fail');
});

test('no judge configured: judge port never called; synth receives null analysis → fallback note', async () => {
  const panelPort = fakeCompletingPort({
    content: 'Panel response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'panel-1',
  });
  const synthPort = fakeStreamingPort(
    'No-judge synthesis',
    { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
    'synth',
  );

  const useCase = buildUseCase({
    panelPorts: [panelPort],
    panelModels: [panel1],
    judgePort: null,
    judgeModel: null,
    synthPort,
  });

  const events = await collectEvents(
    useCase.runFusion({ messages: [{ role: 'user', content: 'Hello' }] }),
  );

  assert.ok(
    events.some((e) => e.type === 'done'),
    'expected done event',
  );

  // Synth receives null analysis → fallback note in user prompt
  assert.equal(synthPort.streamCalls.length, 1);
  const synthUserPrompt = synthPort.streamCalls[0]!.messages[1]!.content;
  assert.ok(
    synthUserPrompt.includes('Panel-level analysis is unavailable'),
    'synth prompt must include fallback note when no judge is configured',
  );
});
