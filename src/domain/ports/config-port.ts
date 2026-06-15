import type { ModelRef } from '../model/fusion-types.js';

export interface ConfigPort {
  getPanelModels(): ModelRef[];
  getJudgeModel(): ModelRef | null;
  getSynthesizerModel(): ModelRef;
  getTimeoutMs(): number;
}
