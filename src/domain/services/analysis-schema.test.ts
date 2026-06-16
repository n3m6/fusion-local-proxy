import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSchema, ANALYSIS_JSON_SCHEMA } from './analysis-schema.js';

// ---------------------------------------------------------------------------
// Drift guard: property names in both representations must be identical.
//
// New fields (taskType, requirementCoverage, testResults, preferredCandidate,
// corrections) are Zod-optional so that json_object providers which omit them
// do not drop the entire analysis. They ARE listed in ANALYSIS_JSON_SCHEMA.required
// for strict json_schema providers.
//
// Invariants we enforce:
//   1. Every property key in ANALYSIS_JSON_SCHEMA.properties appears in analysisSchema.
//   2. Every property key in analysisSchema appears in ANALYSIS_JSON_SCHEMA.properties.
//   3. ANALYSIS_JSON_SCHEMA.required ⊇ the set of Zod-required (non-optional) keys.
// ---------------------------------------------------------------------------

const REQUIRED_ZOD_KEYS = ['agreements', 'discrepancies', 'issues', 'gaps', 'recommendation'];

test('ANALYSIS_JSON_SCHEMA property names match analysisSchema zod shape keys', () => {
  const zodKeys = Object.keys(analysisSchema.shape).sort();
  const jsonPropertyKeys = Object.keys(
    (ANALYSIS_JSON_SCHEMA as { properties: Record<string, unknown> }).properties,
  ).sort();

  assert.deepStrictEqual(
    jsonPropertyKeys,
    zodKeys,
    'ANALYSIS_JSON_SCHEMA.properties keys and analysisSchema.shape keys must be identical',
  );
});

test('ANALYSIS_JSON_SCHEMA.required is a superset of the Zod-required (non-optional) keys', () => {
  const jsonRequired: string[] = (
    (ANALYSIS_JSON_SCHEMA as { required?: string[] }).required ?? []
  ).slice();

  for (const key of REQUIRED_ZOD_KEYS) {
    assert.ok(
      jsonRequired.includes(key),
      `ANALYSIS_JSON_SCHEMA.required must include Zod-required key "${key}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// OpenAI strict-mode invariant: every object node that sets
// `additionalProperties: false` must list ALL of its property keys in
// `required`, otherwise the OpenAI json_schema (strict: true) API rejects the
// schema and the judge silently falls back to analysis: null. This recurses
// into nested objects (e.g. issues items) so the guard cannot be bypassed by
// adding a property deep in the tree.
// ---------------------------------------------------------------------------

function assertStrictRequiredCoverage(node: unknown, path: string): void {
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  if (
    obj.type === 'object' &&
    obj.additionalProperties === false &&
    obj.properties !== undefined &&
    typeof obj.properties === 'object'
  ) {
    const propertyKeys = Object.keys(obj.properties as Record<string, unknown>).sort();
    const required = ((obj.required as string[] | undefined) ?? []).slice().sort();
    assert.deepStrictEqual(
      required,
      propertyKeys,
      `Strict-mode violation at "${path}": every property must appear in "required" when additionalProperties is false`,
    );
  }

  for (const [key, value] of Object.entries(obj)) {
    assertStrictRequiredCoverage(value, `${path}.${key}`);
  }
}

test('ANALYSIS_JSON_SCHEMA satisfies OpenAI strict-mode required coverage (recursively)', () => {
  assertStrictRequiredCoverage(ANALYSIS_JSON_SCHEMA, 'ANALYSIS_JSON_SCHEMA');
});

// ---------------------------------------------------------------------------
// Parse cases — optional fields may be absent without breaking validation
// ---------------------------------------------------------------------------

const minimalValidObject = {
  agreements: ['Both approaches are correct'],
  discrepancies: [
    {
      topic: 'Naming',
      positions: ['Model 1 uses camelCase', 'Model 2 uses snake_case'],
      assessment: 'Both acceptable; no clear winner',
    },
  ],
  issues: [
    {
      severity: 'low' as const,
      candidate: 'Model 1',
      description: 'Missing docstring',
    },
  ],
  gaps: ['No discussion of performance'],
  recommendation: 'Prefer Model 1 overall.',
};

test('analysisSchema parses a minimal object (no new optional fields)', () => {
  const result = analysisSchema.safeParse(minimalValidObject);
  assert.ok(result.success, `Expected parse to succeed: ${JSON.stringify(result)}`);
  if (result.success) {
    assert.equal(result.data.taskType, undefined);
    assert.equal(result.data.requirementCoverage, undefined);
    assert.equal(result.data.testResults, undefined);
    assert.equal(result.data.preferredCandidate, undefined);
    assert.equal(result.data.corrections, undefined);
  }
});

test('analysisSchema parses a full object with all new optional fields present', () => {
  const full = {
    ...minimalValidObject,
    taskType: 'coding' as const,
    requirementCoverage: [
      { requirement: 'Support Bytes, KB, MB, GB, TB', assessment: 'Met by all candidates' },
    ],
    testResults: [
      {
        candidate: 'Model 1',
        test: 'format_bytes(1024) == "1.00 KB"',
        verdict: 'pass' as const,
        detail: '1024 / 1024 = 1.0, formatted as "1.00 KB"',
      },
    ],
    preferredCandidate: 'Model 1',
    corrections: ['Remove unused import math from Model 1'],
  };

  const result = analysisSchema.safeParse(full);
  assert.ok(result.success, `Expected parse to succeed: ${JSON.stringify(result)}`);
  if (result.success) {
    assert.equal(result.data.taskType, 'coding');
    assert.equal(result.data.preferredCandidate, 'Model 1');
    assert.equal(result.data.corrections?.length, 1);
    assert.equal(result.data.requirementCoverage?.length, 1);
    assert.equal(result.data.testResults?.length, 1);
    assert.equal(result.data.testResults?.[0]?.verdict, 'pass');
  }
});

test('analysisSchema rejects an object missing a required field', () => {
  const { agreements: _dropped, ...withoutAgreements } = minimalValidObject;
  const result = analysisSchema.safeParse(withoutAgreements);
  assert.ok(!result.success, 'Must fail when a required field is absent');
});

test('analysisSchema rejects an invalid taskType value', () => {
  const result = analysisSchema.safeParse({ ...minimalValidObject, taskType: 'unknown_type' });
  assert.ok(!result.success, 'Must fail for invalid taskType enum value');
});

test('analysisSchema rejects an issue with an invalid severity', () => {
  const result = analysisSchema.safeParse({
    ...minimalValidObject,
    issues: [{ severity: 'critical', candidate: 'Model 1', description: 'bad' }],
  });
  assert.ok(!result.success, 'Must fail for invalid severity value');
});

test('analysisSchema accepts an issue with optional trigger and evidence fields', () => {
  const withTriggerEvidence = {
    ...minimalValidObject,
    issues: [
      {
        severity: 'high' as const,
        candidate: 'Model 2',
        description: 'format_bytes(0) returns wrong unit',
        trigger: 'format_bytes(0)',
        evidence: 'actual: "0.00 B", expected: "0.00 Bytes"',
      },
    ],
  };
  const result = analysisSchema.safeParse(withTriggerEvidence);
  assert.ok(result.success, `Expected parse to succeed: ${JSON.stringify(result)}`);
});
