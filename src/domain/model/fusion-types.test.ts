import test from 'node:test';
import assert from 'node:assert/strict';
import { FusionError } from './fusion-types.js';

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
