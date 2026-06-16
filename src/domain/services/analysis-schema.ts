import { z } from 'zod';

/**
 * JSON Schema representation of Analysis — used by adapters that accept a
 * structured-output schema (e.g. OpenAI json_schema mode, Anthropic output_config).
 * Must stay in sync with `analysisSchema` below; the drift-guard test in
 * analysis-schema.test.ts asserts that the property names and required-field sets match.
 *
 * The five original fields are required. The five new structured-signal fields
 * (taskType, requirementCoverage, testResults, preferredCandidate, corrections)
 * and the nested issue fields (trigger, evidence) are listed in their respective
 * `required` arrays so strict json_schema providers enforce them, but they are
 * Zod-optional so that json_object providers which omit them do not cause the
 * whole analysis to be dropped to null. Note: OpenAI strict mode requires every
 * property under `additionalProperties: false` to appear in `required`.
 */
export const ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    agreements: {
      type: 'array',
      items: { type: 'string' },
    },
    discrepancies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          positions: {
            type: 'array',
            items: { type: 'string' },
          },
          assessment: { type: 'string' },
        },
        required: ['topic', 'positions', 'assessment'],
        additionalProperties: false,
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          candidate: { type: 'string' },
          description: { type: 'string' },
          trigger: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['severity', 'candidate', 'description', 'trigger', 'evidence'],
        additionalProperties: false,
      },
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
    },
    recommendation: { type: 'string' },
    taskType: {
      type: 'string',
      enum: ['coding', 'factual', 'open_ended'],
    },
    requirementCoverage: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string' },
          assessment: { type: 'string' },
        },
        required: ['requirement', 'assessment'],
        additionalProperties: false,
      },
    },
    testResults: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidate: { type: 'string' },
          test: { type: 'string' },
          verdict: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
          detail: { type: 'string' },
        },
        required: ['candidate', 'test', 'verdict', 'detail'],
        additionalProperties: false,
      },
    },
    preferredCandidate: { type: 'string' },
    corrections: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'agreements',
    'discrepancies',
    'issues',
    'gaps',
    'recommendation',
    'taskType',
    'requirementCoverage',
    'testResults',
    'preferredCandidate',
    'corrections',
  ],
  additionalProperties: false,
};

/**
 * Structured analysis produced by the judge model after comparing
 * all panel model responses.
 */
export const analysisSchema = z.object({
  /** Points where candidates converged and are correct — high-confidence shared ground. */
  agreements: z.array(z.string()),
  /** Topics where candidates gave different or conflicting answers, with the judge's assessment. */
  discrepancies: z.array(
    z.object({
      topic: z.string(),
      positions: z.array(z.string()),
      assessment: z.string(),
    }),
  ),
  /** Concrete errors, bugs, security risks, or inaccuracies in any candidate response. */
  issues: z.array(
    z.object({
      severity: z.enum(['high', 'medium', 'low']),
      candidate: z.string(),
      description: z.string(),
      /** The exact input and requirement/example the issue violates. */
      trigger: z.string().optional(),
      /** Actual output vs expected output demonstrating the issue. */
      evidence: z.string().optional(),
    }),
  ),
  /** Important aspects the user's question required that no candidate covered. */
  gaps: z.array(z.string()),
  /** Advisory guidance for the synthesizer: what to keep, combine, fix, and fill. */
  recommendation: z.string(),
  /** Inferred task type used to select the evaluation lens. */
  taskType: z.enum(['coding', 'factual', 'open_ended']).optional(),
  /** Per-requirement verdict for each candidate — drives faithfulness checking. */
  requirementCoverage: z
    .array(
      z.object({
        requirement: z.string(),
        assessment: z.string(),
      }),
    )
    .optional(),
  /** Per-test trace for coding tasks — forces the judge to execute candidate tests. */
  testResults: z
    .array(
      z.object({
        candidate: z.string(),
        test: z.string(),
        verdict: z.enum(['pass', 'fail', 'unknown']),
        detail: z.string(),
      }),
    )
    .optional(),
  /** Which candidate's approach to favor, or "none" if a fresh synthesis is better. */
  preferredCandidate: z.string().optional(),
  /** Concrete fixes the synthesizer must apply (one actionable sentence each). */
  corrections: z.array(z.string()).optional(),
});

/** Inferred type from the analysis schema. */
export type Analysis = z.infer<typeof analysisSchema>;
