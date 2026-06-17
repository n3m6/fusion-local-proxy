import type { PanelResult } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';
import type { Analysis } from './analysis-schema.js';
import { renderConversation, renderPanelResponses } from './prompt-sections.js';

export interface SynthesisPromptOptions {
  readonly selfJudge?: boolean;
}

/**
 * Build the system prompt for the synthesizer model.
 * The synthesizer produces the final, authoritative response for the end user.
 *
 * When selfJudge is true (no judge provider configured), a SELF-EVALUATION FIRST
 * section is appended instructing the model to perform the judge's analysis
 * internally before writing the final answer.
 */
export function buildSynthesisSystemPrompt(options?: SynthesisPromptOptions): string {
  const selfJudge = options?.selfJudge === true;

  const instruction2 = selfJudge
    ? 'SELF-ANALYSIS AS FALLIBLE — Your own internal evaluation of the panel candidates may be incomplete or wrong. Independently verify any claim before accepting it; do not rely on candidate convergence as a signal of correctness.'
    : 'ANALYSIS AS FALLIBLE INPUT — The panel analysis is the output of another model and may be wrong. Do not treat its agreements, assessments, or corrections as ground truth. Independently verify any claim before acting on it. If your own verification conflicts with the analysis, trust your verification.';

  const instruction7 = selfJudge
    ? 'SELF-CORRECTIONS — Your own identified issues and improvements are hypotheses, not ground truth. Verify each against a concrete input and confirm the fix does not regress any explicit requirement before applying it.'
    : 'RECOMMENDATION — Treat the recommendation as advisory. Adopt it where your own verification agrees; override it where the code or facts say otherwise. Always satisfy every explicit requirement in the original task. A correction suggested in the recommendation that changes behavior must pass the same regression check as a flagged issue: do not apply it if it breaks any explicit requirement, even if the judge endorsed it.';

  const base = `You are an expert synthesis engine. Your task is to produce the final, authoritative response for the end user, drawing on multiple AI model candidates${selfJudge ? '' : ' and a structured panel analysis'}.

Scale rigor to task complexity: a short factual question needs a direct answer, not an essay; a simple function needs working code and tests, not a properties dissertation.

Infer the task type from the conversation context and adapt your output accordingly:
- CODING/TECHNICAL: Produce one clean, correct, copy-pasteable solution. Keep prose minimal. Avoid "Model N said..." attribution. Prioritize correctness. Only claim a property of your solution (complexity, immutability, thread-safety, "no side effects", etc.) if it is RELEVANT to this task and you verified it in the code. Do not add a "verified properties" or "key design choices" section for a simple function — output just the code and tests. Any demonstration of a non-obvious property must be a runnable assertion INSIDE the test block, not prose. When tests are required, choose cases that together exercise all explicitly required behaviors and units — prefer range-spanning cases over near-duplicates (e.g., if TB is a required unit, include a TB test rather than two KB tests).
- FACTUAL: Clear, accurate, well-structured, honest about genuine uncertainty.
- OPEN-ENDED: Balanced, thorough, organized — honest about gaps.

Follow these instructions:

1. AUTHORITY — You are the final authority, not just a blender. Use the candidates as starting material. Correct errors. Resolve discrepancies toward the most correct answer. Fill gaps the candidates missed. Add detail from your own expertise when it genuinely helps.

2. ${instruction2}

3. AGREEMENT INTEGRATION — Where candidates agree, independently verify the shared claim before presenting it confidently. Convergence does not imply correctness.

4. DISCREPANCY RESOLUTION — Where candidates differ, resolve toward the more correct position. If genuinely unclear, present both perspectives fairly.

5. ISSUE CORRECTION — Before "fixing" a flagged issue, verify it is reproducible from the stated trigger input and that your fix actually changes behavior for that input. If the issue cannot be reproduced from a concrete input, ignore it. Do not claim a fix that is a no-op for the cited evidence. Additionally, before applying any behavior-changing correction, trace it on at least one boundary input to confirm it does not regress another explicit requirement (e.g., truncating float input to int must not defeat a "round to N decimal places" requirement).

6. GAP FILLING — Address gaps the candidates missed. Draw on your own knowledge.

7. ${instruction7}

8. ATTRIBUTION — Avoid "Model 1 said..." attribution in the final response. Write as a single coherent voice.

9. TONE — Match format and depth to the task. Be helpful and direct, not wordy.

10. EXAMPLE PRECEDENCE — When the task includes an explicit worked example of the output format (e.g., "1024 → '1.00 KB'"), conform to it exactly. Let the example override conflicting prose wording, panel recommendations, or judge corrections. The worked example is the highest-fidelity specification the user provided.

11. ANTI-SYCOPHANCY — Do not adopt a claim, answer, or correction merely because multiple candidates (or the judge) endorse it, or because it is the majority position. The number of candidates that agree is not evidence. Change a candidate's position only when you can name a concrete ground — a specific fact, mechanism, explicit requirement, or worked example — that supports the change, or when you find a factual error in its reasoning. When you resolve a discrepancy or present an agreement, your decision must rest on that ground, not on a vote count.`;

  if (!selfJudge) {
    return base;
  }

  const selfEval = `

SELF-EVALUATION FIRST — No separate judge analysis is provided. Before writing your response, evaluate the panel candidates internally. Do NOT output this evaluation as JSON, a preamble, or any structured block — use it only to produce one authoritative answer in a single coherent voice.

Apply this evaluation lens (scale effort to task complexity — spend it only where it changes your answer):

A. CLASSIFY THE TASK. Infer "coding", "factual", or "open_ended" from the conversation and apply the matching rigor:
   - CODING: trace code against every explicit requirement and any worked example; verify every self-described guarantee (complexity, immutability, "no side effects") directly in the code. If a candidate claims a property but the code falsifies it, that is a high-severity issue.
   - FACTUAL: verify accuracy independently; do not rely on candidate convergence.
   - OPEN-ENDED: assess coverage, depth, and balance.

B. VERIFY CONVERGENCE. Where candidates agree, independently verify the shared claim before accepting it. Convergence does not imply correctness — candidates trained on similar data share the same blind spots.

C. IDENTIFY DISCREPANCIES. Where candidates differ, determine which position is more correct and resolve toward it. If genuinely ambiguous, present both perspectives fairly.

D. FIND ISSUES. Identify concrete errors only: an issue requires an exact input that surfaces it and the explicit requirement or example it violates. Do not invent requirements the task never stated. Honor example precedence: when the task provides a worked example of the output, that example governs over prose wording. Severity: high = wrong output on a valid/required input or a false self-described guarantee; medium = clearly-implied edge case; low = style or naming nit with no functional impact.

E. FIND GAPS. Aspects required by the task (explicitly or clearly implied) that no candidate covered. For coding tasks, cross-check whether required behaviors, edge cases, and output units have executable test coverage; a required behavior exercised by no test is a gap.

F. PRODUCE THE ANSWER. Fix confirmed issues, resolve discrepancies toward the correct position, fill gaps, and satisfy every explicit requirement. Apply example precedence over conflicting prose or panel guidance.`;

  return base + selfEval;
}

/**
 * Build the user prompt for the synthesizer model.
 * Presents the original conversation, panel responses, and optional analysis.
 *
 * When selfJudge is true (no judge provider configured), the analysis-absent
 * branch emits a self-judging directive instead of the minimal fallback note.
 */
export function buildSynthesisUserPrompt(
  panelResults: PanelResult[],
  originalMessages: Message[],
  analysis: Analysis | null,
  options?: SynthesisPromptOptions,
): string {
  const selfJudge = options?.selfJudge === true;
  const parts: string[] = [
    ...renderConversation(originalMessages),
    '',
    ...renderPanelResponses(panelResults),
  ];

  if (analysis !== null) {
    parts.push('=== PANEL ANALYSIS ===');
    parts.push('');

    if (analysis.taskType !== undefined) {
      parts.push(`-- Task Type --`);
      parts.push(analysis.taskType);
      parts.push('');
    }

    if (analysis.preferredCandidate !== undefined) {
      parts.push('-- Preferred Candidate --');
      parts.push(analysis.preferredCandidate);
      parts.push('');
    }

    parts.push('-- Corrections --');
    if (analysis.corrections !== undefined && analysis.corrections.length > 0) {
      for (const correction of analysis.corrections) {
        parts.push(`- ${correction}`);
      }
    } else {
      parts.push('(No corrections required)');
    }
    parts.push('');

    parts.push('-- Agreements --');
    if (analysis.agreements.length > 0) {
      for (const point of analysis.agreements) {
        parts.push(`- ${point}`);
      }
    } else {
      parts.push('(No agreements identified)');
    }
    parts.push('');

    parts.push('-- Discrepancies --');
    if (analysis.discrepancies.length > 0) {
      for (const d of analysis.discrepancies) {
        parts.push(`Topic: ${d.topic}`);
        for (const p of d.positions) {
          parts.push(`  - ${p}`);
        }
        parts.push(`  Assessment: ${d.assessment}`);
      }
    } else {
      parts.push('(No discrepancies identified)');
    }
    parts.push('');

    parts.push('-- Issues --');
    if (analysis.issues.length > 0) {
      for (const issue of analysis.issues) {
        const triggerPart = issue.trigger !== undefined ? ` | trigger: ${issue.trigger}` : '';
        const evidencePart = issue.evidence !== undefined ? ` | evidence: ${issue.evidence}` : '';
        parts.push(
          `[${issue.severity.toUpperCase()}] ${issue.candidate}: ${issue.description}${triggerPart}${evidencePart}`,
        );
      }
    } else {
      parts.push('(No issues identified)');
    }
    parts.push('');

    parts.push('-- Gaps --');
    if (analysis.gaps.length > 0) {
      for (const gap of analysis.gaps) {
        parts.push(`- ${gap}`);
      }
    } else {
      parts.push('(No gaps identified)');
    }
    parts.push('');

    parts.push('-- Requirement Coverage --');
    if (analysis.requirementCoverage !== undefined && analysis.requirementCoverage.length > 0) {
      for (const rc of analysis.requirementCoverage) {
        parts.push(`Requirement: ${rc.requirement}`);
        parts.push(`  Assessment: ${rc.assessment}`);
      }
    } else {
      parts.push('(No requirement coverage provided)');
    }
    parts.push('');

    parts.push('-- Test Results --');
    if (analysis.testResults !== undefined && analysis.testResults.length > 0) {
      for (const tr of analysis.testResults) {
        parts.push(`[${tr.verdict.toUpperCase()}] ${tr.candidate}: ${tr.test} — ${tr.detail}`);
      }
    } else {
      parts.push('(No test results provided)');
    }
    parts.push('');

    parts.push('-- Recommendation --');
    parts.push(
      analysis.recommendation.length > 0 ? analysis.recommendation : '(No recommendation provided)',
    );
  } else if (selfJudge) {
    parts.push('=== SELF-EVALUATION DIRECTIVE ===');
    parts.push(
      'No separate judge analysis was produced. Evaluate the panel candidates yourself before synthesizing: ' +
        'verify convergent claims independently, identify concrete issues (with a triggering input), resolve discrepancies, and find gaps. ' +
        'Do not output the evaluation — use it only to inform your final answer.',
    );
  } else {
    parts.push('=== NOTE ===');
    parts.push(
      'Panel-level analysis is unavailable. Work directly from the raw panel responses above.',
    );
  }

  parts.push('');
  parts.push('=== INSTRUCTIONS ===');
  if (analysis !== null) {
    parts.push(
      'Using the panel analysis and candidate responses above, produce the final synthesized response. ' +
        'Treat the recommendation and corrections as advisory — verify each flagged issue is reproducible from its stated trigger before fixing it, and ignore issues that cannot be reproduced from a concrete input. ' +
        'Before applying any behavior-changing correction, confirm it does not regress another explicit requirement. ' +
        'Resolve discrepancies toward the more correct answer. Fill identified gaps. ' +
        'Satisfy every explicit requirement in the original task.',
    );
  } else if (selfJudge) {
    parts.push(
      'Evaluate the panel candidates yourself (per the SELF-EVALUATION DIRECTIVE above), then produce the final synthesized response for the end user. ' +
        'Fix confirmed issues, resolve discrepancies toward the correct answer, fill gaps, and satisfy every explicit requirement in the original task.',
    );
  } else {
    parts.push(
      'Using the panel responses above, produce the final synthesized response for the end user. Address the original conversation comprehensively.',
    );
  }

  return parts.join('\n');
}
