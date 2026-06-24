import type { Message } from '../../domain/model/message.js';
import { promptChars } from '../../domain/model/message.js';
import type { ModelRef, PanelMeta, PanelResult } from '../../domain/model/fusion-types.js';
import { applyThinkingMode } from '../../domain/services/thinking-modes.js';
import type {
  ChatRequest,
  ChatResponse,
  TokenUsage,
  Sampling,
} from '../../domain/model/chat-types.js';
import { samplingToOptions, createTimeoutSignal } from '../../domain/model/chat-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { FailedModelInfo } from '../../domain/model/stream-types.js';
import { FusionError } from '../../domain/model/fusion-types.js';

const ERROR_MESSAGE_LOG_LIMIT = 200;

export interface PanelPair {
  modelRef: ModelRef;
  port: ChatModelPort;
}

export class PanelRunner {
  constructor(
    private readonly pairs: PanelPair[],
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async run(
    messages: Message[],
    timeoutMs: number,
    requestId?: string,
    sampling?: Sampling,
  ): Promise<PanelMeta> {
    if (this.pairs.length === 0) {
      return {
        results: [],
        failedModels: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    this.loggerPort.logStageStart('panel');
    const stageStart = this.clockPort.now();

    const signal = createTimeoutSignal(timeoutMs);
    const tasks = this.pairs.map(({ modelRef, port }, i) => {
      // Stable per-panelist label keeps completion-order logs attributable even
      // when several panelists share the same modelId.
      const label = `panel-${i}`;
      const pairMessages = applyThinkingMode(messages, modelRef.thinkingMode);
      const request: ChatRequest = {
        messages: pairMessages,
        model: modelRef,
        options: {
          ...(signal !== undefined ? { signal } : {}),
          requestId,
          stage: 'panel',
          label,
          ...samplingToOptions(sampling),
        },
      };
      this.loggerPort.logRequest({
        requestId,
        stage: 'panel',
        label,
        provider: modelRef.provider,
        modelId: modelRef.model,
        messageCount: pairMessages.length,
        promptChars: promptChars(pairMessages),
        ...(modelRef.thinkingMode !== undefined ? { thinkingMode: modelRef.thinkingMode } : {}),
      });
      const startTime = this.clockPort.now();
      return port
        .complete(request)
        .then((value: ChatResponse): { value: ChatResponse; latencyMs: number } => ({
          value,
          latencyMs: this.clockPort.now() - startTime,
        }));
    });

    const settled = await Promise.allSettled(tasks);

    const results: PanelResult[] = [];
    const failedModels: FailedModelInfo[] = [];

    for (let i = 0; i < settled.length; i++) {
      const settlement = settled[i]!;
      const { modelRef } = this.pairs[i]!;

      if (settlement.status === 'fulfilled') {
        const { value, latencyMs } = settlement.value;
        results.push({
          modelId: modelRef.model,
          provider: modelRef.provider,
          content: value.content,
          usage: {
            promptTokens: value.usage.promptTokens,
            completionTokens: value.usage.completionTokens,
            ...(value.usage.reasoningTokens !== undefined
              ? { reasoningTokens: value.usage.reasoningTokens }
              : {}),
            ...(value.usage.cachedPromptTokens !== undefined
              ? { cachedPromptTokens: value.usage.cachedPromptTokens }
              : {}),
            ...(value.usage.cacheWritePromptTokens !== undefined
              ? { cacheWritePromptTokens: value.usage.cacheWritePromptTokens }
              : {}),
          },
          latencyMs,
        });
      } else {
        const reason = settlement.reason;
        failedModels.push({
          modelId: modelRef.model,
          errorCode:
            reason instanceof FusionError
              ? reason.code
              : ((reason as { constructor?: { name?: string } })?.constructor?.name ?? 'UNKNOWN'),
          errorMessage: String((reason as { message?: unknown })?.message ?? reason ?? '').slice(
            0,
            ERROR_MESSAGE_LOG_LIMIT,
          ),
        });
      }
    }

    if (failedModels.length > 0) {
      this.loggerPort.logFailedModels(failedModels);
    }

    if (results.length === 0) {
      this.loggerPort.logStageEnd('panel', this.clockPort.now() - stageStart);
      throw new FusionError('all_panels_failed', 'All panel models failed', { failedModels });
    }

    let promptTokens = 0;
    let completionTokens = 0;
    let reasoningTokens = 0;
    let cachedPromptTokens = 0;
    let cacheWritePromptTokens = 0;
    let anyReasoning = false;
    let anyCached = false;
    let anyCacheWrite = false;
    for (const result of results) {
      promptTokens += result.usage.promptTokens;
      completionTokens += result.usage.completionTokens;
      if (result.usage.reasoningTokens !== undefined) {
        anyReasoning = true;
        reasoningTokens += result.usage.reasoningTokens;
      }
      if (result.usage.cachedPromptTokens !== undefined) {
        anyCached = true;
        cachedPromptTokens += result.usage.cachedPromptTokens;
      }
      if (result.usage.cacheWritePromptTokens !== undefined) {
        anyCacheWrite = true;
        cacheWritePromptTokens += result.usage.cacheWritePromptTokens;
      }
    }

    const aggregateUsage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      ...(anyReasoning ? { reasoningTokens } : {}),
      ...(anyCached ? { cachedPromptTokens } : {}),
      ...(anyCacheWrite ? { cacheWritePromptTokens } : {}),
    };

    this.loggerPort.logStageEnd('panel', this.clockPort.now() - stageStart, aggregateUsage);

    return { results, failedModels, usage: aggregateUsage };
  }
}
