import type { Message } from '../../domain/model/message.js';
import type { ModelRef, PanelMeta, PanelResult } from '../../domain/model/fusion-types.js';
import type { ChatRequest, ChatResponse } from '../../domain/model/chat-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { FailedModelInfo } from '../../domain/model/stream-types.js';
import { FusionError } from '../../domain/model/fusion-types.js';

export class PanelRunner {
  constructor(
    private readonly chatPorts: ChatModelPort[],
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async run(messages: Message[], panelModels: ModelRef[], timeoutMs: number): Promise<PanelMeta> {
    if (panelModels.length === 0) {
      return { results: [], failedModels: [] };
    }

    // Start times are read synchronously in map() to preserve clock ordering.
    // Each task resolves to { value, latencyMs } so Promise.allSettled receives
    // settled results for both successes and failures.
    const tasks = panelModels.map((modelRef, i) => {
      const request: ChatRequest = {
        messages,
        model: modelRef,
        options: { signal: AbortSignal.timeout(timeoutMs) },
      };
      const startTime = this.clockPort.now();
      return this.chatPorts[i]
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
      const modelRef = panelModels[i]!;

      if (settlement.status === 'fulfilled') {
        const { value, latencyMs } = settlement.value;
        results.push({
          modelId: modelRef.model,
          provider: modelRef.provider,
          content: value.content,
          usage: {
            promptTokens: value.usage.promptTokens,
            completionTokens: value.usage.completionTokens,
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
            200,
          ),
        });
      }
    }

    if (failedModels.length > 0) {
      this.loggerPort.logFailedModels(failedModels);
    }

    if (results.length === 0) {
      throw new FusionError('all_panels_failed', 'All panel models failed', { failedModels });
    }

    for (const result of results) {
      this.loggerPort.logStageEnd('panel', result.latencyMs, {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.promptTokens + result.usage.completionTokens,
      });
    }

    return { results, failedModels };
  }
}
