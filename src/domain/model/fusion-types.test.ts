import test from 'node:test';
import assert from 'node:assert/strict';
import { FusionError } from './fusion-types.js';
import type { PanelResult, PanelMeta, ProviderType } from './fusion-types.js';
import type { FailedModelInfo } from './stream-types.js';

test('FusionError constructs with code, message, and optional details', () => {
  const err = new FusionError('TIMEOUT', 'Request timed out', { server: 'api.openai.com' });

  assert.ok(err instanceof Error);
  assert.ok(err instanceof FusionError);
  assert.equal(err.name, 'FusionError');
  assert.equal(err.code, 'TIMEOUT');
  assert.equal(err.message, 'Request timed out');
  assert.deepEqual(err.details, { server: 'api.openai.com' });
});

test('FusionError works without details', () => {
  const err = new FusionError('UNKNOWN', 'Something went wrong');

  assert.equal(err.code, 'UNKNOWN');
  assert.equal(err.message, 'Something went wrong');
  assert.equal(err.details, undefined);
});

// ---------------------------------------------------------------------------
// FusionError — all_panels_failed code (added by Task 03)
// ---------------------------------------------------------------------------

test('FusionError accepts the all_panels_failed code', () => {
  const err = new FusionError('all_panels_failed', 'Every panel model failed');

  assert.ok(err instanceof Error);
  assert.ok(err instanceof FusionError);
  assert.equal(err.code, 'all_panels_failed');
  assert.equal(err.name, 'FusionError');
  assert.equal(err.message, 'Every panel model failed');
});

test('FusionError preserves all_panels_failed code with details', () => {
  const failedModels = [
    { modelId: 'gpt-4o', errorCode: 'TIMEOUT', errorMessage: 'timed out' },
  ];
  const err = new FusionError('all_panels_failed', 'Every panel model failed', { failedModels });

  assert.equal(err.code, 'all_panels_failed');
  assert.deepEqual(err.details, { failedModels });
});

// ---------------------------------------------------------------------------
// PanelResult shape (added by Task 03)
// ---------------------------------------------------------------------------

test('PanelResult has all five required fields with correct types', () => {
  const result: PanelResult = {
    modelId: 'test-model',
    provider: 'openai',
    content: 'result',
    usage: { promptTokens: 10, completionTokens: 5 },
    latencyMs: 100,
  };

  assert.equal(typeof result.modelId, 'string');
  const provider: ProviderType = result.provider;
  assert.ok(provider === 'openai' || provider === 'anthropic');
  assert.equal(typeof result.content, 'string');
  assert.equal(typeof result.usage.promptTokens, 'number');
  assert.equal(typeof result.usage.completionTokens, 'number');
  assert.equal(typeof result.latencyMs, 'number');

  assert.equal(result.modelId, 'test-model');
  assert.equal(result.provider, 'openai');
  assert.equal(result.usage.promptTokens, 10);
  assert.equal(result.usage.completionTokens, 5);
  assert.equal(result.latencyMs, 100);
});

test('PanelResult provider accepts anthropic ProviderType', () => {
  const result: PanelResult = {
    modelId: 'claude-3',
    provider: 'anthropic',
    content: 'answer',
    usage: { promptTokens: 1, completionTokens: 1 },
    latencyMs: 42,
  };

  assert.equal(result.provider, 'anthropic');
});

// ---------------------------------------------------------------------------
// PanelMeta shape (added by Task 03)
// ---------------------------------------------------------------------------

test('PanelMeta holds results and failedModels arrays with conforming shapes', () => {
  const failed: FailedModelInfo = {
    modelId: 'down-model',
    errorCode: 'MODEL_DOWN',
    errorMessage: 'unavailable',
  };

  const meta: PanelMeta = {
    results: [
      {
        modelId: 'ok-model',
        provider: 'openai',
        content: 'ok',
        usage: { promptTokens: 3, completionTokens: 4 },
        latencyMs: 12,
      },
    ],
    failedModels: [failed],
  };

  assert.ok(Array.isArray(meta.results));
  assert.ok(Array.isArray(meta.failedModels));
  assert.equal(meta.results.length, 1);
  assert.equal(meta.results[0].modelId, 'ok-model');

  assert.equal(meta.failedModels.length, 1);
  assert.equal(typeof meta.failedModels[0].modelId, 'string');
  assert.equal(typeof meta.failedModels[0].errorCode, 'string');
  assert.equal(typeof meta.failedModels[0].errorMessage, 'string');
});

test('PanelMeta supports empty results and failedModels arrays', () => {
  const meta: PanelMeta = { results: [], failedModels: [] };
  assert.deepEqual(meta.results, []);
  assert.deepEqual(meta.failedModels, []);
});
