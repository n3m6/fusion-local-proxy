import type { ModelRef } from '../model/fusion-types.js';

export interface ConfigPort {
  getPanelModels(): ModelRef[];
  getJudgeModel(): ModelRef | null;
  getSynthesizerModel(): ModelRef;
  getTimeoutMs(): number;
  /** Returns the resolved model for agent/tool-calling requests. Falls back to the first panel
   *  model (stripped of thinkingMode/thinkingStrength) when no dedicated `agent` role is configured.
   *  Returns null when no openai-type model can be resolved. */
  getAgentModel(): ModelRef | null;
  /** Returns the resolved model for /v1/completions (FIM autocomplete). Falls back to the first
   *  panel model (stripped of thinkingMode/thinkingStrength) when no dedicated `autocomplete` role
   *  is configured. Returns null when no openai-type model can be resolved. */
  getAutocompleteModel(): ModelRef | null;
}
