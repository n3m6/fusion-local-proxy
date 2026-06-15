import type { PanelResult } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';

/**
 * Build the system prompt for the judge model.
 * The judge acts as an impartial comparative analyst.
 */
export function buildJudgeSystemPrompt(): string {
  return `You are an impartial comparative analyst. Your task is to analyze multiple AI model responses to the same user query and produce a structured comparison.

Follow these instructions:

1. CONSENSUS — Identify points where multiple panel models agree. These are statements or conclusions that at least two models converged on independently. List each as a string.

2. CONTRADICTIONS — Detect topics where panel models gave conflicting answers. For each contradiction, identify the specific topic and list the conflicting perspectives from different models.

3. UNIQUE INSIGHTS — Highlight noteworthy observations that only a single model contributed — insights no other model raised. For each, note which model made the insight and what the insight is.

4. BLIND SPOTS — Identify important topics or angles that the user's question implicitly required but that no panel model addressed at all.

5. OUTPUT FORMAT — You must output a single valid JSON object with exactly these four fields:
   - "consensus": an array of strings
   - "contradictions": an array of objects, each with "topic" (string) and "perspectives" (array of strings)
   - "unique_insights": an array of objects, each with "model" (string) and "insight" (string)
   - "blind_spots": an array of strings

6. GROUNDING — Do not invent facts or claims beyond what the panel responses actually contain. Your analysis must be strictly grounded in the provided materials.`;
}

/**
 * Build the user prompt for the judge model.
 * Presents the original conversation and panel model responses for analysis.
 */
export function buildJudgeUserPrompt(
  panelResults: PanelResult[],
  originalMessages: Message[],
): string {
  const parts: string[] = [];

  parts.push('=== ORIGINAL CONVERSATION ===');
  for (const msg of originalMessages) {
    parts.push(`[${msg.role}]: ${msg.content}`);
  }

  parts.push('');
  parts.push('=== PANEL MODEL RESPONSES ===');
  for (let i = 0; i < panelResults.length; i++) {
    const result = panelResults[i];
    parts.push(`--- Model ${i + 1}: ${result.modelId} ---`);
    parts.push(result.content);
    parts.push('');
  }

  parts.push('=== INSTRUCTIONS ===');
  parts.push('Analyze the above panel model responses against the original conversation.');
  parts.push(
    'Produce a single JSON object with the fields: consensus, contradictions, unique_insights, and blind_spots.',
  );
  parts.push('Output only the JSON object — no preamble, no explanation, no markdown fences.');

  return parts.join('\n');
}
