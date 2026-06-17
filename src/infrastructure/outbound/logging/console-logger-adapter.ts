import type { LoggerPort, LogLevel, LogFields } from '../../../domain/ports/logger-port.js';
import type { TokenUsage } from '../../../domain/model/chat-types.js';
import type { FailedModelInfo } from '../../../domain/model/stream-types.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const RESET = '\x1b[0m';

/**
 * ANSI foreground colors keyed by level, using the high-intensity (bright)
 * variants for readability on dark terminals: debug=white, info=bright cyan,
 * warn=bright yellow, error=bright red.
 */
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: '\x1b[37m',
  info: '\x1b[96m',
  warn: '\x1b[93m',
  error: '\x1b[91m',
};

/**
 * Parse a free-form level string (e.g. from `LOG_LEVEL`) into a `LogLevel`,
 * falling back to `'info'` for unknown/empty values.
 */
export function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn') {
    return normalized;
  }
  if (normalized === 'error') {
    return 'error';
  }
  return 'info';
}

/**
 * Structured JSON console logger. Each line is a single JSON object carrying a
 * timestamp and level so output can be piped into log processors. Lines below
 * the configured `minLevel` are dropped; `error` goes to stderr, `warn` to
 * `console.warn`, everything else to stdout.
 *
 * When `useColor` is enabled, each line is wrapped in an ANSI color matching its
 * level so a human reading a terminal can scan levels at a glance. Color is
 * opt-in (default off) so piped/JSON-consumed output stays clean; the
 * composition root decides whether the destination is an interactive TTY.
 */
export class ConsoleLoggerAdapter implements LoggerPort {
  private readonly minLevel: number;
  private readonly useColor: boolean;

  constructor(level: LogLevel = 'info', useColor = false) {
    this.minLevel = LEVEL_ORDER[level];
    this.useColor = useColor;
  }

  private emit(level: LogLevel, payload: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) {
      return;
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), level, ...payload });
    const out = this.useColor ? `${LEVEL_COLOR[level]}${line}${RESET}` : line;
    if (level === 'error') {
      console.error(out);
    } else if (level === 'warn') {
      console.warn(out);
    } else {
      console.log(out);
    }
  }

  logStageStart(stage: string): void {
    this.emit('info', { stage, event: 'start' });
  }

  logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void {
    const payload: Record<string, unknown> = { stage, event: 'end', durationMs };
    if (usage) {
      payload.tokens = {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        total: usage.totalTokens,
        ...(usage.reasoningTokens !== undefined ? { reasoning: usage.reasoningTokens } : {}),
      };
    }
    this.emit('info', payload);
  }

  logFailedModels(models: FailedModelInfo[]): void {
    for (const m of models) {
      this.emit('warn', {
        event: 'failed_model',
        modelId: m.modelId,
        errorCode: m.errorCode,
        errorMessage: m.errorMessage,
      });
    }
  }

  logError(stage: string, error: Error, fields?: LogFields): void {
    this.emit('error', {
      stage,
      event: 'error',
      errorName: error.name,
      message: error.message,
      ...fields,
    });
  }

  logRequest(fields: LogFields): void {
    this.emit('debug', { event: 'request', ...fields });
  }

  logResponse(fields: LogFields): void {
    this.emit('debug', { event: 'response', ...fields });
  }

  log(level: LogLevel, event: string, fields?: LogFields): void {
    this.emit(level, { event, ...fields });
  }
}
