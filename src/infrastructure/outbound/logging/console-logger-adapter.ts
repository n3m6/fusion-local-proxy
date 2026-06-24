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

// ANSI SGR attribute codes
const BOLD = '1';
const DIM = '2';
const UNDERLINE = '4';

/**
 * Hue codes for non-debug levels, combined with BOLD so info/warn/error lines
 * appear visually heavier than dim debug lines.
 */
const LEVEL_HUE: Record<Exclude<LogLevel, 'debug'>, string> = {
  info: '96', // bright cyan
  warn: '93', // bright yellow
  error: '91', // bright red
};

/**
 * Per-stage hue codes for debug lines. Each pipeline stage gets a distinct
 * color so panel / judge / synthesis calls are immediately distinguishable.
 */
const STAGE_HUE: { [stage: string]: string | undefined } = {
  panel: '32', // green
  judge: '35', // magenta
  synthesis: '34', // blue
  agent: '36', // cyan
};

/** Fallback hue for debug lines that carry no stage (e.g. judge_skipped). */
const DEFAULT_DEBUG_HUE = '37'; // white

/** Build a single ANSI SGR escape from one or more attribute/color codes. */
function sgr(...codes: string[]): string {
  return `\x1b[${codes.join(';')}m`;
}

/**
 * Select the ANSI color sequence for a log line.
 *
 * - Non-debug: bold + level hue → visually heavier than debug lines.
 * - Debug: dim + stage hue (panel/judge/synthesis/agent) → lighter than info,
 *   each stage a distinct color. Response lines additionally carry underline so
 *   request and response are distinguishable at a glance.
 */
function selectColor(level: LogLevel, payload: Record<string, unknown>): string {
  if (level !== 'debug') return sgr(BOLD, LEVEL_HUE[level]);
  const stage = typeof payload.stage === 'string' ? payload.stage : undefined;
  const hue = (stage !== undefined ? STAGE_HUE[stage] : undefined) ?? DEFAULT_DEBUG_HUE;
  const attrs = [DIM, hue];
  if (payload.event === 'response') attrs.push(UNDERLINE);
  return sgr(...attrs);
}

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
    const out = this.useColor ? `${selectColor(level, payload)}${line}${RESET}` : line;
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
        ...(usage.cachedPromptTokens !== undefined ? { cached: usage.cachedPromptTokens } : {}),
        ...(usage.cacheWritePromptTokens !== undefined
          ? { cacheWrite: usage.cacheWritePromptTokens }
          : {}),
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
