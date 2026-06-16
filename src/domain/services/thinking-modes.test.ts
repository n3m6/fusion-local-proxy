import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThinkingModePrompt, applyThinkingMode } from './thinking-modes.js';
import type { ThinkingMode } from '../model/fusion-types.js';

const ALL_MODES: ThinkingMode[] = ['lateral', 'vertical', 'systems', 'divergent'];

// ---------------------------------------------------------------------------
// buildThinkingModePrompt
// ---------------------------------------------------------------------------

test('buildThinkingModePrompt returns non-empty string for each mode', () => {
  for (const mode of ALL_MODES) {
    const prompt = buildThinkingModePrompt(mode);
    assert.ok(
      typeof prompt === 'string' && prompt.length > 0,
      `expected non-empty string for ${mode}`,
    );
  }
});

test('buildThinkingModePrompt returns distinct text for each mode', () => {
  const prompts = ALL_MODES.map((m) => buildThinkingModePrompt(m));
  const unique = new Set(prompts);
  assert.equal(unique.size, ALL_MODES.length, 'expected each mode to map to a distinct prompt');
});

// ---------------------------------------------------------------------------
// applyThinkingMode — mode is undefined (pass-through)
// ---------------------------------------------------------------------------

test('applyThinkingMode returns original array reference when mode is undefined', () => {
  const messages = [{ role: 'user' as const, content: 'hello' }];
  const result = applyThinkingMode(messages, undefined);
  assert.equal(result, messages, 'expected the exact same array reference');
});

test('applyThinkingMode does not mutate messages when mode is undefined', () => {
  const messages = [{ role: 'user' as const, content: 'hello' }];
  const copy = [...messages];
  applyThinkingMode(messages, undefined);
  assert.deepStrictEqual(messages, copy);
});

// ---------------------------------------------------------------------------
// applyThinkingMode — mode is set
// ---------------------------------------------------------------------------

test('applyThinkingMode prepends exactly one system message when mode is set', () => {
  const messages = [{ role: 'user' as const, content: 'hello' }];
  const result = applyThinkingMode(messages, 'lateral');
  assert.equal(result.length, 2);
  assert.equal(result[0].role, 'system');
  assert.deepStrictEqual(result[1], messages[0]);
});

test('applyThinkingMode prepended system message content matches buildThinkingModePrompt', () => {
  for (const mode of ALL_MODES) {
    const messages = [{ role: 'user' as const, content: 'test' }];
    const result = applyThinkingMode(messages, mode);
    assert.equal(
      result[0].content,
      buildThinkingModePrompt(mode),
      `content mismatch for mode ${mode}`,
    );
  }
});

test('applyThinkingMode returns a new array and does not mutate the original', () => {
  const messages = [
    { role: 'system' as const, content: 'existing system' },
    { role: 'user' as const, content: 'question' },
  ];
  const originalLength = messages.length;
  const result = applyThinkingMode(messages, 'systems');
  assert.notEqual(result, messages, 'expected a new array');
  assert.equal(messages.length, originalLength, 'original array must not be mutated');
});

test('applyThinkingMode preserves all original messages after the prepended one', () => {
  const messages = [
    { role: 'system' as const, content: 'existing system' },
    { role: 'user' as const, content: 'question' },
    { role: 'assistant' as const, content: 'answer' },
  ];
  const result = applyThinkingMode(messages, 'divergent');
  assert.equal(result.length, messages.length + 1);
  for (let i = 0; i < messages.length; i++) {
    assert.deepStrictEqual(result[i + 1], messages[i]);
  }
});

test('applyThinkingMode works on an empty messages array', () => {
  const result = applyThinkingMode([], 'vertical');
  assert.equal(result.length, 1);
  assert.equal(result[0].role, 'system');
  assert.ok(result[0].content.length > 0);
});
