import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';

export interface AgentService {
  /**
   * @param requestId Optional correlation id. When supplied (e.g. by a wrapping
   *   agent that also logs routing decisions), it is reused for all log lines so
   *   the whole agent run shares one id; otherwise a fresh id is generated.
   */
  runAgent(request: FusionRequest, requestId?: string): AsyncIterable<FusionStreamEvent>;
}
