import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { createServer } from './server.js';
import type { FusionService } from '../../../application/ports/fusion-service.js';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import { FusionError, type FusionRequest } from '../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../domain/model/stream-types.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubFusionService(events?: FusionStreamEvent[]): FusionService {
  const streamEvents = events ?? [
    { type: 'content_delta', delta: 'Hello from test' },
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 1, completionTokens: 3, totalTokens: 4 },
      failedModels: [],
      model: 'test-model',
    },
  ];

  const iterable: AsyncIterable<FusionStreamEvent> = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < streamEvents.length) {
            return { value: streamEvents[i++]!, done: false };
          }
          return { value: undefined as never, done: true };
        },
      };
    },
  };

  return {
    runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      return iterable;
    },
  };
}

function stubFusionServiceThatThrows(error: Error): FusionService {
  return {
    async *runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      throw error;
    },
  };
}

function stubFusionServiceWithErrorEvent(code: string, message: string): FusionService {
  const iterable: AsyncIterable<FusionStreamEvent> = {
    [Symbol.asyncIterator]() {
      let yielded = false;
      return {
        async next() {
          if (!yielded) {
            yielded = true;
            return { value: { type: 'error' as const, code, message }, done: false };
          }
          return { value: undefined as never, done: true };
        },
      };
    },
  };

  return {
    runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      return iterable;
    },
  };
}

function stubConfigPort(panelModels?: ModelRef[]): ConfigPort {
  const models = panelModels ?? [
    {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    },
  ];
  return {
    getPanelModels: () => models,
    getJudgeModel: () => null,
    getSynthesizerModel: () => ({
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    }),
    getTimeoutMs: () => 30000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('createServer returns a Hono instance with routes mounted', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();

  const app = createServer(fusionService, configPort);
  assert.ok(app instanceof Hono);
});

test('POST /v1/chat/completions returns 200 with ChatCompletion JSON', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  assert.equal(res.status, 200);

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.object, 'chat.completion');
  assert.equal(typeof body.id, 'string');
  assert.ok((body.id as string).startsWith('chatcmpl-'));

  const choices = body.choices as Array<Record<string, unknown>>;
  assert.equal(choices.length, 1);
  assert.equal(choices[0].index, 0);

  const message = choices[0].message as Record<string, unknown>;
  assert.equal(message.role, 'assistant');
  assert.equal(message.content, 'Hello from test');

  const usage = body.usage as Record<string, unknown>;
  assert.equal(usage.prompt_tokens, 1);
  assert.equal(usage.completion_tokens, 3);
  assert.equal(usage.total_tokens, 4);
});

test('GET /v1/models returns 200 with model list', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/models');
  assert.equal(res.status, 200);

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.object, 'list');
  assert.ok(Array.isArray(body.data));
});

test('POST /v1/chat/completions with invalid JSON body returns 400', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as Record<string, unknown>;
  const error = body.error as Record<string, unknown>;
  assert.ok(error);
  assert.equal(error.message, 'Invalid JSON body');
});

test('POST /v1/chat/completions returns 500 on fusion service error', async () => {
  const fusionService = stubFusionServiceThatThrows(new Error('Upstream failure'));
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  assert.equal(res.status, 500);
  const body = (await res.json()) as Record<string, unknown>;
  const error = body.error as Record<string, unknown>;
  assert.ok(error);
  assert.equal(error.message, 'Internal server error');
});

test('POST /v1/chat/completions returns 500 on async iterable error event', async () => {
  const fusionService = stubFusionServiceWithErrorEvent('MODEL_DOWN', 'Upstream model unavailable');
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  assert.equal(res.status, 500);
  const body = (await res.json()) as Record<string, unknown>;
  const error = body.error as Record<string, unknown>;
  assert.ok(error);
  assert.equal(error.message, 'Upstream model unavailable');
});

test('POST /v1/chat/completions empty messages returns 200 (passthrough)', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [],
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.object, 'chat.completion');
});

test('POST /v1/chat/completions returns 500 with FusionError body on all_panels_failed', async () => {
  const failedModels = [{ modelId: 'm1', errorCode: 'TIMEOUT', errorMessage: 'timed out' }];
  const error = new FusionError('all_panels_failed', 'All panel models failed', { failedModels });

  const fusionService: FusionService = {
    async *runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      await Promise.resolve();
      throw error;
    },
  };

  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  assert.equal(res.status, 500);
  const body = (await res.json()) as Record<string, unknown>;
  const err = body.error as Record<string, unknown>;
  assert.ok(err);
  assert.equal(err.code, 'all_panels_failed');
  assert.equal(err.message, 'All panel models failed');

  const details = err.details as Record<string, unknown>;
  assert.ok(details);
  assert.ok(Array.isArray(details.failedModels));
  const models = details.failedModels as Array<Record<string, unknown>>;
  assert.equal(models.length, 1);
  assert.equal(models[0].modelId, 'm1');
  assert.equal(models[0].errorCode, 'TIMEOUT');
});

// ---------------------------------------------------------------------------
// Streaming (SSE) route tests
// ---------------------------------------------------------------------------

test('POST /v1/chat/completions with stream:true returns text/event-stream content type', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    }),
  });

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(
    contentType.includes('text/event-stream'),
    `expected text/event-stream, got ${contentType}`,
  );
});

test('POST /v1/chat/completions with stream:true body contains data: lines', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.text();

  // SSE body should contain data: lines
  assert.ok(body.includes('data: '), 'SSE body should contain data: lines');
  // Should end with [DONE]
  assert.ok(body.includes('[DONE]'), 'SSE stream should terminate with [DONE]');
});

test('POST /v1/chat/completions with stream:true includes chat.completion.chunk', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    }),
  });

  const body = await res.text();
  assert.ok(
    body.includes('chat.completion.chunk'),
    'SSE body should contain chat.completion.chunk object',
  );
});

test('POST /v1/chat/completions with stream:false returns JSON', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    }),
  });

  assert.equal(res.status, 200);

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.object, 'chat.completion');
  // Should NOT contain SSE-specific markers
  const textBody = JSON.stringify(body);
  assert.ok(!textBody.includes('data: '));
  assert.ok(!textBody.includes('[DONE]'));
});

test('POST /v1/chat/completions with stream:true handles error event via SSE', async () => {
  const fusionService = stubFusionServiceWithErrorEvent('MODEL_DOWN', 'Upstream model unavailable');
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    }),
  });

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(
    contentType.includes('text/event-stream'),
    `expected text/event-stream, got ${contentType}`,
  );

  const body = await res.text();
  // Should contain the error in SSE format
  assert.ok(body.includes('data: '), 'SSE body should contain data: lines');
  assert.ok(body.includes('MODEL_DOWN'), 'SSE body should contain error code');
  // Should NOT end with [DONE] after error
  assert.ok(!body.includes('[DONE]'), 'SSE stream should not have [DONE] after error');
});

// ---------------------------------------------------------------------------
// Anthropic route mount (Task 10 / Task 13)
// ---------------------------------------------------------------------------

test('POST /v1/messages route is mounted and reachable with a valid body', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  assert.notEqual(res.status, 404);
});

test('POST /v1/messages route is mounted and returns non-404 for empty body', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '',
  });

  assert.notEqual(res.status, 404);
});

// ---------------------------------------------------------------------------
// Dev UI route (ENABLE_DEV_UI)
// ---------------------------------------------------------------------------

test('GET / returns 404 when enableDevUi is not set', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort);

  const res = await app.request('/');

  assert.equal(res.status, 404);
});

test('GET / returns 404 when enableDevUi is explicitly false', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort, { enableDevUi: false });

  const res = await app.request('/');

  assert.equal(res.status, 404);
});

test('GET / returns 200 with HTML when enableDevUi is true', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort, { enableDevUi: true });

  const res = await app.request('/');

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(contentType.includes('text/html'), `expected text/html, got ${contentType}`);
  const body = await res.text();
  assert.ok(body.includes('Fusion Chat'), 'HTML body should contain the page title');
});

test('GET / serves the dev UI even when cwd is not the project root', async () => {
  const fusionService = stubFusionService();
  const configPort = stubConfigPort();
  const app = createServer(fusionService, configPort, { enableDevUi: true });

  const originalCwd = process.cwd();
  process.chdir(tmpdir());
  try {
    const res = await app.request('/');

    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('Fusion Chat'), 'HTML body should contain the page title');
  } finally {
    process.chdir(originalCwd);
  }
});
