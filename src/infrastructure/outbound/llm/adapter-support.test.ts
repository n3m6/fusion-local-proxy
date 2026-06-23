import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequestLogFields,
  buildBaseLogFields,
  createStreamMetrics,
  onContentDelta,
  onReasoningDelta,
  buildStreamResponseLogFields,
  buildCompleteResponseLogFields,
} from './adapter-support.js';
import type { ChatRequest } from '../../../domain/model/chat-types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_MODEL = {
  provider: 'openai' as const,
  model: 'gpt-4o',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
};

function makeRequest(overrides?: Partial<ChatRequest>): ChatRequest {
  return {
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    model: BASE_MODEL,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildRequestLogFields
// ---------------------------------------------------------------------------

test('buildRequestLogFields includes provider, modelId, baseURL, mode, messageCount, promptChars', () => {
  const request = makeRequest();
  const fields = buildRequestLogFields(request, 'openai', 'complete');

  assert.equal(fields.provider, 'openai');
  assert.equal(fields.modelId, 'gpt-4o');
  assert.equal(fields.baseURL, 'https://api.openai.com/v1');
  assert.equal(fields.mode, 'complete');
  assert.equal(fields.messageCount, 2);
  // promptChars = 'Hello'.length + 'Hi there!'.length = 5 + 9 = 14
  assert.equal(fields.promptChars, 14);
});

test('buildRequestLogFields includes prompt messages array', () => {
  const request = makeRequest();
  const fields = buildRequestLogFields(request, 'openai', 'stream');

  assert.deepEqual(fields.prompt, request.messages);
});

test('buildRequestLogFields includes requestId, stage, label from options', () => {
  const request = makeRequest({
    options: {
      requestId: 'req-123',
      stage: 'panel',
      label: 'panel-0',
    },
  });

  const fields = buildRequestLogFields(request, 'openai', 'complete');

  assert.equal(fields.requestId, 'req-123');
  assert.equal(fields.stage, 'panel');
  assert.equal(fields.label, 'panel-0');
});

test('buildRequestLogFields includes temperature, maxTokens from options', () => {
  const request = makeRequest({
    options: { temperature: 0.7, maxTokens: 512 },
  });

  const fields = buildRequestLogFields(request, 'openai', 'complete');

  assert.equal(fields.temperature, 0.7);
  assert.equal(fields.maxTokens, 512);
});

test('buildRequestLogFields includes responseFormat type', () => {
  const request = makeRequest({
    options: { responseFormat: { type: 'json_object' } },
  });

  const fields = buildRequestLogFields(request, 'openai', 'complete');

  assert.equal(fields.responseFormat, 'json_object');
});

test('buildRequestLogFields includes thinkingMode and thinkingStrength from model', () => {
  const request = makeRequest({
    model: { ...BASE_MODEL, thinkingMode: 'lateral' as const, thinkingStrength: 'high' as const },
  });

  const fields = buildRequestLogFields(request, 'anthropic', 'stream');

  assert.equal(fields.thinkingMode, 'lateral');
  assert.equal(fields.thinkingStrength, 'high');
});

test('buildRequestLogFields stream mode sets mode to stream', () => {
  const fields = buildRequestLogFields(makeRequest(), 'openai', 'stream');
  assert.equal(fields.mode, 'stream');
});

// ---------------------------------------------------------------------------
// buildBaseLogFields
// ---------------------------------------------------------------------------

test('buildBaseLogFields includes provider, modelId, baseURL, requestId, stage, label', () => {
  const request = makeRequest({
    options: { requestId: 'rid', stage: 'judge', label: 'judge-0' },
  });

  const fields = buildBaseLogFields(request, 'openai');

  assert.equal(fields.provider, 'openai');
  assert.equal(fields.modelId, 'gpt-4o');
  assert.equal(fields.baseURL, 'https://api.openai.com/v1');
  assert.equal(fields.requestId, 'rid');
  assert.equal(fields.stage, 'judge');
  assert.equal(fields.label, 'judge-0');
});

test('buildBaseLogFields does NOT include mode, messageCount, promptChars, or prompt', () => {
  const fields = buildBaseLogFields(makeRequest(), 'openai');

  assert.equal('mode' in fields, false);
  assert.equal('messageCount' in fields, false);
  assert.equal('promptChars' in fields, false);
  assert.equal('prompt' in fields, false);
});

// ---------------------------------------------------------------------------
// createStreamMetrics — initial state
// ---------------------------------------------------------------------------

test('createStreamMetrics returns zero initial state', () => {
  const m = createStreamMetrics();

  assert.equal(m.ttftMs, undefined);
  assert.equal(m.deltaCount, 0);
  assert.equal(m.contentChars, 0);
  assert.equal(m.fullContent, '');
  assert.equal(m.reasoningChars, 0);
});

// ---------------------------------------------------------------------------
// onContentDelta
// ---------------------------------------------------------------------------

test('onContentDelta sets ttftMs on first call and increments counters', () => {
  const m = createStreamMetrics();
  const startTime = Date.now() - 100; // 100ms ago

  onContentDelta(m, 'Hello', startTime);

  assert.ok(m.ttftMs !== undefined, 'ttftMs should be set after first delta');
  assert.ok(m.ttftMs >= 100, 'ttftMs should be at least the elapsed time');
  assert.equal(m.deltaCount, 1);
  assert.equal(m.contentChars, 5);
  assert.equal(m.fullContent, 'Hello');
});

test('onContentDelta does not update ttftMs on subsequent calls', async () => {
  const m = createStreamMetrics();
  const startTime = Date.now();

  onContentDelta(m, 'Hello', startTime);
  const firstTtft = m.ttftMs;

  await new Promise((r) => setTimeout(r, 10));
  onContentDelta(m, ' world', startTime);

  assert.equal(m.ttftMs, firstTtft, 'ttftMs must not change after first delta');
});

test('onContentDelta accumulates fullContent across multiple calls', () => {
  const m = createStreamMetrics();
  const t = Date.now();

  onContentDelta(m, 'Hello', t);
  onContentDelta(m, ' world', t);
  onContentDelta(m, '!', t);

  assert.equal(m.fullContent, 'Hello world!');
  assert.equal(m.contentChars, 12);
  assert.equal(m.deltaCount, 3);
});

test('onContentDelta does not affect reasoningChars', () => {
  const m = createStreamMetrics();
  const t = Date.now();

  onContentDelta(m, 'text', t);

  assert.equal(m.reasoningChars, 0);
});

// ---------------------------------------------------------------------------
// onReasoningDelta
// ---------------------------------------------------------------------------

test('onReasoningDelta accumulates reasoningChars only (does not affect content fields)', () => {
  const m = createStreamMetrics();

  onReasoningDelta(m, 'Thinking step 1...');
  onReasoningDelta(m, 'Step 2');

  // 'Thinking step 1...' = 18 chars, 'Step 2' = 6 chars
  assert.equal(m.reasoningChars, 24);

  // content fields should be untouched
  assert.equal(m.fullContent, '');
  assert.equal(m.contentChars, 0);
  assert.equal(m.deltaCount, 0);
  assert.equal(m.ttftMs, undefined);
});

// ---------------------------------------------------------------------------
// buildStreamResponseLogFields
// ---------------------------------------------------------------------------

test('buildStreamResponseLogFields includes base fields, mode:stream, latencyMs, ttftMs, deltaCount, contentChars, content', () => {
  const request = makeRequest();
  const m = createStreamMetrics();
  const startTime = Date.now() - 200;

  onContentDelta(m, 'Hello world', startTime);

  const fields = buildStreamResponseLogFields(request, 'openai', m, startTime);

  assert.equal(fields.mode, 'stream');
  assert.ok(typeof fields.latencyMs === 'number' && (fields.latencyMs as number) >= 200);
  assert.ok(typeof fields.ttftMs === 'number');
  assert.equal(fields.deltaCount, 1);
  assert.equal(fields.contentChars, 11);
  assert.equal(fields.content, 'Hello world');
});

test('buildStreamResponseLogFields omits reasoningChars when zero', () => {
  const request = makeRequest();
  const m = createStreamMetrics();
  const t = Date.now();

  onContentDelta(m, 'x', t);

  const fields = buildStreamResponseLogFields(request, 'openai', m, t);
  assert.equal('reasoningChars' in fields, false, 'reasoningChars must be omitted when zero');
});

test('buildStreamResponseLogFields includes reasoningChars when non-zero', () => {
  const request = makeRequest();
  const m = createStreamMetrics();
  const t = Date.now();

  onContentDelta(m, 'answer', t);
  onReasoningDelta(m, 'thinking for a bit');

  const fields = buildStreamResponseLogFields(request, 'openai', m, t);
  assert.equal(fields.reasoningChars, 'thinking for a bit'.length);
});

test('buildStreamResponseLogFields includes tokens when provided', () => {
  const request = makeRequest();
  const m = createStreamMetrics();
  const t = Date.now();

  onContentDelta(m, 'hi', t);

  const tokens = { prompt: 10, completion: 20, total: 30, reasoning: 5 };
  const fields = buildStreamResponseLogFields(request, 'openai', m, t, tokens);

  assert.deepEqual(fields.tokens, tokens);
});

test('buildStreamResponseLogFields omits tokens when not provided', () => {
  const request = makeRequest();
  const m = createStreamMetrics();
  const t = Date.now();
  onContentDelta(m, 'hi', t);

  const fields = buildStreamResponseLogFields(request, 'openai', m, t);
  assert.equal('tokens' in fields, false, 'tokens must be omitted when not provided');
});

// ---------------------------------------------------------------------------
// buildCompleteResponseLogFields
// ---------------------------------------------------------------------------

test('buildCompleteResponseLogFields includes base fields, mode:complete, latencyMs, contentChars, tokens, content', () => {
  const request = makeRequest();
  const startTime = Date.now() - 50;
  const tokens = { prompt: 5, completion: 10, total: 15 };

  const fields = buildCompleteResponseLogFields(
    request,
    'openai',
    startTime,
    'response text',
    tokens,
  );

  assert.equal(fields.mode, 'complete');
  assert.ok(typeof fields.latencyMs === 'number' && (fields.latencyMs as number) >= 50);
  assert.equal(fields.contentChars, 'response text'.length);
  assert.deepEqual(fields.tokens, tokens);
  assert.equal(fields.content, 'response text');
});

test('buildCompleteResponseLogFields includes extra fields when provided', () => {
  const request = makeRequest();
  const startTime = Date.now();
  const tokens = { prompt: 1, completion: 2, total: 3 };

  const fields = buildCompleteResponseLogFields(request, 'anthropic', startTime, 'hi', tokens, {
    reasoningChars: 42,
    finishReason: 'stop',
  });

  assert.equal(fields.reasoningChars, 42);
  assert.equal(fields.finishReason, 'stop');
});
