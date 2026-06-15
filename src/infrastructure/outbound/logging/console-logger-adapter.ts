import type { LoggerPort } from '../../../domain/ports/logger-port.js';
import type { TokenUsage } from '../../../domain/model/chat-types.js';
import type { FailedModelInfo } from '../../../domain/model/stream-types.js';

export class ConsoleLoggerAdapter implements LoggerPort {
  logStageStart(stage: string): void {
    console.log(JSON.stringify({ stage, event: 'start' }));
  }

  logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void {
    const payload: Record<string, unknown> = {
      stage,
      event: 'end',
      durationMs,
    };
    if (usage) {
      payload.tokens = {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        total: usage.totalTokens,
      };
    }
    console.log(JSON.stringify(payload));
  }

  logFailedModels(models: FailedModelInfo[]): void {
    for (const m of models) {
      console.log(
        JSON.stringify({
          event: 'failed_model',
          modelId: m.modelId,
          errorCode: m.errorCode,
          errorMessage: m.errorMessage,
        }),
      );
    }
  }

  logError(stage: string, error: Error): void {
    console.log(JSON.stringify({ stage, event: 'error', message: error.message }));
  }
}
