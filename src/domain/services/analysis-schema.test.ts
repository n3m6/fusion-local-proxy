import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSchema, ANALYSIS_JSON_SCHEMA } from './analysis-schema.js';

// ---------------------------------------------------------------------------
// Drift guard: JSON Schema required keys must match the zod schema keys.
//
// Both representations of Analysis must declare the same top-level required
// fields. If a field is added to one but not the other, this test fails fast
// rather than letting a silent mismatch reach production.
// ---------------------------------------------------------------------------

test('ANALYSIS_JSON_SCHEMA required keys match analysisSchema zod keys', () => {
  const zodKeys = Object.keys(analysisSchema.shape).sort();

  const jsonSchemaRequired = ((ANALYSIS_JSON_SCHEMA as { required?: string[] }).required ?? [])
    .slice()
    .sort();

  assert.deepStrictEqual(
    jsonSchemaRequired,
    zodKeys,
    'ANALYSIS_JSON_SCHEMA.required and analysisSchema.shape keys must be identical',
  );
});
