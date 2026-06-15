import type { Message } from '../../domain/model/message.js';
import type { ModelRef, PanelResult } from '../../domain/model/fusion-types.js';
import type { ChatRequest } from '../../domain/model/chat-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { Analysis } from '../../domain/services/analysis-schema.js';
import { buildSynthesisSystemPrompt, buildSynthesisUserPrompt } from '../../domain/services/synthesis-prompt.js';

export class SynthesizeStep {
  constructor(
    private readonly chatPort: ChatModelPort,
    private readonly configPort: ConfigPort,
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async *synthesize(
    panelResults: PanelResult[],
    originalMessages: Message[],
    analysis: Analysis | null,
  ): AsyncIterable<FusionStreamEvent> {
    const synthesizerModel = this.configPort.getSynthesizerModel();
    const timeoutMs = this.configPort.getTimeoutMs();

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }

      const systemPrompt = buildSynthesisSystemPrompt();
      const userPrompt = buildSynthesisUserPrompt(panelResults, originalMessages, analysis);

      const request: ChatRequest = {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model: synthesizerModel,
        options: { signal: controller.signal },
      };

      this.loggerPort.logStageStart('synthesis');
      const startTime = this.clockPort.now();

      const response = await this.chatPort.complete(request);

      const durationMs = this.clockPort.now() - startTime;
      this.loggerPort.logStageEnd('synthesis', durationMs, response.usage);

      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }

      yield { type: 'content_delta', delta: response.content };
      yield { type: 'content_stop' };
      yield { type: 'done', usage: response.usage, model: synthesizerModel.model };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      controller.abort();
    }
  }
}
