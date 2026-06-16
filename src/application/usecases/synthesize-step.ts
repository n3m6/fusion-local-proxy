import type { Message } from '../../domain/model/message.js';
import type { PanelResult } from '../../domain/model/fusion-types.js';
import type { ChatRequest, TokenUsage, Sampling } from '../../domain/model/chat-types.js';
import { samplingToOptions, createTimeoutSignal } from '../../domain/model/chat-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { Analysis } from '../../domain/services/analysis-schema.js';
import {
  buildSynthesisSystemPrompt,
  buildSynthesisUserPrompt,
} from '../../domain/services/synthesis-prompt.js';

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
    requestId?: string,
    sampling?: Sampling,
  ): AsyncIterable<FusionStreamEvent> {
    const synthesizerModel = this.configPort.getSynthesizerModel();
    const timeoutMs = this.configPort.getTimeoutMs();

    // The controller provides cleanup-abort (fired in finally when the generator
    // is abandoned mid-stream). The timeout signal is wired in via an event
    // listener so both reasons abort the same controller signal.
    const controller = new AbortController();
    const timeoutSignal = createTimeoutSignal(timeoutMs);
    if (timeoutSignal !== undefined) {
      timeoutSignal.addEventListener('abort', () => controller.abort(timeoutSignal.reason), {
        once: true,
      });
    }

    try {
      const systemPrompt = buildSynthesisSystemPrompt();
      const userPrompt = buildSynthesisUserPrompt(panelResults, originalMessages, analysis);

      const request: ChatRequest = {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model: synthesizerModel,
        options: {
          signal: controller.signal,
          requestId,
          stage: 'synthesis',
          ...samplingToOptions(sampling),
        },
      };

      this.loggerPort.logStageStart('synthesis');
      this.loggerPort.logRequest({
        requestId,
        stage: 'synthesis',
        provider: synthesizerModel.provider,
        modelId: synthesizerModel.model,
        panelCount: panelResults.length,
        analysisPresent: analysis !== null,
        systemPromptChars: systemPrompt.length,
        userPromptChars: userPrompt.length,
      });
      const startTime = this.clockPort.now();

      let usage: TokenUsage | undefined;
      let deltaCount = 0;
      let contentChars = 0;
      let ttftMs: number | undefined;

      try {
        for await (const chunk of this.chatPort.stream(request)) {
          if (chunk.type === 'content_delta') {
            if (ttftMs === undefined) {
              ttftMs = this.clockPort.now() - startTime;
            }
            deltaCount++;
            contentChars += chunk.delta.length;
            yield { type: 'content_delta', delta: chunk.delta };
          } else if (chunk.type === 'content_stop') {
            yield { type: 'content_stop' };
          } else if (chunk.type === 'usage') {
            usage = chunk.usage;
          }
        }
      } catch (error) {
        this.loggerPort.logError(
          'synthesis',
          error instanceof Error ? error : new Error(String(error)),
          {
            requestId,
            modelId: synthesizerModel.model,
            latencyMs: this.clockPort.now() - startTime,
          },
        );
        throw error;
      }

      const durationMs = this.clockPort.now() - startTime;
      this.loggerPort.logResponse({
        requestId,
        stage: 'synthesis',
        provider: synthesizerModel.provider,
        modelId: synthesizerModel.model,
        latencyMs: durationMs,
        ttftMs,
        deltaCount,
        contentChars,
        ...(usage
          ? {
              tokens: {
                prompt: usage.promptTokens,
                completion: usage.completionTokens,
                total: usage.totalTokens,
              },
            }
          : {}),
      });
      if (usage) {
        this.loggerPort.logStageEnd('synthesis', durationMs, usage);
      } else {
        this.loggerPort.logStageEnd('synthesis', durationMs);
      }

      yield {
        type: 'done',
        ...(usage ? { usage } : {}),
        model: synthesizerModel.model,
      };
    } finally {
      controller.abort();
    }
  }
}
