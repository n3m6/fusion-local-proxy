import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSchema } from './analysis-schema.js';

// ---------------------------------------------------------------------------
// analysisSchema — valid input
// ---------------------------------------------------------------------------

test('analysisSchema — valid input with all five fields', () => {
  const input = {
    agreements: ['Both models agree Paris is the capital of France'],
    discrepancies: [
      {
        topic: 'Best time to visit Paris',
        positions: ['Spring is best', 'Fall is best'],
        assessment: 'unclear — both seasons have merits',
      },
    ],
    issues: [{ severity: 'low', candidate: 'model-a', description: 'Minor stylistic issue' }],
    gaps: ['None of the models mentioned the Paris sewer system'],
    recommendation: 'Use the consensus answer and add sewer system info.',
  };

  const result = analysisSchema.safeParse(input);
  assert.ok(result.success);
  if (result.success) {
    assert.equal(result.data.agreements.length, 1);
    assert.equal(result.data.discrepancies.length, 1);
    assert.equal(result.data.issues.length, 1);
    assert.equal(result.data.gaps.length, 1);
    assert.equal(typeof result.data.recommendation, 'string');
  }
});

// ---------------------------------------------------------------------------
// analysisSchema — missing required field
// ---------------------------------------------------------------------------

test('analysisSchema — missing required field (agreements absent)', () => {
  const input = {
    discrepancies: [],
    issues: [],
    gaps: [],
    recommendation: 'n/a',
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
  if (!result.success) {
    const issuePaths = result.error.issues.map((i) => i.path.join('.')).join(' ');
    assert.ok(
      issuePaths.includes('agreements'),
      `Expected error about missing agreements, got: ${JSON.stringify(result.error.issues)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// analysisSchema — malformed field type
// ---------------------------------------------------------------------------

test('analysisSchema — malformed field type (discrepancies is a string)', () => {
  const input = {
    agreements: ['Some point'],
    discrepancies: 'not an array',
    issues: [],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// analysisSchema — empty valid input
// ---------------------------------------------------------------------------

test('analysisSchema — empty valid input (arrays empty, recommendation empty string)', () => {
  const input = {
    agreements: [],
    discrepancies: [],
    issues: [],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.ok(result.success);
  if (result.success) {
    assert.deepEqual(result.data.agreements, []);
    assert.deepEqual(result.data.discrepancies, []);
    assert.deepEqual(result.data.issues, []);
    assert.deepEqual(result.data.gaps, []);
    assert.equal(result.data.recommendation, '');
  }
});

// ---------------------------------------------------------------------------
// analysisSchema — extra fields stripped
// ---------------------------------------------------------------------------

test('analysisSchema — extra top-level fields are stripped from parsed data', () => {
  const input = {
    agreements: ['Point A'],
    discrepancies: [],
    issues: [],
    gaps: [],
    recommendation: 'Go with A.',
    extra: 123,
  };

  const result = analysisSchema.safeParse(input);
  assert.ok(result.success);
  if (result.success) {
    assert.equal('extra' in result.data, false);
  }
});

test('analysisSchema — unknown nested fields are stripped from discrepancy entries', () => {
  const input = {
    agreements: [],
    discrepancies: [
      { topic: 'A vs B', positions: ['A is better'], assessment: 'A wins', extra: true },
    ],
    issues: [],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.ok(result.success);
  if (result.success) {
    assert.equal('extra' in result.data.discrepancies[0], false);
    assert.equal(result.data.discrepancies[0].topic, 'A vs B');
    assert.equal(result.data.discrepancies[0].assessment, 'A wins');
  }
});

// ---------------------------------------------------------------------------
// analysisSchema — issues severity enum
// ---------------------------------------------------------------------------

test('analysisSchema — issues severity must be high, medium, or low', () => {
  const valid = {
    agreements: [],
    discrepancies: [],
    issues: [{ severity: 'high', candidate: 'model-a', description: 'Critical bug' }],
    gaps: [],
    recommendation: '',
  };
  assert.ok(analysisSchema.safeParse(valid).success);

  const invalidSeverity = {
    agreements: [],
    discrepancies: [],
    issues: [{ severity: 'critical', candidate: 'model-a', description: 'Bug' }],
    gaps: [],
    recommendation: '',
  };
  assert.equal(analysisSchema.safeParse(invalidSeverity).success, false);
});

// ---------------------------------------------------------------------------
// analysisSchema — malformed sub-fields
// ---------------------------------------------------------------------------

test('analysisSchema — discrepancy topic as number fails', () => {
  const input = {
    agreements: [],
    discrepancies: [{ topic: 42, positions: ['x'], assessment: 'ok' }],
    issues: [],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — discrepancy missing positions fails', () => {
  const input = {
    agreements: [],
    discrepancies: [{ topic: 'A vs B', assessment: 'ok' }],
    issues: [],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — discrepancy missing assessment fails', () => {
  const input = {
    agreements: [],
    discrepancies: [{ topic: 'A vs B', positions: ['a', 'b'] }],
    issues: [],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — issue missing candidate fails', () => {
  const input = {
    agreements: [],
    discrepancies: [],
    issues: [{ severity: 'high', description: 'Bug' }],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — issue missing description fails', () => {
  const input = {
    agreements: [],
    discrepancies: [],
    issues: [{ severity: 'medium', candidate: 'model-a' }],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — agreements array of numbers fails', () => {
  const input = {
    agreements: [1, 2, 3],
    discrepancies: [],
    issues: [],
    gaps: [],
    recommendation: '',
  };

  const result = analysisSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('analysisSchema — missing recommendation fails', () => {
  const input = {
    agreements: [],
    discrepancies: [],
    issues: [],
    gaps: [],
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
