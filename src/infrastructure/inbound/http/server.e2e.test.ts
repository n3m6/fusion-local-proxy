import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './server.js';
import { RunFusionUseCase } from '../../../application/usecases/run-fusion-use-case.js';
import { PanelRunner } from '../../../application/usecases/panel-runner.js';
import { JudgeStep } from '../../../application/usecases/judge-step.js';
import { SynthesizeStep } from '../../../application/usecases/synthesize-step.js';
import { type ModelRef } from '../../../domain/model/fusion-types.js';
import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  TokenUsage,
} from '../../../domain/model/chat-types.js';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import type { LoggerPort } from '../../../domain/ports/logger-port.js';
import type { ClockPort } from '../../../domain/ports/clock-port.js';

// ---------------------------------------------------------------------------
// Configurable fake ChatModelPort (same pattern as integration test)
// ---------------------------------------------------------------------------

type FakePort = ChatModelPort & {
  completeCalls: ChatRequest[];
  streamCalls: ChatRequest[];
};

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

const validAnalysis = {
  agreements: ['Both panels agree the answer is correct'],
  discrepancies: [],
  issues: [],
  gaps: [],
  recommendation: 'Use the combined answer.',
};

const SYNTH_CONTENT = 'End-to-end synthesized response';
const SYNTH_USAGE: TokenUsage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };

// ---------------------------------------------------------------------------
// Server builder helpers
// ---------------------------------------------------------------------------

type BuildOpts = {
  panelPorts?: FakePort[];
  panelModels?: ModelRef[];
  judgePort?: FakePort;
  judgeModel?: ModelRef | null;
  synthPort?: FakePort;
};

function buildApp(opts: BuildOpts = {}) {
  const logger = noopLogger();
  const clock: ClockPort = { now: () => Date.now() };
  const panelModels = opts.panelModels ?? [panel1, panel2];
  const judgeModel = opts.judgeModel !== undefined ? opts.judgeModel : judgeRef;

  const panelPorts =
    opts.panelPorts ??
    panelModels.map(() =>
      fakeCompletingPort({
        content: 'Panel response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: 'panel',
      }),
    );

  const judgePort =
    opts.judgePort ??
    fakeCompletingPort({
      content: JSON.stringify(validAnalysis),
      usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
      model: 'judge',
    });

  const synthPort = opts.synthPort ?? fakeStreamingPort(SYNTH_CONTENT, SYNTH_USAGE, 'synth');

  const configPort: ConfigPort = {
    getPanelModels: () => panelModels,
    getJudgeModel: () => judgeModel,
    getSynthesizerModel: () => synthRef,
    getTimeoutMs: () => 30000,
    getAgentModel: () => null,
    getAutocompleteModel: () => null,
  };

  const panelPairs = panelModels.map((m, i) => ({ modelRef: m, port: panelPorts[i]! }));
  const panelRunner = new PanelRunner(panelPairs, logger, clock);
  // Mirror the real container: only build a JudgeStep when a judge model is
  // configured, so the injected step and the config never disagree.
  const judgeStep = judgeModel ? new JudgeStep(judgePort, judgeModel, logger, clock) : null;
  const synthesizeStep = new SynthesizeStep(synthPort, configPort, logger, clock);
  const useCase = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    logger,
    clock,
  );

  return createServer(useCase, configPort);
}

/** App where every panel port rejects (total failure). */
function buildFailingApp() {
  const rejectingPorts = [
    fakeRejectingPort(new Error('panel-1 down')),
    fakeRejectingPort(new Error('panel-2 down')),
  ];
  return buildApp({
    panelPorts: rejectingPorts,
    panelModels: [panel1, panel2],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postOpenAi(app: ReturnType<typeof buildApp>, body: unknown) {
  return app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postAnthropic(app: ReturnType<typeof buildApp>, body: unknown) {
  return app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const openAiMsg = { model: 'gpt-test', messages: [{ role: 'user', content: 'Hello' }] };
const anthropicMsg = {
  model: 'claude-test',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
};

// ---------------------------------------------------------------------------
// OpenAI streaming
// ---------------------------------------------------------------------------

test('e2e: OpenAI streaming returns text/event-stream with SSE comments, chunk data, and [DONE]', async () => {
  const app = buildApp();

  const res = await postOpenAi(app, { ...openAiMsg, stream: true });

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(
    contentType.includes('text/event-stream'),
    `expected text/event-stream, got ${contentType}`,
  );

  const body = await res.text();
  // Progress events from the real pipeline yield SSE comment lines
  assert.ok(body.includes(': '), 'SSE body must contain comment lines (progress events)');
  // Real synthesized content appears in data chunks
  assert.ok(body.includes(SYNTH_CONTENT), 'SSE body must contain synthesized content');
  assert.ok(
    body.includes('chat.completion.chunk'),
    'SSE body must contain chat.completion.chunk objects',
  );
  assert.ok(body.includes('data: [DONE]'), 'SSE stream must terminate with data: [DONE]');
});

// ---------------------------------------------------------------------------
// OpenAI non-streaming
// ---------------------------------------------------------------------------

test('e2e: OpenAI non-streaming returns chat.completion JSON with real content and usage', async () => {
  const app = buildApp();

  const res = await postOpenAi(app, openAiMsg);

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(
    contentType.includes('application/json'),
    `expected application/json, got ${contentType}`,
  );

  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.object, 'chat.completion');

  const choices = json.choices as Array<Record<string, unknown>>;
  const message = choices[0]!.message as Record<string, unknown>;
  assert.equal(message.content, SYNTH_CONTENT, 'response content must match synthesized text');

  const usage = json.usage as Record<string, unknown>;
  assert.equal(usage.prompt_tokens, SYNTH_USAGE.promptTokens);
  assert.equal(usage.completion_tokens, SYNTH_USAGE.completionTokens);
  assert.equal(usage.total_tokens, SYNTH_USAGE.totalTokens);
});

// ---------------------------------------------------------------------------
// Anthropic streaming
// ---------------------------------------------------------------------------

test('e2e: Anthropic streaming returns text/event-stream with all 6 event types and heartbeat comments', async () => {
  const app = buildApp();

  const res = await postAnthropic(app, anthropicMsg);

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(
    contentType.includes('text/event-stream'),
    `expected text/event-stream, got ${contentType}`,
  );

  const body = await res.text();

  // Progress events become ': heartbeat' comments in the Anthropic SSE encoder
  assert.ok(body.includes(': heartbeat'), 'Anthropic SSE must contain heartbeat comment lines');

  // All 6 Anthropic event types must appear in order
  const eventNames = [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ];
  let lastIdx = -1;
  for (const name of eventNames) {
    const idx = body.indexOf(`event: ${name}`);
    assert.ok(idx >= 0, `SSE body must contain event: ${name}`);
    assert.ok(idx > lastIdx, `event: ${name} must appear after previous event`);
    lastIdx = idx;
  }

  // Real synthesized content appears in content_block_delta
  assert.ok(body.includes(SYNTH_CONTENT), 'SSE body must contain synthesized content');
});

// ---------------------------------------------------------------------------
// Anthropic non-streaming
// ---------------------------------------------------------------------------

test('e2e: Anthropic non-streaming returns type:message JSON with real content and usage', async () => {
  const app = buildApp();

  const res = await postAnthropic(app, { ...anthropicMsg, stream: false });

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(
    contentType.includes('application/json'),
    `expected application/json, got ${contentType}`,
  );

  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.type, 'message');
  assert.equal(json.role, 'assistant');
  assert.equal(json.stop_reason, 'end_turn');

  const content = json.content as Array<{ type: string; text: string }>;
  assert.ok(Array.isArray(content) && content.length > 0);
  assert.equal(content[0]!.type, 'text');
  assert.equal(content[0]!.text, SYNTH_CONTENT, 'response text must match synthesized content');

  const usage = json.usage as { input_tokens: number; output_tokens: number };
  assert.equal(usage.input_tokens, SYNTH_USAGE.promptTokens);
  assert.equal(usage.output_tokens, SYNTH_USAGE.completionTokens);
});

// ---------------------------------------------------------------------------
// Error surfacing: total panel failure
// ---------------------------------------------------------------------------

test('e2e: total panel failure → OpenAI non-streaming returns 500 with all_panels_failed', async () => {
  const app = buildFailingApp();

  const res = await postOpenAi(app, openAiMsg);

  assert.equal(res.status, 500);
  const json = (await res.json()) as Record<string, unknown>;
  const error = json.error as Record<string, unknown>;
  assert.ok(error, 'response must contain an error object');
  assert.equal(error.code, 'all_panels_failed');
});

test('e2e: total panel failure → OpenAI streaming contains error, no [DONE]', async () => {
  const app = buildFailingApp();

  const res = await postOpenAi(app, { ...openAiMsg, stream: true });

  // streamSSE may commit 200 before the error propagates
  const body = await res.text();
  assert.ok(
    body.includes('all_panels_failed'),
    'SSE error body must contain all_panels_failed code',
  );
  assert.ok(!body.includes('[DONE]'), 'SSE must not contain [DONE] after a pipeline error');
});

test('e2e: total panel failure → Anthropic non-streaming returns 500 with all_panels_failed', async () => {
  const app = buildFailingApp();

  const res = await postAnthropic(app, { ...anthropicMsg, stream: false });

  assert.equal(res.status, 500);
  const json = (await res.json()) as Record<string, unknown>;
  const error = json.error as Record<string, unknown>;
  assert.ok(error, 'response must contain an error object');
  assert.equal(error.type, 'all_panels_failed');
});
