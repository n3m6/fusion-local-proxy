import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from './judge-prompt.js';
import type { PanelResult } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';

// ---------------------------------------------------------------------------
// Helpers — test data
// ---------------------------------------------------------------------------

const samplePanelResults: PanelResult[] = [
  {
    modelId: 'gpt-4o',
    provider: 'openai',
    content: 'The capital of France is Paris. It is known for the Eiffel Tower.',
    usage: { promptTokens: 0, completionTokens: 0 },
    latencyMs: 0,
  },
  {
    modelId: 'claude-3-opus',
    provider: 'anthropic',
    content: 'Paris is the capital of France, famous for its cuisine and art.',
    usage: { promptTokens: 0, completionTokens: 0 },
    latencyMs: 0,
  },
];

const sampleMessages: Message[] = [{ role: 'user', content: 'What is the capital of France?' }];

const emptyPanelResults: PanelResult[] = [];

// ---------------------------------------------------------------------------
// buildJudgeSystemPrompt
// ---------------------------------------------------------------------------

test('buildJudgeSystemPrompt returns a non-empty string of at least 100 characters', () => {
  const prompt = buildJudgeSystemPrompt();
  assert.ok(typeof prompt === 'string', 'must return a string');
  assert.ok(prompt.length >= 100, `expected >= 100 chars, got ${prompt.length}`);
  assert.ok(prompt.trim().length > 0, 'must be non-empty');
});

test('buildJudgeSystemPrompt contains correctness-oriented analysis instructions', () => {
  const prompt = buildJudgeSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('agreement') || prompt.includes('analy'),
    'must mention agreements or analysis',
  );
  assert.ok(
    prompt.includes('discrepanc') || prompt.includes('conflict') || prompt.includes('different'),
    'must mention discrepancies or conflicting answers',
  );
  assert.ok(
    prompt.includes('issue') || prompt.includes('error') || prompt.includes('bug'),
    'must mention issues or errors',
  );
  assert.ok(prompt.includes('gap') || prompt.includes('missing'), 'must mention gaps');
  assert.ok(prompt.includes('recommendation'), 'must mention recommendation');
});

test('buildJudgeSystemPrompt instructs JSON output', () => {
  const prompt = buildJudgeSystemPrompt().toLowerCase();
  assert.ok(prompt.includes('json'), 'must mention JSON output format');
});

test('buildJudgeSystemPrompt instructs task type inference', () => {
  const prompt = buildJudgeSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('coding') || prompt.includes('technical') || prompt.includes('task type'),
    'must mention task type inference',
  );
});

// ---------------------------------------------------------------------------
// buildJudgeUserPrompt
// ---------------------------------------------------------------------------

test('buildJudgeUserPrompt returns a non-empty string', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  assert.ok(typeof prompt === 'string', 'must return a string');
  assert.ok(prompt.trim().length > 0, 'must be non-empty');
});

test('buildJudgeUserPrompt includes modelId from panel results', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  assert.ok(prompt.includes('gpt-4o'), 'must include first modelId');
  assert.ok(prompt.includes('claude-3-opus'), 'must include second modelId');
});

test('buildJudgeUserPrompt includes original message content', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  assert.ok(prompt.includes('capital of France'), 'must include message content');
});

test('buildJudgeUserPrompt labels messages by role', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  assert.ok(prompt.includes('[user]'), 'must label user role');
});

test('buildJudgeUserPrompt works with empty panel results', () => {
  const prompt = buildJudgeUserPrompt(emptyPanelResults, sampleMessages);
  assert.ok(typeof prompt === 'string', 'must return a string even with empty results');
  assert.ok(prompt.includes('[user]'), 'must still include message content');
});

test('buildJudgeUserPrompt works with only system and assistant role messages', () => {
  const messages: Message[] = [
    { role: 'system', content: 'You are helpful.' },
    { role: 'assistant', content: 'Previous answer.' },
  ];
  const prompt = buildJudgeUserPrompt(samplePanelResults, messages);

  assert.ok(typeof prompt === 'string', 'must return a string');
  assert.ok(prompt.trim().length > 0, 'must be non-empty');
  assert.ok(prompt.includes('[system]'), 'must label system role');
  assert.ok(prompt.includes('[assistant]'), 'must label assistant role');
});

test('buildJudgeUserPrompt preserves special characters and multi-line panel content', () => {
  const panelResults: PanelResult[] = [
    {
      modelId: 'model-a',
      provider: 'openai',
      content: 'Line 1\nLine 2\tTabbed — "quoted" & <tagged>',
      usage: { promptTokens: 0, completionTokens: 0 },
      latencyMs: 0,
    },
  ];
  const prompt = buildJudgeUserPrompt(panelResults, sampleMessages);

  assert.ok(prompt.includes('Line 1\nLine 2'), 'must preserve newlines in content');
  assert.ok(prompt.includes('"quoted"'), 'must preserve quotes');
  assert.ok(prompt.includes('<tagged>'), 'must preserve angle brackets');
});

test('buildJudgeUserPrompt output is deterministic for identical input', () => {
  const a = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  const b = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  assert.equal(a, b);
});

test('buildJudgeUserPrompt includes panel content text for each result', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  assert.ok(prompt.includes('Eiffel Tower'), 'must include first panel content');
  assert.ok(prompt.includes('cuisine and art'), 'must include second panel content');
});

test('buildJudgeUserPrompt instructions reference new field names', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  assert.ok(prompt.includes('agreements'), 'instructions must reference agreements');
  assert.ok(prompt.includes('discrepancies'), 'instructions must reference discrepancies');
  assert.ok(prompt.includes('issues'), 'instructions must reference issues');
  assert.ok(prompt.includes('gaps'), 'instructions must reference gaps');
  assert.ok(prompt.includes('recommendation'), 'instructions must reference recommendation');
});

test('buildJudgeUserPrompt instructions reference all new structured-signal fields', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults, sampleMessages);
  assert.ok(prompt.includes('taskType'), 'instructions must reference taskType');
  assert.ok(
    prompt.includes('requirementCoverage'),
    'instructions must reference requirementCoverage',
  );
  assert.ok(prompt.includes('testResults'), 'instructions must reference testResults');
  assert.ok(
    prompt.includes('preferredCandidate'),
    'instructions must reference preferredCandidate',
  );
  assert.ok(prompt.includes('corrections'), 'instructions must reference corrections');
});

test('buildJudgeSystemPrompt contains severity rubric and trigger/evidence requirement', () => {
  const prompt = buildJudgeSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('trigger') || prompt.includes('triggering input'),
    'must require a triggering input for issues',
  );
  assert.ok(prompt.includes('evidence'), 'must require evidence for issues');
  assert.ok(
    prompt.includes('high') && prompt.includes('medium') && prompt.includes('low'),
    'must define severity levels',
  );
});

test('buildJudgeSystemPrompt forbids inventing requirements', () => {
  const prompt = buildJudgeSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('do not invent') ||
      prompt.includes('never stated') ||
      prompt.includes('explicit requirement'),
    'must instruct not to invent requirements',
  );
});

test('buildJudgeSystemPrompt requires emitting preferredCandidate and corrections', () => {
  const prompt = buildJudgeSystemPrompt();
  assert.ok(
    prompt.includes('preferredCandidate'),
    'system prompt must mention preferredCandidate output field',
  );
  assert.ok(prompt.includes('corrections'), 'system prompt must mention corrections output field');
});

test('buildJudgeSystemPrompt requires emitting taskType and requirementCoverage', () => {
  const prompt = buildJudgeSystemPrompt();
  assert.ok(prompt.includes('taskType'), 'system prompt must mention taskType output field');
  assert.ok(
    prompt.includes('requirementCoverage'),
    'system prompt must mention requirementCoverage output field',
  );
});

// ---------------------------------------------------------------------------
// Domain purity — no imports from application or infrastructure
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const judgePromptSource = readFileSync(
  fileURLToPath(import.meta.url).replace(/\.test\.ts$/, '.ts'),
  'utf-8',
);

test('judge-prompt.ts has zero imports from src/application/', () => {
  const matches = judgePromptSource.match(/from\s+['"].*application.*['"]/g);
  assert.equal(matches, null, `Found application imports: ${matches}`);
});

test('judge-prompt.ts has zero imports from src/infrastructure/', () => {
  const matches = judgePromptSource.match(/from\s+['"].*infrastructure.*['"]/g);
  assert.equal(matches, null, `Found infrastructure imports: ${matches}`);
});
