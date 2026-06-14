import type { FusionService } from '../ports/fusion-service.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { ChatRequest } from '../../domain/model/chat-types.js';
import type { ChatResponse } from '../../domain/model/chat-types.js';
import type { Message } from '../../domain/model/message.js';

export class RunFusionUseCase implements FusionService {
  constructor(
    private readonly chatModelPort: ChatModelPort,
    private readonly configPort: ConfigPort,
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async *runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent> {
    // 1. Resolve the synthesizer model
    const synthesizerModel = this.configPort.getSynthesizerModel();

    // 2. Log stage start and capture start time
    this.loggerPort.logStageStart('synthesis');
    const startTime = this.clockPort.now();

    // 3. Build the ChatRequest
    const messages: Message[] = request.systemPrompt
      ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
      : [...request.messages];

    const options: { temperature?: number; maxTokens?: number } = {
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    };

    const chatRequest: ChatRequest = {
      messages,
      model: synthesizerModel,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };

    // 4. Call the model
    const response: ChatResponse = await this.chatModelPort.complete(chatRequest);

    // 5. Compute duration and log
    const durationMs = this.clockPort.now() - startTime;
    this.loggerPort.logStageEnd('synthesis', durationMs, response.usage);

    // 6. Yield content event
    yield {
      type: 'content_delta' as const,
      delta: response.content,
    };

    // 7. Yield done event
    yield {
      type: 'done' as const,
      usage: response.usage,
    };
  }
}
