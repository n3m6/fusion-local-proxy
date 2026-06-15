import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createOpenAiRoute } from './route.js';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import { FusionError, type FusionRequest } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';

// ---------------------------------------------------------------------------
// Helpers — hand-written FusionService stubs (no mocking library)
// ---------------------------------------------------------------------------

function asyncIterableOf(events: FusionStreamEvent[]): AsyncIterable<FusionStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < events.length) {
            return { value: events[i++]!, done: false };
          }
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

function stubFusionService(events?: FusionStreamEvent[]): FusionService {
  const streamEvents = events ?? [
    { type: 'content_delta', delta: 'Hello' },
    { type: 'content_delta', delta: ' world' },
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      failedModels: [],
      model: 'gpt-4o',
    },
  ];
  return {
    runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      return asyncIterableOf(streamEvents);
    },
  };
}

function stubFusionServiceThatThrows(error: Error): FusionService {
  return {
    async *runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      await Promise.resolve();
      throw error;
    },
  };
}

function createApp(fusionService: FusionService): Hono {
  const app = new Hono();
  app.post('/v1/chat/completions', createOpenAiRoute(fusionService));
  return app;
}

async function postJson(app: Hono, body: unknown): Promise<Response> {
  return app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Streaming path
// ---------------------------------------------------------------------------

test('POST /v1/chat/completions with stream:true returns text/event-stream', async () => {
  const app = createApp(stubFusionService());

  const res = await postJson(app, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hi' }],
    stream: true,
  });

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(
    contentType.includes('text/event-stream'),
    `expected text/event-stream, got ${contentType}`,
  );
});

test('POST /v1/chat/completions streaming body contains chunks and terminates with [DONE]', async () => {
  const app = createApp(stubFusionService());

  const res = await postJson(app, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hi' }],
    stream: true,
  });

  const body = await res.text();
  assert.ok(body.includes('data: '), 'must contain data: lines');
  assert.ok(body.includes('chat.completion.chunk'), 'must contain chat.completion.chunk objects');
  assert.ok(body.includes('data: [DONE]'), 'must terminate with data: [DONE]');
});

test('POST /v1/chat/completions streaming emits keep-alive comments for progress', async () => {
  const app = createApp(
    stubFusionService([
      { type: 'progress', stage: 'panel', message: 'Running panel models' },
      { type: 'content_delta', delta: 'Hi' },
      { type: 'done', model: 'gpt-4o' },
    ]),
  );

  const res = await postJson(app, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hi' }],
    stream: true,
  });

  const body = await res.text();
  const lines = body.split('\n');
  assert.ok(
    lines.some((l) => l.startsWith(': ')),
    'must contain at least one SSE comment line',
  );
});

test('POST /v1/chat/completions streaming surfaces FusionService errors in the stream', async () => {
  const app = createApp(
    stubFusionServiceThatThrows(new FusionError('all_panels_failed', 'All panel models failed')),
  );

  const res = await postJson(app, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hi' }],
    stream: true,
  });

  const body = await res.text();
  const surfaced = res.status !== 200 || body.includes('all_panels_failed');
  assert.ok(
    surfaced,
    `expected non-200 status or error in stream body, got status ${res.status} body ${body}`,
  );
  assert.ok(!body.includes('[DONE]'), 'must not emit [DONE] after an error');
});

// ---------------------------------------------------------------------------
// Non-streaming path
// ---------------------------------------------------------------------------

test('POST /v1/chat/completions without stream returns JSON chat.completion', async () => {
  const app = createApp(stubFusionService());

  const res = await postJson(app, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hi' }],
  });

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(
    contentType.includes('application/json'),
    `expected application/json, got ${contentType}`,
  );

  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.object, 'chat.completion');
  const choices = json.choices as Array<Record<string, unknown>>;
  const message = choices[0].message as Record<string, unknown>;
  assert.equal(message.content, 'Hello world');
});

test('POST /v1/chat/completions with stream:false returns JSON', async () => {
  const app = createApp(stubFusionService());

  const res = await postJson(app, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hi' }],
    stream: false,
  });

  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.object, 'chat.completion');
});

// ---------------------------------------------------------------------------
// Invalid JSON
// ---------------------------------------------------------------------------

test('POST /v1/chat/completions with invalid JSON returns 400', async () => {
  const app = createApp(stubFusionService());

  const res = await postJson(app, 'not valid json');

  assert.equal(res.status, 400);
  const json = (await res.json()) as Record<string, unknown>;
  const error = json.error as Record<string, unknown>;
  assert.ok(error, 'must contain an error object');
  assert.equal(error.message, 'Invalid JSON body');
});
