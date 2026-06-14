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
    logger.logStageStart('panel');
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'panel');
  assert.equal(parsed.event, 'start');
});

test('ConsoleLoggerAdapter logStageEnd emits structured JSON with usage', () => {
  const logger = new ConsoleLoggerAdapter();
  const usage: TokenUsage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };

  const lines = captureConsole(() => {
    logger.logStageEnd('panel', 150, usage);
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'panel');
  assert.equal(parsed.event, 'end');
  assert.equal(parsed.durationMs, 150);
  assert.deepEqual(parsed.tokens, { prompt: 100, completion: 50, total: 150 });
});

test('ConsoleLoggerAdapter logStageEnd without usage omits tokens field', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logStageEnd('panel', 100);
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'panel');
  assert.equal(parsed.event, 'end');
  assert.equal(parsed.durationMs, 100);
  // tokens should be undefined (absent from JSON after stringify)
  assert.equal('tokens' in parsed, false);
});

test('ConsoleLoggerAdapter logFailedModels emits one JSON line per model', () => {
  const logger = new ConsoleLoggerAdapter();
  const models: FailedModelInfo[] = [
    { modelId: 'gpt-4o', errorCode: 'TIMEOUT', errorMessage: 'Request timed out after 30s' },
    { modelId: 'gpt-3.5', errorCode: 'RATE_LIMIT', errorMessage: 'Too many requests' },
  ];

  const lines = captureConsole(() => {
    logger.logFailedModels(models);
  });

  assert.equal(lines.length, 2);

  // First model
  const parsed0 = JSON.parse(lines[0]);
  assert.equal(parsed0.event, 'failed_model');
  assert.equal(parsed0.modelId, 'gpt-4o');
  assert.equal(parsed0.errorCode, 'TIMEOUT');
  assert.equal(parsed0.errorMessage, 'Request timed out after 30s');

  // Second model
  const parsed1 = JSON.parse(lines[1]);
  assert.equal(parsed1.event, 'failed_model');
  assert.equal(parsed1.modelId, 'gpt-3.5');
  assert.equal(parsed1.errorCode, 'RATE_LIMIT');
  assert.equal(parsed1.errorMessage, 'Too many requests');
});

test('ConsoleLoggerAdapter logError emits structured JSON with error message', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logError('passthrough', new Error('connection refused'));
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'passthrough');
  assert.equal(parsed.event, 'error');
  assert.equal(parsed.message, 'connection refused');
});
