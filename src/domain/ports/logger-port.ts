import type { TokenUsage } from '../model/chat-types.js';
import type { FailedModelInfo } from '../model/stream-types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured context attached to a log line. Well-known keys are typed for
 * convenience; the index signature allows stage-specific detail (prompt sizes,
 * raw content snippets, finish reasons, retry markers, …) to be attached too.
 */
export interface LogFields {
  readonly requestId?: string;
  readonly stage?: string;
  readonly modelId?: string;
  readonly provider?: string;
  readonly [key: string]: unknown;
}

export interface LoggerPort {
  logStageStart(stage: string): void;
  logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void;
  logFailedModels(models: FailedModelInfo[]): void;
  logError(stage: string, error: Error, fields?: LogFields): void;
  /** An outbound request being dispatched (model, prompt sizes, options summary). */
  logRequest(fields: LogFields): void;
  /** A response that has been received and processed (content size, usage, latency). */
  logResponse(fields: LogFields): void;
  /** Free-form leveled, structured logging for everything else. */
  log(level: LogLevel, event: string, fields?: LogFields): void;
}
