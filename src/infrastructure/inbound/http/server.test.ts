import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createServer } from './server.js';
import type { FusionService } from '../../../application/ports/fusion-service.js';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import type { FusionRequest } from '../../../domain/model/fusion-types.js';
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
    { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
  ];
  return {
    getPanelModels: () => models,
    getJudgeModel: () => null,
    getSynthesizerModel: () => null,
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

  const body = await res.json() as Record<string, unknown>;
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

  const body = await res.json() as Record<string, unknown>;
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
  const body = await res.json() as Record<string, unknown>;
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
  const body = await res.json() as Record<string, unknown>;
  const error = body.error as Record<string, unknown>;
  assert.ok(error);
  assert.equal(error.message, 'Upstream failure');
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
  const body = await res.json() as Record<string, unknown>;
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
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.object, 'chat.completion');
});
