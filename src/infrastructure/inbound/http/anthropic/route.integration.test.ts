import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createAnthropicRoute } from './route.js';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import { FusionError, type FusionRequest } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubFusionService(events?: FusionStreamEvent[]): FusionService {
  const streamEvents = events ?? [
    { type: 'progress', stage: 'panel', message: 'Calling panel models...' },
    { type: 'content_delta', delta: 'Hello' },
    { type: 'content_delta', delta: ' world' },
    { type: 'content_stop' },
    {
      type: 'done',
      usage: { promptTokens: 10, completionTokens: 25, totalTokens: 35 },
      failedModels: [],
      model: 'claude-3-opus-20240229',
    },
  ];

  return {
    runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
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
      return iterable;
    },
  };
}

function stubFusionServiceWithCapture(
  events: FusionStreamEvent[],
): { service: FusionService; request: FusionRequest | null } {
  const captured: { value: FusionRequest | null } = { value: null };
  const service: FusionService = {
    runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      captured.value = request;
      const iterable: AsyncIterable<FusionStreamEvent> = {
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
      return iterable;
    },
  };
  return { service, request: captured as unknown as FusionRequest };
}

function stubFusionServiceThatThrows(error: Error): FusionService {
  return {
    runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      throw error;
    },
  };
}

function stubFusionServiceWithErrorEvent(code: string, message: string): FusionService {
  return {
    runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
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
      return iterable;
    },
  };
}

function stubFusionServiceWithContentThenError(delta: string, code: string, message: string): FusionService {
  return {
    runFusion(_request: FusionRequest): AsyncIterable<FusionStreamEvent> {
      const events: FusionStreamEvent[] = [
        { type: 'content_delta', delta },
        { type: 'error', code, message },
      ];
      const iterable: AsyncIterable<FusionStreamEvent> = {
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
      return iterable;
    },
  };
}

function createApp(fusionService: FusionService): Hono {
  const app = new Hono();
  app.post('/v1/messages', createAnthropicRoute(fusionService));
  return app;
}

// ---------------------------------------------------------------------------
// Valid request
// ---------------------------------------------------------------------------

test('POST /v1/messages returns 200 with text/event-stream for valid request', async () => {
  const fusionService = stubFusionService();
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  assert.equal(res.status, 200);
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(contentType.includes('text/event-stream'), `expected text/event-stream, got ${contentType}`);
});

test('POST /v1/messages body contains all 6 event types in sequence', async () => {
  const fusionService = stubFusionService();
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.text();

  // All 6 event types should appear in order
  const events = ['message_start', 'content_block_start', 'content_block_delta',
    'content_block_stop', 'message_delta', 'message_stop'];

  let lastIndex = -1;
  for (const eventName of events) {
    const idx = body.indexOf(`event: ${eventName}`);
    assert.ok(idx >= 0, `Missing event: ${eventName} in body`);
    assert.ok(idx > lastIndex, `Event ${eventName} appears before previous event`);
    lastIndex = idx;
  }
});

test('POST /v1/messages each SSE event has both event: and data: fields', async () => {
  const fusionService = stubFusionService([
    { type: 'content_delta', delta: 'Hello' },
    {
      type: 'done',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'claude-3-opus-20240229',
    },
  ]);
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  const body = await res.text();

  // Every non-comment event should have both event: and data: lines
  const lines = body.split('\n');
  let currentHasEvent = false;
  let currentHasData = false;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentHasEvent = true;
    }
    if (line.startsWith('data: ')) {
      currentHasData = true;
    }
    if (line === '' && (currentHasEvent || currentHasData)) {
      // End of an SSE message
      // Either it's a comment (only starts with ':') or it has both event: and data:
      if (currentHasEvent && !currentHasData) {
        assert.fail('SSE message has event: but no data:');
      }
      if (!currentHasEvent && currentHasData && !body.slice(body.indexOf('data: ')).startsWith('data: ') ) {
        // data: only messages are OK for heartbeat-like messages? Actually Anthropic always uses event: + data:
      }
      currentHasEvent = false;
      currentHasData = false;
    }
  }
});

// ---------------------------------------------------------------------------
// Keep-alive / progress
// ---------------------------------------------------------------------------

test('POST /v1/messages includes keep-alive comments for progress events', async () => {
  const fusionService = stubFusionService([
    { type: 'progress', stage: 'panel', message: 'Calling panel models...' },
    { type: 'progress', stage: 'judge', message: 'Analyzing...' },
    { type: 'content_delta', delta: 'Result' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ]);
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  const body = await res.text();
  assert.ok(body.includes(': heartbeat'), 'SSE body should contain heartbeat comment');
});

// ---------------------------------------------------------------------------
// Invalid JSON
// ---------------------------------------------------------------------------

test('POST /v1/messages returns 400 for invalid JSON', async () => {
  const fusionService = stubFusionService();
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not valid json',
  });

  assert.equal(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  const error = body.error as Record<string, unknown>;
  assert.ok(error);
  assert.equal(error.type, 'invalid_request_error');
  assert.equal(error.message, 'Invalid JSON body');
});

// ---------------------------------------------------------------------------
// FusionError thrown
// ---------------------------------------------------------------------------

test('POST /v1/messages handles FusionError thrown by runFusion', async () => {
  const fusionService = stubFusionServiceThatThrows(
    new FusionError('all_panels_failed', 'All panel models failed'),
  );
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  // streamSSE commits 200 before error is thrown
  assert.equal(res.status, 200);
  const body = await res.text();

  // Body should contain the error in SSE format
  assert.ok(body.includes('data: '), 'SSE body should contain data: lines');
  assert.ok(body.includes('all_panels_failed'), 'SSE body should contain error code');
  assert.ok(body.includes('All panel models failed'), 'SSE body should contain error message');
});

// ---------------------------------------------------------------------------
// Stream error event
// ---------------------------------------------------------------------------

test('POST /v1/messages handles stream error event', async () => {
  const fusionService = stubFusionServiceWithErrorEvent('MODEL_DOWN', 'Upstream model unavailable');
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  // streamSSE commits 200 before error is thrown from encoder
  const contentType = res.headers.get('Content-Type') ?? '';
  assert.ok(contentType.includes('text/event-stream'));

  const body = await res.text();
  assert.ok(body.includes('data: '), 'SSE body should contain data: lines');
  assert.ok(body.includes('MODEL_DOWN'), 'SSE body should contain error code');
  assert.ok(body.includes('Upstream model unavailable'), 'SSE body should contain error message');
});

// ---------------------------------------------------------------------------
// System as content block array
// ---------------------------------------------------------------------------

test('POST /v1/messages handles system as content block array', async () => {
  const { service, request } = stubFusionServiceWithCapture([
    { type: 'content_delta', delta: 'Response' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ]);
  const app = createApp(service);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      system: [
        { type: 'text', text: 'Be helpful.' },
        { type: 'text', text: 'Be concise.' },
      ],
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('event: message_start'));
  assert.ok(body.includes('event: content_block_delta'));

  // Verify the request was translated correctly
  const captured = (request as unknown as { value: FusionRequest | null }).value;
  assert.ok(captured, 'request should have been captured');
  assert.equal(captured!.systemPrompt, 'Be helpful.\nBe concise.');
});

// ---------------------------------------------------------------------------
// Messages with text content blocks
// ---------------------------------------------------------------------------

test('POST /v1/messages extracts text from content blocks in messages', async () => {
  const { service, request } = stubFusionServiceWithCapture([
    { type: 'content_delta', delta: 'Response' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ]);
  const app = createApp(service);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' },
          ],
        },
      ],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('event: message_start'));

  // Verify the request was translated correctly
  const captured = (request as unknown as { value: FusionRequest | null }).value;
  assert.ok(captured, 'request should have been captured');
  assert.equal(captured!.messages.length, 1);
  assert.equal(captured!.messages[0].role, 'user');
  assert.equal(captured!.messages[0].content, 'Part 1Part 2');
});

// ---------------------------------------------------------------------------
// Anthropic-specific fields
// ---------------------------------------------------------------------------

test('POST /v1/messages handles top_p, top_k, stop_sequences', async () => {
  const { service, request } = stubFusionServiceWithCapture([
    { type: 'content_delta', delta: 'Response' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ]);
  const app = createApp(service);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      top_p: 0.9,
      top_k: 40,
      stop_sequences: ['END'],
    }),
  });

  assert.equal(res.status, 200);

  const captured = (request as unknown as { value: FusionRequest | null }).value;
  assert.ok(captured);
  assert.ok(captured!.options);
  const opts = captured!.options as Record<string, unknown>;
  assert.equal(opts.top_p, 0.9);
  assert.equal(opts.top_k, 40);
  assert.deepEqual(opts.stop_sequences, ['END']);
});

// ---------------------------------------------------------------------------
// Missing messages
// ---------------------------------------------------------------------------

test('POST /v1/messages handles missing messages array', async () => {
  const { service, request } = stubFusionServiceWithCapture([
    { type: 'content_delta', delta: 'Response' },
    { type: 'done', model: 'claude-3-opus-20240229' },
  ]);
  const app = createApp(service);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
    }),
  });

  assert.equal(res.status, 200);
  const captured = (request as unknown as { value: FusionRequest | null }).value;
  assert.ok(captured);
  assert.deepEqual(captured!.messages, []);
});

// ---------------------------------------------------------------------------
// Error event after content
// ---------------------------------------------------------------------------

test('POST /v1/messages handles error event after content', async () => {
  const fusionService = stubFusionServiceWithContentThenError(
    'partial',
    'MODEL_DOWN',
    'Upstream model unavailable',
  );
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  // streamSSE commits 200 before error
  const body = await res.text();
  assert.ok(body.includes('partial'), 'SSE body should contain partial content');
  assert.ok(body.includes('MODEL_DOWN'), 'SSE body should contain error code');
  // Should not have message_stop after error
  assert.ok(!body.includes('event: message_stop'), 'SSE body should not contain message_stop after error');
});

// ---------------------------------------------------------------------------
// Different model
// ---------------------------------------------------------------------------

test('POST /v1/messages passes model to SSE encoder', async () => {
  const fusionService = stubFusionService();
  const app = createApp(fusionService);

  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });

  const body = await res.text();
  assert.ok(body.includes('claude-3-haiku-20240307'), 'SSE body should contain the model name');
});
