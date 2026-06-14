import type { TokenUsage } from './chat-types.js';

export interface FailedModelInfo {
  model: string;
  reason: string;
}

export type FusionStreamEvent =
  | { type: 'progress'; stage: string; message: string }
  | { type: 'content_delta'; delta: string }
  | { type: 'content_stop' }
  | { type: 'done'; usage: TokenUsage; failedModels: FailedModelInfo[]; model?: string }
  | { type: 'error'; code: string; message: string; details?: unknown };
