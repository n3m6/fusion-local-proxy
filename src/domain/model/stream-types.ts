import type { TokenUsage } from './chat-types.js';

export type FusionStreamEvent =
  | { readonly type: 'progress'; readonly stage: string; readonly message: string }
  | { readonly type: 'content_delta'; readonly delta: string }
  | { readonly type: 'content_stop' }
  | {
      readonly type: 'done';
      readonly usage?: TokenUsage;
      readonly failedModels?: FailedModelInfo[];
      readonly model?: string;
    }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
      readonly details?: unknown;
    };

export interface FailedModelInfo {
  readonly modelId: string;
  readonly errorCode: string;
  readonly errorMessage: string;
}
