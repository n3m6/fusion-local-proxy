import type { TokenUsage } from '../model/chat-types.js';
import type { FailedModelInfo } from '../model/stream-types.js';

export interface LoggerPort {
  logStageStart(stage: string): void;
  logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void;
  logFailedModels(models: FailedModelInfo[]): void;
  logError(stage: string, error: Error): void;
}
