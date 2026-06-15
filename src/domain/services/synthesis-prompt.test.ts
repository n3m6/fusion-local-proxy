import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSynthesisSystemPrompt, buildSynthesisUserPrompt } from './synthesis-prompt.js';
import type { Analysis } from './analysis-schema.js';

// ---------------------------------------------------------------------------
// Helpers — test data
// ---------------------------------------------------------------------------

// PanelResult does not yet exist in fusion-types.ts (forward ref for Task 03).
const samplePanelResults: any[] = [
  { modelId: 'gpt-4o', content: 'Paris is the capital of France, known for landmarks.' },
  { modelId: 'claude-3-opus', content: 'France\'s capital is Paris, with rich cultural history.' },
];

const sampleMessages = [
  { role: 'user' as const, content: 'Tell me about the capital of France.' },
];

const validAnalysis: Analysis = {
  consensus: ['Paris is the capital of France', 'France is in Europe'],
  contradictions: [
    { topic: 'Best time to visit', perspectives: ['Spring is ideal', 'Fall is better'] },
  ],
  unique_insights: [
    { model: 'gpt-4o', insight: 'Paris has over 400 municipal parks' },
  ],
  blind_spots: ['No model mentioned the Paris Metro system'],
};

const emptyAnalysis: Analysis = {
  consensus: [],
  contradictions: [],
  unique_insights: [],
  blind_spots: [],
};

// ---------------------------------------------------------------------------
// buildSynthesisSystemPrompt
// ---------------------------------------------------------------------------

test('buildSynthesisSystemPrompt returns a non-empty string of at least 100 characters', () => {
  const prompt = buildSynthesisSystemPrompt();
  assert.ok(typeof prompt === 'string', 'must return a string');
  assert.ok(prompt.length >= 100, `expected >= 100 chars, got ${prompt.length}`);
  assert.ok(prompt.trim().length > 0, 'must be non-empty');
});

test('buildSynthesisSystemPrompt contains grounding instructions', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  const hasGrounding =
    prompt.includes('do not introduce facts') ||
    prompt.includes('not present in the provided materials') ||
    prompt.includes('ground every factual claim') ||
    prompt.includes('do not invent');
  assert.ok(hasGrounding, `must contain grounding/fact-constraint language. Got excerpt: ${prompt.substring(0, 300)}`);
});

test('buildSynthesisSystemPrompt contains consensus integration instructions', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(prompt.includes('consensus'), 'must mention consensus');
});

test('buildSynthesisSystemPrompt contains contradiction handling instructions', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('contradiction') || prompt.includes('disagreement') || prompt.includes('conflicting'),
    'must mention contradiction handling'
  );
});

// ---------------------------------------------------------------------------
// buildSynthesisUserPrompt — with analysis
// ---------------------------------------------------------------------------

test('buildSynthesisUserPrompt with analysis returns a non-empty string', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(typeof prompt === 'string');
  assert.ok(prompt.trim().length > 0);
});

test('buildSynthesisUserPrompt with analysis includes panel modelIds', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(prompt.includes('gpt-4o'), 'must include gpt-4o modelId');
  assert.ok(prompt.includes('claude-3-opus'), 'must include claude-3-opus modelId');
});

test('buildSynthesisUserPrompt with analysis includes original message content', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(prompt.includes('capital of France'), 'must include message content');
});

test('buildSynthesisUserPrompt with analysis includes consensus field content', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(prompt.includes('Paris is the capital of France'), 'must include consensus item');
});

test('buildSynthesisUserPrompt with analysis includes contradiction topic', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(prompt.includes('Best time to visit'), 'must include contradiction topic');
});

test('buildSynthesisUserPrompt with analysis includes unique insight content', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(prompt.includes('municipal parks') || prompt.includes('400'), 'must include unique insight content');
});

test('buildSynthesisUserPrompt with analysis includes blind spot content', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(prompt.includes('Metro') || prompt.includes('metro'), 'must include blind spot content');
});

test('buildSynthesisUserPrompt with analysis has PANEL ANALYSIS section', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(prompt.includes('PANEL ANALYSIS'), 'must include analysis section header');
});

test('buildSynthesisUserPrompt with analysis has INSTRUCTIONS section', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    validAnalysis,
  );
  assert.ok(prompt.includes('INSTRUCTIONS'), 'must include instructions section');
});

// ---------------------------------------------------------------------------
// buildSynthesisUserPrompt — without analysis (null path)
// ---------------------------------------------------------------------------

test('buildSynthesisUserPrompt with null analysis returns a non-empty string', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    null,
  );
  assert.ok(typeof prompt === 'string');
  assert.ok(prompt.trim().length > 0);
});

test('buildSynthesisUserPrompt with null analysis references panel results', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    null,
  );
  assert.ok(prompt.includes('gpt-4o'), 'must include modelId when analysis is null');
  assert.ok(prompt.includes('claude-3-opus'), 'must include second modelId when analysis is null');
});

test('buildSynthesisUserPrompt with null analysis does NOT include PANEL ANALYSIS section', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    null,
  );
  assert.ok(!prompt.includes('PANEL ANALYSIS'), 'must not include analysis section when analysis is null');
});

test('buildSynthesisUserPrompt with null analysis includes fallback language', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    null,
  );
  const hasFallback =
    prompt.toLowerCase().includes('unavailable') ||
    prompt.toLowerCase().includes('not available') ||
    prompt.toLowerCase().includes('work directly');
  assert.ok(hasFallback, `must include fallback language when analysis is null. Got excerpt: ${prompt.substring(0, 500)}`);
});

test('buildSynthesisUserPrompt with null analysis includes NOTE about missing analysis', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    null,
  );
  assert.ok(
    prompt.includes('NOTE'),
    'must include a note section when analysis is null'
  );
});

// ---------------------------------------------------------------------------
// buildSynthesisUserPrompt — with empty analysis
// ---------------------------------------------------------------------------

test('buildSynthesisUserPrompt with empty analysis still includes section headers', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults as any,
    sampleMessages as any,
    emptyAnalysis,
  );
  assert.ok(prompt.includes('PANEL ANALYSIS'), 'must include analysis section');
  assert.ok(prompt.includes('Consensus Points'), 'must include consensus header');
  assert.ok(prompt.includes('Contradictions'), 'must include contradictions header');
  assert.ok(prompt.includes('Unique Insights'), 'must include unique insights header');
  assert.ok(prompt.includes('Blind Spots'), 'must include blind spots header');
});

// ---------------------------------------------------------------------------
// Domain purity — no imports from application or infrastructure
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const synthesisPromptSource = readFileSync(
  fileURLToPath(import.meta.url).replace(/\.test\.ts$/, '.ts'),
  'utf-8'
);

test('synthesis-prompt.ts has zero imports from src/application/', () => {
  const matches = synthesisPromptSource.match(/from\s+['"].*application.*['"]/g);
  assert.equal(matches, null, `Found application imports: ${matches}`);
});

test('synthesis-prompt.ts has zero imports from src/infrastructure/', () => {
  const matches = synthesisPromptSource.match(/from\s+['"].*infrastructure.*['"]/g);
  assert.equal(matches, null, `Found infrastructure imports: ${matches}`);
});
