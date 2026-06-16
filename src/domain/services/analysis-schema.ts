import { z } from 'zod';

/**
 * JSON Schema representation of Analysis — used by adapters that accept a
 * structured-output schema (e.g. OpenAI json_schema mode, Anthropic output_config).
 * Must stay in sync with `analysisSchema` below; the drift-guard test in
 * analysis-schema.test.ts asserts that the required keys match.
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
        },
        required: ['severity', 'candidate', 'description'],
        additionalProperties: false,
      },
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
    },
    recommendation: { type: 'string' },
  },
  required: ['agreements', 'discrepancies', 'issues', 'gaps', 'recommendation'],
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
    }),
  ),
  /** Important aspects the user's question required that no candidate covered. */
  gaps: z.array(z.string()),
  /** Concise guidance for the synthesizer: what to keep, combine, fix, and fill. */
  recommendation: z.string(),
});

/** Inferred type from the analysis schema. */
export type Analysis = z.infer<typeof analysisSchema>;
