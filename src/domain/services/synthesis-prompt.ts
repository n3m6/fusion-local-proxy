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

Begin by inferring the task type from the conversation context and adapt your output accordingly:
- CODING/TECHNICAL: Produce one clean, correct, copy-pasteable solution. Keep prose minimal. Avoid "Model N said..." attribution. Prioritize correctness over blending.
- FACTUAL: Clear, accurate, well-structured, honest about genuine uncertainty.
- OPEN-ENDED: Balanced, thorough, organized — honest about gaps.

Follow these instructions:

1. AUTHORITY — You are the final authority, not just a blender. Use the candidates as starting material. Correct errors identified in the analysis. Resolve discrepancies toward the most correct answer. Fill gaps the candidates missed. Add detail from your own expertise when it genuinely helps.

2. AGREEMENT INTEGRATION — Where candidates agree and the analysis confirms correctness, present that answer confidently without hedging.

3. DISCREPANCY RESOLUTION — Where candidates differ, resolve toward the more correct position identified in the analysis. If genuinely unclear, present both perspectives fairly.

4. ISSUE CORRECTION — Fix errors and issues flagged in the analysis, including bugs, security risks, and inaccuracies. Do not reproduce flaws even if both candidates share them.

5. GAP FILLING — Address gaps the candidates missed. You may draw on your own knowledge to fill them.

6. ATTRIBUTION — Avoid "Model 1 said..." attribution in the final response. Write as a single coherent voice.

7. TONE — Match format and depth to the task: concise code blocks for coding; clear prose for factual/open-ended. Be helpful and direct, not wordy.`;
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
        parts.push(`[${issue.severity.toUpperCase()}] ${issue.candidate}: ${issue.description}`);
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
      'Using the panel analysis and candidate responses above, produce the final synthesized response. Correct any identified issues, fill the gaps, resolve discrepancies appropriately, and follow the recommendation. Address the original conversation comprehensively.',
    );
  } else {
    parts.push(
      'Using the panel responses above, produce the final synthesized response for the end user. Address the original conversation comprehensively.',
    );
  }

  return parts.join('\n');
}
