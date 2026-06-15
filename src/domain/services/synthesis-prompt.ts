import type { PanelResult } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';
import type { Analysis } from './analysis-schema.js';

/**
 * Build the system prompt for the synthesizer model.
 * The synthesizer produces the final response for the end user.
 */
export function buildSynthesisSystemPrompt(): string {
  return `You are a synthesis engine. Your task is to produce the final, polished response for the end user by integrating multiple AI model responses to the same query.

Follow these instructions:

1. CONSENSUS INTEGRATION — Give more weight to points where multiple panel models agree. When several models converge on the same answer, present it with higher confidence.

2. CONTRADICTION HANDLING — When contradictions exist between panel models, acknowledge the disagreement and present the competing perspectives fairly. Do not pick one side arbitrarily — explain what each perspective offers.

3. UNIQUE INSIGHTS — Incorporate noteworthy observations from individual models, attributing them where appropriate (e.g., "One model noted that...").

4. BLIND SPOTS — Address blind spots if you can provide useful context, or acknowledge what remains unknown. Be honest about gaps.

5. GROUNDING — Ground every factual claim in the panel responses or the provided analysis. Do not introduce facts, data, or claims not present in the provided materials. If you are uncertain, say so.

6. TONE — Write in a helpful, conversational tone appropriate for the end user. Be clear, concise, and well-structured.`;
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

  if (analysis !== null) {
    parts.push('=== PANEL ANALYSIS ===');
    parts.push('');
    parts.push('-- Consensus Points --');
    if (analysis.consensus.length > 0) {
      for (const point of analysis.consensus) {
        parts.push(`- ${point}`);
      }
    } else {
      parts.push('(No consensus points identified)');
    }
    parts.push('');
    parts.push('-- Contradictions --');
    if (analysis.contradictions.length > 0) {
      for (const c of analysis.contradictions) {
        parts.push(`Topic: ${c.topic}`);
        for (const p of c.perspectives) {
          parts.push(`  - ${p}`);
        }
      }
    } else {
      parts.push('(No contradictions identified)');
    }
    parts.push('');
    parts.push('-- Unique Insights --');
    if (analysis.unique_insights.length > 0) {
      for (const ui of analysis.unique_insights) {
        parts.push(`[${ui.model}]: ${ui.insight}`);
      }
    } else {
      parts.push('(No unique insights identified)');
    }
    parts.push('');
    parts.push('-- Blind Spots --');
    if (analysis.blind_spots.length > 0) {
      for (const bs of analysis.blind_spots) {
        parts.push(`- ${bs}`);
      }
    } else {
      parts.push('(No blind spots identified)');
    }
  } else {
    parts.push('=== NOTE ===');
    parts.push('Panel-level analysis is unavailable. Work directly from the raw panel responses above.');
  }

  parts.push('');
  parts.push('=== INSTRUCTIONS ===');
  parts.push('Using the above materials, produce the final synthesized response for the end user.');
  parts.push('Integrate the panel responses, the analysis (if available), and address the original question comprehensively.');

  return parts.join('\n');
}
