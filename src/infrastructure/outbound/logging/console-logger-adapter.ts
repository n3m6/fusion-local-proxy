import type { LoggerPort, LogLevel, LogFields } from '../../../domain/ports/logger-port.js';
import type { TokenUsage } from '../../../domain/model/chat-types.js';
import type { FailedModelInfo } from '../../../domain/model/stream-types.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
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
 */
export class ConsoleLoggerAdapter implements LoggerPort {
  private readonly minLevel: number;

  constructor(level: LogLevel = 'info') {
    this.minLevel = LEVEL_ORDER[level];
  }

  private emit(level: LogLevel, payload: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) {
      return;
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), level, ...payload });
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
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
