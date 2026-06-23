import type { Message } from '../model/message.js';
import type { PanelResult } from '../model/fusion-types.js';
import type { Analysis } from './analysis-schema.js';

export function renderConversation(messages: Message[]): string[] {
  const lines: string[] = ['=== ORIGINAL CONVERSATION ==='];
  for (const msg of messages) {
    lines.push(`[${msg.role}]: ${msg.content}`);
  }
  return lines;
}

export function renderPanelResponses(panelResults: PanelResult[]): string[] {
  const lines: string[] = ['=== PANEL MODEL RESPONSES ==='];
  for (let i = 0; i < panelResults.length; i++) {
    const result = panelResults[i];
    lines.push(`--- Model ${i + 1}: ${result.modelId} ---`);
    lines.push(result.content);
    lines.push('');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Analysis section renderers — used by buildSynthesisUserPrompt
// ---------------------------------------------------------------------------

export function renderAnalysisSection(analysis: Analysis): string[] {
  return [
    '=== PANEL ANALYSIS ===',
    '',
    ...renderTaskType(analysis.taskType),
    ...renderPreferredCandidate(analysis.preferredCandidate),
    ...renderCorrections(analysis.corrections),
    ...renderAgreements(analysis.agreements),
    ...renderDiscrepancies(analysis.discrepancies),
    ...renderIssues(analysis.issues),
    ...renderGaps(analysis.gaps),
    ...renderRequirementCoverage(analysis.requirementCoverage),
    ...renderTestResults(analysis.testResults),
    ...renderRecommendation(analysis.recommendation),
  ];
}

function renderTaskType(taskType: string | undefined): string[] {
  if (taskType === undefined) return [];
  return [`-- Task Type --`, taskType, ''];
}

function renderPreferredCandidate(preferred: string | undefined): string[] {
  if (preferred === undefined) return [];
  return ['-- Preferred Candidate --', preferred, ''];
}

function renderCorrections(corrections: string[] | undefined): string[] {
  const lines: string[] = ['-- Corrections --'];
  if (corrections !== undefined && corrections.length > 0) {
    for (const correction of corrections) {
      lines.push(`- ${correction}`);
    }
  } else {
    lines.push('(No corrections required)');
  }
  lines.push('');
  return lines;
}

function renderAgreements(agreements: string[]): string[] {
  const lines: string[] = ['-- Agreements --'];
  if (agreements.length > 0) {
    for (const point of agreements) {
      lines.push(`- ${point}`);
    }
  } else {
    lines.push('(No agreements identified)');
  }
  lines.push('');
  return lines;
}

function renderDiscrepancies(
  discrepancies: { topic: string; positions: string[]; assessment: string }[],
): string[] {
  const lines: string[] = ['-- Discrepancies --'];
  if (discrepancies.length > 0) {
    for (const d of discrepancies) {
      lines.push(`Topic: ${d.topic}`);
      for (const p of d.positions) {
        lines.push(`  - ${p}`);
      }
      lines.push(`  Assessment: ${d.assessment}`);
    }
  } else {
    lines.push('(No discrepancies identified)');
  }
  lines.push('');
  return lines;
}

function renderIssues(
  issues: {
    severity: string;
    candidate: string;
    description: string;
    trigger?: string;
    evidence?: string;
  }[],
): string[] {
  const lines: string[] = ['-- Issues --'];
  if (issues.length > 0) {
    for (const issue of issues) {
      const triggerPart = issue.trigger !== undefined ? ` | trigger: ${issue.trigger}` : '';
      const evidencePart = issue.evidence !== undefined ? ` | evidence: ${issue.evidence}` : '';
      lines.push(
        `[${issue.severity.toUpperCase()}] ${issue.candidate}: ${issue.description}${triggerPart}${evidencePart}`,
      );
    }
  } else {
    lines.push('(No issues identified)');
  }
  lines.push('');
  return lines;
}

function renderGaps(gaps: string[]): string[] {
  const lines: string[] = ['-- Gaps --'];
  if (gaps.length > 0) {
    for (const gap of gaps) {
      lines.push(`- ${gap}`);
    }
  } else {
    lines.push('(No gaps identified)');
  }
  lines.push('');
  return lines;
}

function renderRequirementCoverage(
  coverage: { requirement: string; assessment: string }[] | undefined,
): string[] {
  const lines: string[] = ['-- Requirement Coverage --'];
  if (coverage !== undefined && coverage.length > 0) {
    for (const rc of coverage) {
      lines.push(`Requirement: ${rc.requirement}`);
      lines.push(`  Assessment: ${rc.assessment}`);
    }
  } else {
    lines.push('(No requirement coverage provided)');
  }
  lines.push('');
  return lines;
}

function renderTestResults(
  testResults: { candidate: string; test: string; verdict: string; detail: string }[] | undefined,
): string[] {
  const lines: string[] = ['-- Test Results --'];
  if (testResults !== undefined && testResults.length > 0) {
    for (const tr of testResults) {
      lines.push(`[${tr.verdict.toUpperCase()}] ${tr.candidate}: ${tr.test} — ${tr.detail}`);
    }
  } else {
    lines.push('(No test results provided)');
  }
  lines.push('');
  return lines;
}

function renderRecommendation(recommendation: string): string[] {
  return [
    '-- Recommendation --',
    recommendation.length > 0 ? recommendation : '(No recommendation provided)',
  ];
}
