import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';

export interface AgentService {
  runAgent(request: FusionRequest): AsyncIterable<FusionStreamEvent>;
}
