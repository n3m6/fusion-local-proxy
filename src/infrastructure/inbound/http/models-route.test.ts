import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createModelsRoute } from './models-route.js';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubConfigPort(
  panelModels: ModelRef[],
  judgeModel: ModelRef | null = null,
  synthesizerModel: ModelRef | null = null,
): ConfigPort {
  return {
    getPanelModels: () => panelModels,
    getJudgeModel: () => judgeModel,
    getSynthesizerModel: () => synthesizerModel,
    getTimeoutMs: () => 30000,
  };
}

function makeModelRef(model: string): ModelRef {
  return {
    provider: 'openai',
    model,
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('GET /v1/models returns panel model in data array', async () => {
  const config = stubConfigPort([makeModelRef('gpt-4o')]);
  const app = new Hono();
  app.get('/v1/models', createModelsRoute(config));

  const res = await app.request('/v1/models');
  assert.equal(res.status, 200);

  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.object, 'list');
  assert.ok(Array.isArray(body.data));

  const data = body.data as Array<Record<string, unknown>>;
  assert.equal(data.length, 1);
  assert.equal(data[0].id, 'gpt-4o');
  assert.equal(data[0].object, 'model');
});

test('GET /v1/models includes judge model when non-null', async () => {
  const config = stubConfigPort(
    [makeModelRef('gpt-4o')],
    makeModelRef('gpt-4o-mini'),
  );
  const app = new Hono();
  app.get('/v1/models', createModelsRoute(config));

  const res = await app.request('/v1/models');
  const body = await res.json() as Record<string, unknown>;
  const data = body.data as Array<Record<string, unknown>>;

  assert.equal(data.length, 2);
  const ids = data.map((d) => d.id);
  assert.ok(ids.includes('gpt-4o'));
  assert.ok(ids.includes('gpt-4o-mini'));
});

test('GET /v1/models includes synthesizer model when non-null', async () => {
  const config = stubConfigPort(
    [makeModelRef('gpt-4o')],
    null,
    makeModelRef('synthesizer-model'),
  );
  const app = new Hono();
  app.get('/v1/models', createModelsRoute(config));

  const res = await app.request('/v1/models');
  const body = await res.json() as Record<string, unknown>;
  const data = body.data as Array<Record<string, unknown>>;

  assert.equal(data.length, 2);
  assert.equal(data[1].id, 'synthesizer-model');
});

test('GET /v1/models returns only panel models when judge and synthesizer are null', async () => {
  const config = stubConfigPort([makeModelRef('gpt-4o')], null, null);
  const app = new Hono();
  app.get('/v1/models', createModelsRoute(config));

  const res = await app.request('/v1/models');
  const body = await res.json() as Record<string, unknown>;
  const data = body.data as Array<Record<string, unknown>>;

  assert.equal(data.length, 1);
});

test('GET /v1/models returns empty data when no models configured', async () => {
  const config = stubConfigPort([], null, null);
  const app = new Hono();
  app.get('/v1/models', createModelsRoute(config));

  const res = await app.request('/v1/models');
  const body = await res.json() as Record<string, unknown>;
  const data = body.data as Array<Record<string, unknown>>;

  assert.deepEqual(data, []);
  assert.equal(body.object, 'list');
});

test('GET /v1/models handles both judge and synthesizer simultaneously', async () => {
  const config = stubConfigPort(
    [makeModelRef('panel-model')],
    makeModelRef('judge-model'),
    makeModelRef('synth-model'),
  );
  const app = new Hono();
  app.get('/v1/models', createModelsRoute(config));

  const res = await app.request('/v1/models');
  const body = await res.json() as Record<string, unknown>;
  const data = body.data as Array<Record<string, unknown>>;

  assert.equal(data.length, 3);
  const ids = data.map((d) => d.id);
  assert.ok(ids.includes('panel-model'));
  assert.ok(ids.includes('judge-model'));
  assert.ok(ids.includes('synth-model'));
});
