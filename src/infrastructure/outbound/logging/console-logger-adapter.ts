import type { LoggerPort } from '../../../domain/ports/logger-port.js';
import type { TokenUsage } from '../../../domain/model/chat-types.js';
import type { FailedModelInfo } from '../../../domain/model/stream-types.js';

export class ConsoleLoggerAdapter implements LoggerPort {
  logStageStart(stage: string): void {
    console.log(JSON.stringify({ stage, event: 'start' }));
  }

  logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void {
    console.log(
      JSON.stringify({
        stage,
        event: 'end',
        durationMs,
        tokens: usage ?? undefined,
      }),
    );
  }

  logFailedModels(models: FailedModelInfo[]): void {
    console.log(JSON.stringify({ event: 'failed_models', models }));
  }

  logError(stage: string, error: Error): void {
    console.log(JSON.stringify({ stage, event: 'error', error: error.message }));
  }
}
