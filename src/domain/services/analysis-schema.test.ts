import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSchema } from './analysis-schema.js';

// ---------------------------------------------------------------------------
// analysisSchema — valid input
// ---------------------------------------------------------------------------

test('analysisSchema — valid input with all four fields', () => {
  const input = {
    consensus: ['Models agree that Paris is the capital of France'],
    contradictions: [
      {
        topic: 'Best time to visit Paris',
        perspectives: ['Spring is best', 'Fall is best'],
      },
    ],
    unique_insights: [{ model: 'gpt-4', insight: 'Paris has over 400 parks' }],
    blind_spots: ['None of the models mentioned the Paris sewer system'],
  };

  const result = analysisSchema.safeParse(input);
  assert.ok(result.success);
  if (result.success) {
    assert.equal(result.data.consensus.length, 1);
    assert.equal(result.data.contradictions.length, 1);
    assert.equal(result.data.unique_insights.length, 1);
    assert.equal(result.data.blind_spots.length, 1);
  }
});

// ---------------------------------------------------------------------------
// analysisSchema — missing required field
// ---------------------------------------------------------------------------

test('analysisSchema — missing required field (consensus absent)', () => {
  const input = {
    contradictions: [],
    unique_insights: [],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
  if (!result.success) {
    const issueMessages = result.error.issues.map((i) => i.message ?? '').join(' ');
    const issuePaths = result.error.issues.map((i) => i.path.join('.')).join(' ');
    const relevant = issueMessages + ' ' + issuePaths;
    assert.ok(
      relevant.toLowerCase().includes('consensus'),
      `Expected error about missing consensus, got: ${JSON.stringify(result.error.issues)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// analysisSchema — malformed field type
// ---------------------------------------------------------------------------

test('analysisSchema — malformed field type (contradictions is a string)', () => {
  const input = {
    consensus: ['Some point'],
    contradictions: 'not an array',
    unique_insights: [],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// analysisSchema — empty valid input
// ---------------------------------------------------------------------------

test('analysisSchema — empty valid input (all fields empty arrays)', () => {
  const input = {
    consensus: [],
    contradictions: [],
    unique_insights: [],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.ok(result.success);
  if (result.success) {
    assert.deepEqual(result.data.consensus, []);
    assert.deepEqual(result.data.contradictions, []);
    assert.deepEqual(result.data.unique_insights, []);
    assert.deepEqual(result.data.blind_spots, []);
  }
});

// ---------------------------------------------------------------------------
// analysisSchema — extra fields stripped
// ---------------------------------------------------------------------------

test('analysisSchema — extra top-level fields are stripped from parsed data', () => {
  const input = {
    consensus: ['Point A'],
    contradictions: [],
    unique_insights: [],
    blind_spots: [],
    extra: 123,
  };

  const result = analysisSchema.safeParse(input);
  assert.ok(result.success);
  if (result.success) {
    assert.equal('extra' in result.data, false);
  }
});

test('analysisSchema — unknown nested fields are stripped from contradiction entries', () => {
  const input = {
    consensus: [],
    contradictions: [{ topic: 'A vs B', perspectives: ['A is better'], severity: 'high' }],
    unique_insights: [],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.ok(result.success);
  if (result.success) {
    assert.equal('severity' in result.data.contradictions[0], false);
    assert.equal(result.data.contradictions[0].topic, 'A vs B');
  }
});

// ---------------------------------------------------------------------------
// analysisSchema — malformed sub-fields
// ---------------------------------------------------------------------------

test('analysisSchema — contradiction topic as number fails', () => {
  const input = {
    consensus: [],
    contradictions: [{ topic: 42, perspectives: ['x'] }],
    unique_insights: [],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — contradiction missing perspectives fails', () => {
  const input = {
    consensus: [],
    contradictions: [{ topic: 'A vs B' }],
    unique_insights: [],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — unique_insights entry missing model fails', () => {
  const input = {
    consensus: [],
    contradictions: [],
    unique_insights: [{ insight: 'Only one model said this' }],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — unique_insights entry missing insight fails', () => {
  const input = {
    consensus: [],
    contradictions: [],
    unique_insights: [{ model: 'gpt-4o' }],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — consensus array of numbers fails', () => {
  const input = {
    consensus: [1, 2, 3],
    contradictions: [],
    unique_insights: [],
    blind_spots: [],
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Domain purity — no imports from application or infrastructure
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const analysisSchemaSource = readFileSync(
  fileURLToPath(import.meta.url).replace(/\.test\.ts$/, '.ts'),
  'utf-8',
);

test('analysis-schema.ts has zero imports from src/application/', () => {
  const matches = analysisSchemaSource.match(/from\s+['"].*application.*['"]/g);
  assert.equal(matches, null, `Found application imports: ${matches}`);
});

test('analysis-schema.ts has zero imports from src/infrastructure/', () => {
  const matches = analysisSchemaSource.match(/from\s+['"].*infrastructure.*['"]/g);
  assert.equal(matches, null, `Found infrastructure imports: ${matches}`);
});
