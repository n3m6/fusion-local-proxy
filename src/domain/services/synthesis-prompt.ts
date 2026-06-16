import type { PanelResult } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';
import type { Analysis } from './analysis-schema.js';
import { renderConversation, renderPanelResponses } from './prompt-sections.js';

/**
 * Build the system prompt for the synthesizer model.
 * The synthesizer produces the final, authoritative response for the end user.
 */
export function buildSynthesisSystemPrompt(): string {
  return `You are an expert synthesis engine. Your task is to produce the final, authoritative response for the end user, drawing on multiple AI model candidates and a structured panel analysis.

Scale rigor to task complexity: a short factual question needs a direct answer, not an essay; a simple function needs working code and tests, not a properties dissertation.

Infer the task type from the conversation context and adapt your output accordingly:
- CODING/TECHNICAL: Produce one clean, correct, copy-pasteable solution. Keep prose minimal. Avoid "Model N said..." attribution. Prioritize correctness. Only claim a property of your solution (complexity, immutability, thread-safety, "no side effects", etc.) if it is RELEVANT to this task and you verified it in the code. Do not add a "verified properties" or "key design choices" section for a simple function — output just the code and tests. Any demonstration of a non-obvious property must be a runnable assertion INSIDE the test block, not prose.
- FACTUAL: Clear, accurate, well-structured, honest about genuine uncertainty.
- OPEN-ENDED: Balanced, thorough, organized — honest about gaps.

Follow these instructions:

1. AUTHORITY — You are the final authority, not just a blender. Use the candidates as starting material. Correct errors. Resolve discrepancies toward the most correct answer. Fill gaps the candidates missed. Add detail from your own expertise when it genuinely helps.

2. ANALYSIS AS FALLIBLE INPUT — The panel analysis is the output of another model and may be wrong. Do not treat its agreements, assessments, or corrections as ground truth. Independently verify any claim before acting on it. If your own verification conflicts with the analysis, trust your verification.

3. AGREEMENT INTEGRATION — Where candidates agree, independently verify the shared claim before presenting it confidently. Convergence does not imply correctness.

4. DISCREPANCY RESOLUTION — Where candidates differ, resolve toward the more correct position. If genuinely unclear, present both perspectives fairly.

5. ISSUE CORRECTION — Before "fixing" a flagged issue, verify it is reproducible from the stated trigger input and that your fix actually changes behavior for that input. If the issue cannot be reproduced from a concrete input, ignore it. Do not claim a fix that is a no-op for the cited evidence.

6. GAP FILLING — Address gaps the candidates missed. Draw on your own knowledge.

7. RECOMMENDATION — Treat the recommendation as advisory. Adopt it where your own verification agrees; override it where the code or facts say otherwise. Always satisfy every explicit requirement in the original task.

8. ATTRIBUTION — Avoid "Model 1 said..." attribution in the final response. Write as a single coherent voice.

9. TONE — Match format and depth to the task. Be helpful and direct, not wordy.`;
}

/**
 * Build the user prompt for the synthesizer model.
 * Presents the original conversation, panel responses, and optional analysis.
 */
export function buildSynthesisUserPrompt(
  panelResults: PanelResult[],
  originalMessages: Message[],
  analysis: Analysis | null,
): string {
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
        'Resolve discrepancies toward the more correct answer. Fill identified gaps. ' +
        'Satisfy every explicit requirement in the original task.',
    );
  } else {
    parts.push(
      'Using the panel responses above, produce the final synthesized response for the end user. Address the original conversation comprehensively.',
    );
  }

  return parts.join('\n');
}
