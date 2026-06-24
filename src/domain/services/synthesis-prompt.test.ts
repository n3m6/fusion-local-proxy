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

test('buildSynthesisSystemPrompt includes anti-sycophancy instruction', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('anti-sycophancy') || prompt.includes('vote count'),
    'must include anti-sycophancy instruction',
  );
});

test('buildSynthesisSystemPrompt includes anti-sycophancy instruction in selfJudge mode', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    prompt.includes('anti-sycophancy') || prompt.includes('vote count'),
    'must include anti-sycophancy instruction in selfJudge mode',
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
// New structured-signal fields in analysis rendering
// ---------------------------------------------------------------------------

const analysisWithNewFields: Analysis = {
  agreements: ['Both use binary (1024) units'],
  discrepancies: [],
  issues: [
    {
      severity: 'high',
      candidate: 'Model 1',
      description: 'Returns wrong unit for 0 bytes',
      trigger: 'format_bytes(0)',
      evidence: 'actual: "0.00 B", expected: "0.00 Bytes"',
    },
  ],
  gaps: [],
  recommendation: 'Use Model 2 overall.',
  taskType: 'coding',
  preferredCandidate: 'Model 2',
  corrections: ['Remove unused import math from Model 1'],
  requirementCoverage: [{ requirement: 'Support Bytes, KB, MB, GB, TB', assessment: 'Met by all' }],
  testResults: [
    {
      candidate: 'Model 1',
      test: 'format_bytes(1024) == "1.00 KB"',
      verdict: 'pass',
      detail: '1024/1024=1.0, formatted as "1.00 KB"',
    },
  ],
};

test('buildSynthesisUserPrompt renders preferredCandidate when present', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults,
    sampleMessages,
    analysisWithNewFields,
  );
  assert.ok(
    prompt.includes('Model 2') || prompt.includes('Preferred Candidate'),
    'must render preferredCandidate',
  );
});

test('buildSynthesisUserPrompt renders corrections when present', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults,
    sampleMessages,
    analysisWithNewFields,
  );
  assert.ok(prompt.includes('import math'), 'must render corrections content');
});

test('buildSynthesisUserPrompt renders taskType when present', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults,
    sampleMessages,
    analysisWithNewFields,
  );
  assert.ok(prompt.includes('coding'), 'must render taskType value');
});

test('buildSynthesisUserPrompt renders requirementCoverage when present', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults,
    sampleMessages,
    analysisWithNewFields,
  );
  assert.ok(
    prompt.includes('Support Bytes, KB, MB, GB, TB'),
    'must render requirementCoverage requirement text',
  );
});

test('buildSynthesisUserPrompt renders testResults when present', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults,
    sampleMessages,
    analysisWithNewFields,
  );
  assert.ok(
    prompt.includes('1024') && (prompt.includes('pass') || prompt.includes('PASS')),
    'must render testResults with verdict',
  );
});

test('buildSynthesisUserPrompt renders trigger and evidence in issues', () => {
  const prompt = buildSynthesisUserPrompt(
    samplePanelResults,
    sampleMessages,
    analysisWithNewFields,
  );
  assert.ok(prompt.includes('format_bytes(0)'), 'must render issue trigger in issues section');
  assert.ok(
    prompt.includes('0.00 B') || prompt.includes('0.00 Bytes'),
    'must render issue evidence in issues section',
  );
});

test('buildSynthesisUserPrompt falls back gracefully when optional fields are absent', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(
    prompt.includes('No corrections required') || !prompt.includes('Corrections'),
    'must handle missing corrections gracefully',
  );
});

test('buildSynthesisSystemPrompt instructs to scale rigor to task complexity', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('scale') || prompt.includes('complexity') || prompt.includes('proportional'),
    'must mention scaling rigor to complexity',
  );
});

test('buildSynthesisSystemPrompt instructs to verify issues before fixing', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('verify') && (prompt.includes('trigger') || prompt.includes('reproduce')),
    'must instruct to verify issues before fixing',
  );
});

test('buildSynthesisSystemPrompt instructs advisory treatment of recommendation', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('advisory') || prompt.includes('treat the recommendation'),
    'must describe recommendation as advisory',
  );
});

test('buildSynthesisSystemPrompt instructs against vacuous property claims', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('relevant') &&
      (prompt.includes('vacuous') || prompt.includes('simple function')),
    'must warn against irrelevant/vacuous property claims',
  );
});

test('buildSynthesisSystemPrompt instructs demonstrations to be runnable assertions in test block', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('test block') || prompt.includes('runnable assertion'),
    'must require demonstrations to be in the test block, not prose',
  );
});

test('buildSynthesisUserPrompt instructions use advisory language, not imperative follow-the-recommendation', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(
    prompt.toLowerCase().includes('advisory') || prompt.toLowerCase().includes('verify'),
    'INSTRUCTIONS section must use advisory language',
  );
});

test('buildSynthesisSystemPrompt requires regression check before applying behavior-changing corrections', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('regress'),
    'must require a regression check before applying behavior-changing corrections',
  );
});

test('buildSynthesisSystemPrompt instructs range-spanning test cases to exercise all required units', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('range-spanning') || (prompt.includes('required') && prompt.includes('unit')),
    'must instruct range-spanning test cases to cover all explicitly required behaviors and units',
  );
});

test('buildSynthesisSystemPrompt enforces explicit-example precedence over panel and judge guidance', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    (prompt.includes('example') && prompt.includes('override')) ||
      prompt.includes('example precedence'),
    'must state that an explicit worked example overrides conflicting prose or panel recommendations',
  );
});

test('buildSynthesisUserPrompt instructions warn against regressions from behavior-changing corrections', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  assert.ok(
    prompt.toLowerCase().includes('regress'),
    'INSTRUCTIONS must warn against regressing explicit requirements when applying corrections',
  );
});

test('buildSynthesisSystemPrompt includes an OUTPUT CONTRACT instruction to preserve required output formats', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(prompt.includes('output contract'), 'must include an OUTPUT CONTRACT instruction');
  assert.ok(
    prompt.includes('format') && prompt.includes('precedence'),
    'OUTPUT CONTRACT must require the specified output format to take precedence over default verbosity',
  );
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) also includes the OUTPUT CONTRACT instruction', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    prompt.includes('output contract'),
    'selfJudge mode must also include the OUTPUT CONTRACT instruction',
  );
});

// ---------------------------------------------------------------------------
// selfJudge mode — system prompt
// ---------------------------------------------------------------------------

test('buildSynthesisSystemPrompt({ selfJudge: true }) includes SELF-EVALUATION FIRST section', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(prompt.includes('self-evaluation first'), 'must include SELF-EVALUATION FIRST heading');
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) instructs task classification', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    prompt.includes('classify the task') || prompt.includes('classify'),
    'must instruct the model to classify the task type',
  );
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) instructs convergence verification', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    prompt.includes('verify convergence') || prompt.includes('convergence does not imply'),
    'must warn that convergence does not imply correctness',
  );
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) instructs finding issues and gaps', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(prompt.includes('find issues'), 'must instruct finding issues');
  assert.ok(prompt.includes('find gaps'), 'must instruct finding gaps');
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) does not instruct model to emit JSON evaluation', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    prompt.includes('do not output') || prompt.includes('do not emit'),
    'must explicitly forbid emitting the evaluation as JSON or preamble',
  );
});

test('buildSynthesisSystemPrompt() default does NOT include self-evaluation section (backward compat)', () => {
  const prompt = buildSynthesisSystemPrompt().toLowerCase();
  assert.ok(
    !prompt.includes('self-evaluation first'),
    'default prompt must not include SELF-EVALUATION FIRST section',
  );
});

test('buildSynthesisSystemPrompt({ selfJudge: false }) does NOT include self-evaluation section', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: false }).toLowerCase();
  assert.ok(
    !prompt.includes('self-evaluation first'),
    'selfJudge:false must not include SELF-EVALUATION FIRST section',
  );
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) instruction 2 does not reference external panel analysis', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    !prompt.includes('the output of another model'),
    'selfJudge prompt must not claim the analysis is produced by another model — no external analysis exists',
  );
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) instruction 2 is SELF-ANALYSIS AS FALLIBLE', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    prompt.includes('self-analysis as fallible') || prompt.includes('own internal evaluation'),
    "selfJudge instruction 2 must address the model's own evaluation, not an external analysis",
  );
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) instruction 7 does not reference a judge recommendation', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    !prompt.includes('treat the recommendation as advisory'),
    'selfJudge prompt must not reference a judge recommendation that does not exist',
  );
});

test('buildSynthesisSystemPrompt({ selfJudge: true }) instruction 7 is SELF-CORRECTIONS', () => {
  const prompt = buildSynthesisSystemPrompt({ selfJudge: true }).toLowerCase();
  assert.ok(
    prompt.includes('self-corrections') || prompt.includes('your own identified issues'),
    "selfJudge instruction 7 must address the model's own corrections, not an external recommendation",
  );
});

// ---------------------------------------------------------------------------
// selfJudge mode — user prompt
// ---------------------------------------------------------------------------

test('buildSynthesisUserPrompt with selfJudge:true and null analysis includes SELF-EVALUATION DIRECTIVE', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null, {
    selfJudge: true,
  });
  assert.ok(
    prompt.includes('SELF-EVALUATION DIRECTIVE'),
    'must include SELF-EVALUATION DIRECTIVE section',
  );
});

test('buildSynthesisUserPrompt with selfJudge:true and null analysis does not include minimal fallback note', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null, {
    selfJudge: true,
  });
  assert.ok(
    !prompt.includes('Panel-level analysis is unavailable'),
    'self-judge path must not show the minimal fallback note',
  );
});

test('buildSynthesisUserPrompt with selfJudge:true still includes panel responses', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null, {
    selfJudge: true,
  });
  assert.ok(
    prompt.includes('PANEL MODEL RESPONSES'),
    'self-judge user prompt must still include the panel responses section',
  );
});

test('buildSynthesisUserPrompt with selfJudge:true includes self-judging INSTRUCTIONS', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null, {
    selfJudge: true,
  }).toLowerCase();
  assert.ok(
    prompt.includes('evaluate the panel candidates yourself'),
    'INSTRUCTIONS must ask model to evaluate candidates itself',
  );
});

test('buildSynthesisUserPrompt default (null analysis, no options) still shows minimal fallback (backward compat)', () => {
  const prompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, null);
  assert.ok(
    prompt.includes('Panel-level analysis is unavailable'),
    'default null-analysis path must still show the minimal fallback note',
  );
});

test('buildSynthesisUserPrompt with selfJudge:true and non-null analysis behaves identically to default (analysis wins)', () => {
  const defaultPrompt = buildSynthesisUserPrompt(samplePanelResults, sampleMessages, validAnalysis);
  const selfJudgePrompt = buildSynthesisUserPrompt(
    samplePanelResults,
    sampleMessages,
    validAnalysis,
    { selfJudge: true },
  );
  assert.equal(
    selfJudgePrompt,
    defaultPrompt,
    'when analysis is present, selfJudge flag must have no effect on the user prompt',
  );
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
