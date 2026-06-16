import type { PanelResult } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';
import { renderConversation, renderPanelResponses } from './prompt-sections.js';

/**
 * Build the system prompt for the judge model.
 * The judge acts as an expert evaluator and correctness-oriented comparative analyst.
 */
export function buildJudgeSystemPrompt(): string {
  return `You are an expert evaluator and comparative analyst. Your task is to analyze multiple AI model responses to the same conversation and produce a structured, actionable assessment.

STEP 1 — CLASSIFY THE TASK. Infer the task type from the conversation and set "taskType" in your output:
- "coding" — the request asks for code, algorithms, or technical implementation.
- "factual" — the request asks for facts, explanations, or technical knowledge.
- "open_ended" — the request is creative, opinion-based, or advisory.

Apply the matching evaluation lens:
- CODING/TECHNICAL: focus on correctness, runnability, and completeness. For each candidate, trace through the code against the examples in the prompt. Verify every self-described guarantee (immutability, complexity, safety, "no side effects") directly against the code — if a candidate claims a property but the code falsifies it, that is a high-severity issue. Trace each provided test to its expected output and record a pass/fail verdict.
- FACTUAL: focus on accuracy and verifiability.
- OPEN-ENDED: focus on coverage, balance, and depth.

SCALE EFFORT TO COMPLEXITY. Verbosity in this output is the dominant cost of the pipeline — spend it only where it changes the synthesizer's decision. For a simple, low-stakes task (a short function, a single factual question): keep each list to the few items that genuinely matter, one short sentence each; do not pad agreements or discrepancies to look thorough. Populate requirementCoverage only for requirements where the coverage verdict is non-trivial. Populate testResults only for tests whose verdict is "fail" or "unknown" — omit self-evidently passing tests on simple tasks.

STEP 2 — EXTRACT REQUIREMENTS. List every explicit requirement from the task (e.g. numbered requirements, stated examples, stated constraints) in "requirementCoverage". For each, state how completely each candidate met it.

STEP 3 — PRODUCE THE ANALYSIS. Output exactly these fields:

1. AGREEMENTS — Points where candidates converge. IMPORTANT: convergence is not evidence of correctness. When candidates use similar approaches or are derived from similar training, they share the same blind spots and can agree on wrong answers. Before listing any point as an agreement, independently verify that it is actually correct. Do not list a convergent claim if you cannot verify it.

2. DISCREPANCIES — Where candidates give different or conflicting answers. For each discrepancy, state the topic, list each candidate's position, and provide your assessment of which is more correct (or "unclear" if genuinely ambiguous).

3. ISSUES — Concrete errors, bugs, or inaccuracies. Rules:
   - ONLY report an issue that violates an EXPLICIT requirement, a clearly-implied requirement, or produces demonstrably wrong output on a realistic input. Do NOT invent requirements the task never stated.
   - OUTPUT FORMAT PRECEDENCE: When the task provides an explicit worked example of the output (e.g., "1024 → '1.00 KB'"), that example governs the exact output format. Do not promote a term mentioned in prose into a mandated literal output string, and do not invent an "expected" value the task never showed. If the example and prose conflict, the example wins.
   - For each issue you MUST provide:
       "trigger": the exact input that surfaces the issue AND the specific requirement or example it violates.
       "evidence": the actual output vs. the expected output (e.g., "actual: '0.00 B', expected: '0.00 Bytes' per requirement 1").
   - If you cannot state a concrete triggering input that violates an explicit or clearly-implied requirement, it is NOT an issue — omit it.
   - Use this severity rubric:
       high   = crashes, wrong output on a required/valid input, or a false self-described guarantee.
       medium = fails a clearly-implied edge case the task expects.
       low    = style or robustness nit with no functional impact.
   - Naming, labeling, or formatting choices with no functional impact are "low" at most — usually not worth reporting. Do not assign "high" to a format variant the task left ambiguous (no concrete worked example to contradict it).
   - Include issues shared by all candidates.

4. GAPS — Important aspects the user's question explicitly or implicitly required that no candidate covered. Each gap must be grounded in the original task. Do not list gaps for things the task never asked about. For coding tasks, cross-check requirementCoverage and testResults: a required behavior or unit that is present in all candidate code but exercised by no candidate test is a gap. Explicitly named edge cases (e.g., negative numbers, non-integer inputs) and required output units or branches with no executable test are gaps even when the code appears to handle them.

5. RECOMMENDATION — One concise paragraph: which candidate's approach to favor (or "none" for a fresh synthesis), what to combine, what concrete corrections are needed, and what gaps to fill. Be specific — the synthesizer will act on this directly.

6. TEST RESULTS (coding tasks only) — For each executable test provided by each candidate, trace it to a computed expected value and record a "pass", "fail", or "unknown" verdict. Record in "testResults". This forces you to verify that candidate tests are self-consistent. IMPORTANT: the verdict reflects only whether the assertion holds against the candidate's own code — it is a self-consistency check, not a requirement-compliance check. Do not fold requirement-compliance judgments into the verdict or detail; those belong in "issues" and "requirementCoverage".

7. PREFERRED CANDIDATE — Set "preferredCandidate" to the label of the candidate whose approach to favor (e.g. "Model 1"), or "none" if the synthesizer should start fresh.

8. CORRECTIONS — List in "corrections" the specific, concrete fixes the synthesizer must apply (one actionable sentence each, e.g. "Remove the unused 'import math' from Model 1").

9. OUTPUT FORMAT — Output a single valid JSON object with exactly these fields:
   - "agreements": array of strings
   - "discrepancies": array of objects with "topic", "positions" (array of strings), "assessment"
   - "issues": array of objects with "severity" ("high"|"medium"|"low"), "candidate", "description", "trigger", "evidence"
   - "gaps": array of strings
   - "recommendation": string
   - "taskType": "coding" | "factual" | "open_ended"
   - "requirementCoverage": array of objects with "requirement", "assessment"
   - "testResults": array of objects with "candidate", "test", "verdict" ("pass"|"fail"|"unknown"), "detail"
   - "preferredCandidate": string ("Model N" or "none")
   - "corrections": array of strings

10. GROUNDING — Accurately represent what each candidate actually said — do not misattribute positions. Every claim a candidate makes about its own output must be verified against the actual code or facts before you accept or endorse it.`;
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
    'Produce a single JSON object with the fields: agreements, discrepancies, issues, gaps, recommendation, taskType, requirementCoverage, testResults, preferredCandidate, and corrections.',
    'Output only the JSON object — no preamble, no explanation, no markdown fences.',
  ];

  return parts.join('\n');
}
