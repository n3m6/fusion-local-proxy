import type { FusionService } from '../ports/fusion-service.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { ChatRequest } from '../../domain/model/chat-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';

export class RunFusionUseCase implements FusionService {
  constructor(
    private readonly chatModelPort: ChatModelPort,
    private readonly configPort: ConfigPort,
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async *runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent> {
    const stage = 'passthrough';
    const startTime = this.clockPort.now();

    this.loggerPort.logStageStart(stage);

    const panelModels = this.configPort.getPanelModels();
    if (panelModels.length === 0) {
      throw new Error('At least one panel model is required for passthrough mode');
    }

    const panelModel = panelModels[0];

    const chatRequest: ChatRequest = {
      messages: request.messages,
      model: panelModel,
      options: request.options,
    };

    let response;
    try {
      response = await this.chatModelPort.complete(chatRequest);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.loggerPort.logError(stage, error);
      throw err;
    }

    yield {
      type: 'content_delta',
      delta: response.content,
    };

    yield {
      type: 'content_stop',
    };

    yield {
      type: 'done',
      usage: response.usage,
      failedModels: [],
      model: response.model,
    };

    const endTime = this.clockPort.now();
    const durationMs = endTime - startTime;
    this.loggerPort.logStageEnd(stage, durationMs, response.usage);
  }
}
