import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSynthesisSystemPrompt, buildSynthesisUserPrompt } from './synthesis-prompt.js';
import type { Analysis } from './analysis-schema.js';
import type { PanelResult, ProviderType } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';

// ---------------------------------------------------------------------------
// Helpers — test data
// ---------------------------------------------------------------------------

function makePanelResult(
  modelId: string,
  content: string,
  provider: ProviderType = 'openai',
): PanelResult {
  return {
    modelId,
    provider,
    content,
    usage: { promptTokens: 0, completionTokens: 0 },
    latencyMs: 0,
  };
}

const samplePanelResults: PanelResult[] = [
  makePanelResult('gpt-4o', 'Paris is the capital of France, known for landmarks.'),
  makePanelResult(
    'claude-3-opus',
    "France's capital is Paris, with rich cultural history.",
    'anthropic',
  ),
];

const sampleMessages: Message[] = [
  { role: 'user', content: 'Tell me about the capital of France.' },
];

const validAnalysis: Analysis = {
  agreements: ['Paris is the capital of France', 'France is in Europe'],
  discrepancies: [
    {
      topic: 'Best time to visit',
      positions: ['Spring is ideal', 'Fall is better'],
      assessment: 'unclear — both have merits',
    },
  ],
  issues: [
    {
      severity: 'low',
      candidate: 'gpt-4o',
      description: 'Mentioned Paris has over 400 municipal parks but this is trivia, not an error',
    },
  ],
  gaps: ['No model mentioned the Paris Metro system'],
  recommendation: 'Both models agree on the key fact. Combine their complementary details.',
};

const emptyAnalysis: Analysis = {
  agreements: [],
  discrepancies: [],
  issues: [],
  gaps: [],
  recommendation: '',
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

test('buildSynthesisSystemPrompt grants synthesizer authority to correct the panel', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  const hasAuthority =
    prompt.includes('final authority') ||
    prompt.includes('correct errors') ||
    prompt.includes('you are the final') ||
    prompt.includes('authoritative');
  assert.ok(
    hasAuthority,
    `must contain authority language. Got excerpt: ${prompt.substring(0, 300)}`,
  );
});

test('buildSynthesisSystemPrompt mentions agreement integration', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('agreement') || prompt.includes('converge'),
    'must mention agreement integration',
  );
});

test('buildSynthesisSystemPrompt mentions handling discrepancies or disagreements', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('discrepanc') ||
      prompt.includes('disagreement') ||
      prompt.includes('conflicting'),
    'must mention discrepancy handling',
  );
});

test('buildSynthesisSystemPrompt mentions task type adaptation', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('coding') || prompt.includes('technical') || prompt.includes('task type'),
    'must mention task type adaptation',
  );
});

// ---------------------------------------------------------------------------
// buildSynthesisUserPrompt — with analysis
// ---------------------------------------------------------------------------

test('buildSynthesisUserPrompt with analysis returns a non-empty string', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(typeof prompt === 'string');
  assert.ok(prompt.trim().length > 0);
});

test('buildSynthesisUserPrompt with analysis includes panel modelIds', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(prompt.includes('gpt-4o'), 'must include gpt-4o modelId');
  assert.ok(prompt.includes('claude-3-opus'), 'must include claude-3-opus modelId');
});

test('buildSynthesisUserPrompt with analysis includes original message content', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(prompt.includes('capital of France'), 'must include message content');
});

test('buildSynthesisUserPrompt with analysis includes agreements content', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(prompt.includes('Paris is the capital of France'), 'must include agreements item');
});

test('buildSynthesisUserPrompt with analysis includes discrepancy topic', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(prompt.includes('Best time to visit'), 'must include discrepancy topic');
});

test('buildSynthesisUserPrompt with analysis includes issue content', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(
    prompt.includes('municipal parks') || prompt.includes('400'),
    'must include issue description content',
  );
});

test('buildSynthesisUserPrompt with analysis includes gap content', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(prompt.includes('Metro') || prompt.includes('metro'), 'must include gap content');
});

test('buildSynthesisUserPrompt with analysis has PANEL ANALYSIS section', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(prompt.includes('PANEL ANALYSIS'), 'must include analysis section header');
});

test('buildSynthesisUserPrompt with analysis has INSTRUCTIONS section', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(prompt.includes('INSTRUCTIONS'), 'must include instructions section');
});

test('buildSynthesisUserPrompt with analysis includes recommendation content', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(
    prompt.includes('Recommendation') || prompt.includes('recommendation'),
    'must include recommendation section',
  );
  assert.ok(prompt.includes('complementary details'), 'must include recommendation text');
});

// ---------------------------------------------------------------------------
// buildSynthesisUserPrompt — without analysis (null path)
// ---------------------------------------------------------------------------

test('buildSynthesisUserPrompt with null analysis returns a non-empty string', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null);
  assert.ok(typeof prompt === 'string');
  assert.ok(prompt.trim().length > 0);
});

test('buildSynthesisUserPrompt with null analysis references panel results', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null);
  assert.ok(prompt.includes('gpt-4o'), 'must include modelId when analysis is null');
  assert.ok(prompt.includes('claude-3-opus'), 'must include second modelId when analysis is null');
});

test('buildSynthesisUserPrompt with null analysis does NOT include PANEL ANALYSIS section', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null);
  assert.ok(
    !prompt.includes('PANEL ANALYSIS'),
    'must not include analysis section when analysis is null',
  );
});

test('buildSynthesisUserPrompt with null analysis includes fallback language', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null);
  const hasFallback =
    prompt.toLowerCase().includes('unavailable') ||
    prompt.toLowerCase().includes('not available') ||
    prompt.toLowerCase().includes('work directly');
  assert.ok(
    hasFallback,
    `must include fallback language when analysis is null. Got excerpt: ${prompt.substring(0, 500)}`,
  );
});

test('buildSynthesisUserPrompt with null analysis includes NOTE about missing analysis', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null);
  assert.ok(prompt.includes('NOTE'), 'must include a note section when analysis is null');
});

// ---------------------------------------------------------------------------
// buildSynthesisUserPrompt — with empty analysis
// ---------------------------------------------------------------------------

test('buildSynthesisUserPrompt with empty analysis still includes section headers', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, emptyAnalysis);
  assert.ok(prompt.includes('PANEL ANALYSIS'), 'must include analysis section');
  assert.ok(prompt.includes('Agreements'), 'must include agreements header');
  assert.ok(prompt.includes('Discrepancies'), 'must include discrepancies header');
  assert.ok(prompt.includes('Issues'), 'must include issues header');
  assert.ok(prompt.includes('Gaps'), 'must include gaps header');
  assert.ok(prompt.includes('Recommendation'), 'must include recommendation header');
});

test('buildSynthesisUserPrompt with null analysis excludes analysis-specific field names', () => {
  const panelResults: PanelResult[] = [
    makePanelResult('model-a', 'Paris is the capital city.'),
    makePanelResult('model-b', 'The Eiffel Tower is a landmark.'),
  ];
  const prompt = buildSynthesisUserPrompt(panelResults, sampleMessages, null).toLowerCase();

  assert.ok(!prompt.includes('agreements'), 'null path must not reference agreements');
  assert.ok(!prompt.includes('discrepancies'), 'null path must not reference discrepancies');
  assert.ok(!prompt.includes('recommendation'), 'null path must not reference recommendation');
});

test('buildSynthesisUserPrompt with null analysis still references panel content', () => {
  const panelResults: PanelResult[] = [makePanelResult('model-a', 'distinctive panel output text')];
  const prompt = buildSynthesisUserPrompt(panelResults, sampleMessages, null);
  assert.ok(prompt.includes('distinctive panel output text'), 'must include raw panel content');
});

test('buildSynthesisUserPrompt handles panel results with empty content', () => {
  const panelResults: PanelResult[] = [
    makePanelResult('model-a', ''),
    makePanelResult('model-b', ''),
  ];
  const prompt = buildSynthesisUserPrompt(panelResults, sampleMessages, validAnalysis);
  assert.ok(typeof prompt === 'string');
  assert.ok(prompt.trim().length > 0);
  assert.ok(prompt.includes('model-a'), 'must still list model identifiers');
  assert.ok(prompt.includes('model-b'), 'must still list model identifiers');
});

test('buildSynthesisUserPrompt with empty analysis arrays emits empty-section fallbacks', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, emptyAnalysis);
  assert.ok(prompt.includes('No agreements identified'), 'must note empty agreements');
  assert.ok(prompt.includes('No discrepancies identified'), 'must note empty discrepancies');
  assert.ok(prompt.includes('No issues identified'), 'must note empty issues');
  assert.ok(prompt.includes('No gaps identified'), 'must note empty gaps');
  assert.ok(prompt.includes('No recommendation provided'), 'must note empty recommendation');
});

// ---------------------------------------------------------------------------
// Domain purity — no imports from application or infrastructure
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const synthesisPromptSource = readFileSync(
  fileURLToPath(import.meta.url).replace(/\.test\.ts$/, '.ts'),
  'utf-8',
);

test('synthesis-prompt.ts has zero imports from src/application/', () => {
  const matches = synthesisPromptSource.match(/from\s+['"].*application.*['"]/g);
  assert.equal(matches, null, `Found application imports: ${matches}`);
});

test('synthesis-prompt.ts has zero imports from src/infrastructure/', () => {
  const matches = synthesisPromptSource.match(/from\s+['"].*infrastructure.*['"]/g);
  assert.equal(matches, null, `Found infrastructure imports: ${matches}`);
});
