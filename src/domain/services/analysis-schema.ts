import { z } from 'zod';

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
