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

test('buildJudgeSystemPrompt contains comparative analysis instructions', () => {
  const prompt = buildJudgeSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('consensus') || prompt.includes('analy'),
    'must mention consensus or analysis',
  );
  assert.ok(
    prompt.includes('contradiction') || prompt.includes('conflict'),
    'must mention contradictions or conflicts',
  );
  assert.ok(prompt.includes('insight') || prompt.includes('unique'), 'must mention insights');
  assert.ok(prompt.includes('blind') && prompt.includes('spot'), 'must mention blind spots');
});

test('buildJudgeSystemPrompt instructs JSON output', () => {
  const prompt = buildJudgeSystemPrompt().toLowerCase();
  assert.ok(prompt.includes('json'), 'must mention JSON output format');
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
