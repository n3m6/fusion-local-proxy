import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleLoggerAdapter } from './console-logger-adapter.js';
import type { TokenUsage } from '../../../domain/model/chat-types.js';
import type { FailedModelInfo } from '../../../domain/model/stream-types.js';

// ---------------------------------------------------------------------------
// Helper to capture console.log output
// ---------------------------------------------------------------------------

function captureConsole(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('ConsoleLoggerAdapter logStageStart emits structured JSON', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logStageStart('passthrough');
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'passthrough');
  assert.equal(parsed.event, 'start');
});

test('ConsoleLoggerAdapter logStageEnd emits structured JSON with usage', () => {
  const logger = new ConsoleLoggerAdapter();
  const usage: TokenUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

  const lines = captureConsole(() => {
    logger.logStageEnd('passthrough', 420, usage);
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'passthrough');
  assert.equal(parsed.event, 'end');
  assert.equal(parsed.durationMs, 420);
  assert.deepEqual(parsed.tokens, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
});

test('ConsoleLoggerAdapter logStageEnd without usage omits tokens field', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logStageEnd('passthrough', 100);
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'passthrough');
  assert.equal(parsed.event, 'end');
  assert.equal(parsed.durationMs, 100);
  // tokens should be undefined (absent from JSON after stringify)
  assert.equal('tokens' in parsed, false);
});

test('ConsoleLoggerAdapter logFailedModels emits structured JSON', () => {
  const logger = new ConsoleLoggerAdapter();
  const models: FailedModelInfo[] = [
    { model: 'gpt-3.5', reason: 'timeout' },
    { model: 'gpt-4o', reason: 'rate_limit' },
  ];

  const lines = captureConsole(() => {
    logger.logFailedModels(models);
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, 'failed_models');
  assert.deepEqual(parsed.models, models);
});

test('ConsoleLoggerAdapter logError emits structured JSON with error message', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logError('passthrough', new Error('API key invalid'));
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'passthrough');
  assert.equal(parsed.event, 'error');
  assert.equal(parsed.error, 'API key invalid');
});
