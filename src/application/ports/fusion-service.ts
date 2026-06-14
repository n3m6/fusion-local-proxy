import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';

export interface FusionService {
  runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent>;
}
