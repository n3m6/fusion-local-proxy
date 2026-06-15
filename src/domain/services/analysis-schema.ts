import { z } from 'zod';

/**
 * Structured analysis produced by the judge model after comparing
 * all panel model responses.
 */
export const analysisSchema = z.object({
  /** Points of agreement found across panel model responses. */
  consensus: z.array(z.string()),
  /** Topics where panel models gave conflicting answers. */
  contradictions: z.array(
    z.object({
      topic: z.string(),
      perspectives: z.array(z.string()),
    }),
  ),
  /** Noteworthy observations made by a single model. */
  unique_insights: z.array(
    z.object({
      model: z.string(),
      insight: z.string(),
    }),
  ),
  /** Important topics/angles that no panel model addressed. */
  blind_spots: z.array(z.string()),
});

/** Inferred type from the analysis schema. */
export type Analysis = z.infer<typeof analysisSchema>;
