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
import { FusionError } from '../../domain/model/fusion-types.js';
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
      const selfJudge = this.configPort.getJudgeModel() === null;
      const promptOptions = { selfJudge };
      const systemPrompt = buildSynthesisSystemPrompt(promptOptions);
      const userPrompt = buildSynthesisUserPrompt(
        panelResults,
        originalMessages,
        analysis,
        promptOptions,
      );

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
        selfJudge,
        systemPromptChars: systemPrompt.length,
        userPromptChars: userPrompt.length,
      });
      const startTime = this.clockPort.now();

      let usage: TokenUsage | undefined;
      let lastReasoningProgressMs: number | undefined;

      try {
        for await (const chunk of this.chatPort.stream(request)) {
          if (chunk.type === 'content_delta') {
            yield { type: 'content_delta', delta: chunk.delta };
          } else if (chunk.type === 'content_stop') {
            yield { type: 'content_stop' };
          } else if (chunk.type === 'usage') {
            usage = chunk.usage;
          } else if (chunk.type === 'reasoning_progress') {
            const now = this.clockPort.now();
            if (lastReasoningProgressMs === undefined || now - lastReasoningProgressMs >= 1000) {
              lastReasoningProgressMs = now;
              yield { type: 'progress', stage: 'synthesis', message: 'evaluating candidates' };
            }
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
      if (usage) {
        this.loggerPort.logStageEnd('synthesis', durationMs, usage);
      } else {
        this.loggerPort.logStageEnd('synthesis', durationMs);
      }

      if (timeoutSignal?.aborted) {
        this.loggerPort.logError(
          'synthesis',
          new FusionError('synthesis_truncated', 'Synthesis stream aborted by timeout'),
          { requestId, modelId: synthesizerModel.model },
        );
        yield {
          type: 'error',
          code: 'synthesis_truncated',
          message: 'Synthesis stream aborted by timeout',
        };
        return;
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
