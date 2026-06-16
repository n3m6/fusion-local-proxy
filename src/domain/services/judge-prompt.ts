import type { PanelResult } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';
import { renderConversation, renderPanelResponses } from './prompt-sections.js';

/**
 * Build the system prompt for the judge model.
 * The judge acts as an expert evaluator and correctness-oriented comparative analyst.
 */
export function buildJudgeSystemPrompt(): string {
  return `You are an expert evaluator and comparative analyst. Your task is to analyze multiple AI model responses to the same conversation and produce a structured, actionable assessment.

Begin by inferring the task type from the conversation context and apply the appropriate evaluation lens:
- CODING/TECHNICAL: focus on correctness, runnability, completeness, edge cases, security, and idiomatic style.
- FACTUAL: focus on accuracy and verifiability.
- OPEN-ENDED: focus on coverage, balance, and depth.

Produce the following analysis:

1. AGREEMENTS — Points where candidates converge and are correct. List each as a string. Include only substantive agreements, not trivial ones.

2. DISCREPANCIES — Where candidates give different or conflicting answers. For each discrepancy, state the topic, list each candidate's position, and provide your assessment of which is more correct (or "unclear" if genuinely ambiguous).

3. ISSUES — Concrete errors, bugs, security risks, missing error handling, or inaccuracies in any candidate response. Include issues shared by all candidates. Use your own expertise — do not limit yourself to flaws the candidates acknowledged. For each issue state its severity (high/medium/low), which candidate it applies to (or "all"), and a description.

4. GAPS — Important aspects the user's question implicitly required that no candidate covered. List each as a string.

5. RECOMMENDATION — One concise paragraph: which candidate approach to favor, what to combine from multiple candidates, what to correct, and what gaps to fill.

6. OUTPUT FORMAT — Output a single valid JSON object with exactly these five fields:
   - "agreements": an array of strings
   - "discrepancies": an array of objects, each with "topic" (string), "positions" (array of strings), and "assessment" (string)
   - "issues": an array of objects, each with "severity" ("high" | "medium" | "low"), "candidate" (string), and "description" (string)
   - "gaps": an array of strings
   - "recommendation": a string

7. GROUNDING — You may use your own expertise to identify issues and gaps even when candidates missed them. Accurately represent what each candidate actually said — do not misattribute positions.`;
}

/**
 * Build the user prompt for the judge model.
 * Presents the original conversation and panel model responses for analysis.
 */
export function buildJudgeUserPrompt(
  panelResults: PanelResult[],
  originalMessages: Message[],
): string {
  const parts: string[] = [
    ...renderConversation(originalMessages),
    '',
    ...renderPanelResponses(panelResults),
    '=== INSTRUCTIONS ===',
    'Analyze the above panel model responses against the original conversation.',
    'Produce a single JSON object with the fields: agreements, discrepancies, issues, gaps, and recommendation.',
    'Output only the JSON object — no preamble, no explanation, no markdown fences.',
  ];

  return parts.join('\n');
}
