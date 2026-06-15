import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from './judge-prompt.js';

// ---------------------------------------------------------------------------
// Helpers — test data
// ---------------------------------------------------------------------------

// PanelResult does not yet exist in fusion-types.ts (forward ref for Task 03).
// We use objects with the expected shape cast to any.
const samplePanelResults: any[] = [
  { modelId: 'gpt-4o', content: 'The capital of France is Paris. It is known for the Eiffel Tower.' },
  { modelId: 'claude-3-opus', content: 'Paris is the capital of France, famous for its cuisine and art.' },
];

const sampleMessages = [
  { role: 'user' as const, content: 'What is the capital of France?' },
];

const emptyPanelResults: any[] = [];
const emptyMessages: Array<{ role: string; content: string }> = [];

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
    'must mention consensus or analysis'
  );
  assert.ok(
    prompt.includes('contradiction') || prompt.includes('conflict'),
    'must mention contradictions or conflicts'
  );
  assert.ok(
    prompt.includes('insight') || prompt.includes('unique'),
    'must mention insights'
  );
  assert.ok(
    prompt.includes('blind') && prompt.includes('spot'),
    'must mention blind spots'
  );
});

test('buildJudgeSystemPrompt instructs JSON output', () => {
  const prompt = buildJudgeSystemPrompt().toLowerCase();
  assert.ok(
    prompt.includes('json'),
    'must mention JSON output format'
  );
});

// ---------------------------------------------------------------------------
// buildJudgeUserPrompt
// ---------------------------------------------------------------------------

test('buildJudgeUserPrompt returns a non-empty string', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults as any, sampleMessages as any);
  assert.ok(typeof prompt === 'string', 'must return a string');
  assert.ok(prompt.trim().length > 0, 'must be non-empty');
});

test('buildJudgeUserPrompt includes modelId from panel results', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults as any, sampleMessages as any);
  assert.ok(prompt.includes('gpt-4o'), 'must include first modelId');
  assert.ok(prompt.includes('claude-3-opus'), 'must include second modelId');
});

test('buildJudgeUserPrompt includes original message content', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults as any, sampleMessages as any);
  assert.ok(
    prompt.includes('capital of France'),
    'must include message content'
  );
});

test('buildJudgeUserPrompt labels messages by role', () => {
  const prompt = buildJudgeUserPrompt(samplePanelResults as any, sampleMessages as any);
  assert.ok(prompt.includes('[user]'), 'must label user role');
});

test('buildJudgeUserPrompt works with empty panel results', () => {
  const prompt = buildJudgeUserPrompt(emptyPanelResults as any, sampleMessages as any);
  assert.ok(typeof prompt === 'string', 'must return a string even with empty results');
  assert.ok(prompt.includes('[user]'), 'must still include message content');
});

// ---------------------------------------------------------------------------
// Domain purity — no imports from application or infrastructure
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const judgePromptSource = readFileSync(
  fileURLToPath(import.meta.url).replace(/\.test\.ts$/, '.ts'),
  'utf-8'
);

test('judge-prompt.ts has zero imports from src/application/', () => {
  const matches = judgePromptSource.match(/from\s+['"].*application.*['"]/g);
  assert.equal(matches, null, `Found application imports: ${matches}`);
});

test('judge-prompt.ts has zero imports from src/infrastructure/', () => {
  const matches = judgePromptSource.match(/from\s+['"].*infrastructure.*['"]/g);
  assert.equal(matches, null, `Found infrastructure imports: ${matches}`);
});
