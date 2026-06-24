import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleLoggerAdapter, parseLogLevel } from './console-logger-adapter.js';
import type { TokenUsage } from '../../../domain/model/chat-types.js';
import type { FailedModelInfo } from '../../../domain/model/stream-types.js';

// ---------------------------------------------------------------------------
// Helper to capture console output across log/warn/error streams
// ---------------------------------------------------------------------------

function captureConsole(fn: () => void): string[] {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const sink = (...args: unknown[]): void => void lines.push(args.map(String).join(' '));
  console.log = sink;
  console.warn = sink;
  console.error = sink;
  try {
    fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
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

test('ConsoleLoggerAdapter logStageEnd includes tokens.reasoning when present', () => {
  const logger = new ConsoleLoggerAdapter();
  const usage: TokenUsage = {
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    reasoningTokens: 30,
  };

  const lines = captureConsole(() => {
    logger.logStageEnd('synthesis', 200, usage);
  });

  const parsed = JSON.parse(lines[0]);
  assert.deepEqual(parsed.tokens, { prompt: 100, completion: 50, total: 150, reasoning: 30 });
});

test('ConsoleLoggerAdapter logStageEnd omits tokens.reasoning when not present', () => {
  const logger = new ConsoleLoggerAdapter();
  const usage: TokenUsage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };

  const lines = captureConsole(() => {
    logger.logStageEnd('panel', 150, usage);
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal('reasoning' in parsed.tokens, false);
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
  assert.equal(parsed.level, 'error');
});

test('ConsoleLoggerAdapter logError merges extra fields', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logError('judge', new SyntaxError('bad json'), {
      requestId: 'req-1',
      rawContent: 'not json',
    });
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'judge');
  assert.equal(parsed.requestId, 'req-1');
  assert.equal(parsed.rawContent, 'not json');
});

test('ConsoleLoggerAdapter logRequest/logResponse are debug-level (suppressed at default info)', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logRequest({ stage: 'panel', modelId: 'gpt-4o' });
    logger.logResponse({ stage: 'panel', modelId: 'gpt-4o' });
  });

  assert.equal(lines.length, 0, 'debug logs must be suppressed at the default info level');
});

test('ConsoleLoggerAdapter logRequest/logResponse emit at debug level', () => {
  const logger = new ConsoleLoggerAdapter('debug');

  const lines = captureConsole(() => {
    logger.logRequest({ stage: 'panel', modelId: 'gpt-4o', promptChars: 42 });
    logger.logResponse({ stage: 'panel', modelId: 'gpt-4o', contentChars: 100 });
  });

  assert.equal(lines.length, 2);
  const req = JSON.parse(lines[0]);
  assert.equal(req.event, 'request');
  assert.equal(req.stage, 'panel');
  assert.equal(req.modelId, 'gpt-4o');
  assert.equal(req.promptChars, 42);
  assert.equal(req.level, 'debug');

  const res = JSON.parse(lines[1]);
  assert.equal(res.event, 'response');
  assert.equal(res.contentChars, 100);
});

test('ConsoleLoggerAdapter log respects the minimum level threshold', () => {
  const warnLogger = new ConsoleLoggerAdapter('warn');

  const lines = captureConsole(() => {
    warnLogger.log('debug', 'should_be_dropped');
    warnLogger.log('info', 'should_also_be_dropped');
    warnLogger.log('warn', 'kept', { detail: 1 });
    warnLogger.log('error', 'also_kept');
  });

  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).event, 'kept');
  assert.equal(JSON.parse(lines[0]).detail, 1);
  assert.equal(JSON.parse(lines[1]).event, 'also_kept');
});

test('ConsoleLoggerAdapter includes an ISO timestamp on every line', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logStageStart('panel');
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(typeof parsed.ts, 'string');
  assert.ok(!Number.isNaN(Date.parse(parsed.ts)), 'ts must be a parseable timestamp');
});

test('ConsoleLoggerAdapter emits uncolored JSON by default', () => {
  const logger = new ConsoleLoggerAdapter();

  const lines = captureConsole(() => {
    logger.logStageStart('panel');
  });

  assert.equal(lines.length, 1);
  // No ANSI escape codes; line is parseable JSON as-is.
  assert.equal(lines[0].includes('\x1b['), false);
  assert.doesNotThrow(() => JSON.parse(lines[0]));
});

test('ConsoleLoggerAdapter wraps each level in its ANSI color when useColor is on', () => {
  const logger = new ConsoleLoggerAdapter('debug', true);

  const lines = captureConsole(() => {
    logger.logRequest({ stage: 'panel' }); // debug panel request -> dim green
    logger.logStageStart('panel'); // info -> bold bright cyan
    logger.logFailedModels([{ modelId: 'm', errorCode: 'E', errorMessage: 'boom' }]); // warn -> bold bright yellow
    logger.logError('panel', new Error('boom')); // error -> bold bright red
  });

  const expectedPrefix: Record<string, string> = {
    debug: '\x1b[2;32m', // dim + green (panel stage)
    info: '\x1b[1;96m', // bold + bright cyan
    warn: '\x1b[1;93m', // bold + bright yellow
    error: '\x1b[1;91m', // bold + bright red
  };

  // eslint-disable-next-line no-control-regex -- intentionally matching ANSI escapes
  const ansi = /\x1b\[[0-9;]+m/g;
  for (const line of lines) {
    assert.ok(line.startsWith('\x1b['), 'colored line must start with an ANSI code');
    assert.ok(line.endsWith('\x1b[0m'), 'colored line must end with a reset code');
    const parsed = JSON.parse(line.replace(ansi, ''));
    assert.ok(
      line.startsWith(expectedPrefix[parsed.level as string]),
      `level ${String(parsed.level)}: expected prefix ${expectedPrefix[parsed.level as string]}`,
    );
  }
});

test('ConsoleLoggerAdapter uses per-stage hues for debug lines', () => {
  const logger = new ConsoleLoggerAdapter('debug', true);

  const lines = captureConsole(() => {
    logger.logRequest({ stage: 'panel' }); // dim + green
    logger.logResponse({ stage: 'panel' }); // dim + green + underline
    logger.logRequest({ stage: 'judge' }); // dim + magenta
    logger.logResponse({ stage: 'judge' }); // dim + magenta + underline
    logger.logRequest({ stage: 'synthesis' }); // dim + blue
    logger.logResponse({ stage: 'synthesis' }); // dim + blue + underline
  });

  assert.equal(lines.length, 6);

  // eslint-disable-next-line no-control-regex -- intentionally matching ANSI escapes
  const ansi = /\x1b\[[0-9;]+m/g;

  assert.ok(lines[0].startsWith('\x1b[2;32m'), 'panel request: dim green');
  assert.ok(lines[1].startsWith('\x1b[2;32;4m'), 'panel response: dim green + underline');
  assert.ok(lines[2].startsWith('\x1b[2;35m'), 'judge request: dim magenta');
  assert.ok(lines[3].startsWith('\x1b[2;35;4m'), 'judge response: dim magenta + underline');
  assert.ok(lines[4].startsWith('\x1b[2;34m'), 'synthesis request: dim blue');
  assert.ok(lines[5].startsWith('\x1b[2;34;4m'), 'synthesis response: dim blue + underline');

  for (const line of lines) {
    assert.ok(line.endsWith('\x1b[0m'), 'must end with reset');
    assert.doesNotThrow(
      () => JSON.parse(line.replace(ansi, '')),
      'must be valid JSON after stripping ANSI',
    );
  }
});

test('ConsoleLoggerAdapter uses default debug hue for lines without a stage', () => {
  const logger = new ConsoleLoggerAdapter('debug', true);

  const lines = captureConsole(() => {
    logger.log('debug', 'judge_skipped', { requestId: 'r1' });
  });

  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('\x1b[2;37m'), 'no-stage debug line: dim white');
});

test('parseLogLevel normalizes known values and falls back to info', () => {
  assert.equal(parseLogLevel('debug'), 'debug');
  assert.equal(parseLogLevel('INFO'), 'info');
  assert.equal(parseLogLevel(' warn '), 'warn');
  assert.equal(parseLogLevel('error'), 'error');
  assert.equal(parseLogLevel('verbose'), 'info');
  assert.equal(parseLogLevel(undefined), 'info');
  assert.equal(parseLogLevel(''), 'info');
});

// ---------------------------------------------------------------------------
// Cache token fields in logStageEnd
// ---------------------------------------------------------------------------

test('ConsoleLoggerAdapter logStageEnd includes tokens.cached when cachedPromptTokens present', () => {
  const logger = new ConsoleLoggerAdapter();
  const usage: TokenUsage = {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    cachedPromptTokens: 70,
  };

  const lines = captureConsole(() => {
    logger.logStageEnd('synthesis', 200, usage);
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.tokens.cached, 70);
  // Other token fields still present
  assert.equal(parsed.tokens.prompt, 100);
  assert.equal(parsed.tokens.completion, 20);
  assert.equal(parsed.tokens.total, 120);
});

test('ConsoleLoggerAdapter logStageEnd includes tokens.cacheWrite when cacheWritePromptTokens present', () => {
  const logger = new ConsoleLoggerAdapter();
  const usage: TokenUsage = {
    promptTokens: 80,
    completionTokens: 10,
    totalTokens: 90,
    cacheWritePromptTokens: 50,
  };

  const lines = captureConsole(() => {
    logger.logStageEnd('panel', 100, usage);
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.tokens.cacheWrite, 50);
});

test('ConsoleLoggerAdapter logStageEnd omits tokens.cached when cachedPromptTokens absent', () => {
  const logger = new ConsoleLoggerAdapter();
  const usage: TokenUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

  const lines = captureConsole(() => {
    logger.logStageEnd('panel', 100, usage);
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal('cached' in parsed.tokens, false);
  assert.equal('cacheWrite' in parsed.tokens, false);
});
