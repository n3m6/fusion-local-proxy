import type { Message } from '../../domain/model/message.js';
import type { ModelRef, PanelMeta, PanelResult } from '../../domain/model/fusion-types.js';
import type { ChatRequest, ChatResponse } from '../../domain/model/chat-types.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { FailedModelInfo } from '../../domain/model/stream-types.js';
import { FusionError } from '../../domain/model/fusion-types.js';

interface TaskResult {
  status: 'fulfilled' | 'rejected';
  value?: ChatResponse;
  reason?: unknown;
  modelRef: ModelRef;
  latencyMs: number;
}

export class PanelRunner {
  constructor(
    private readonly chatPorts: ChatModelPort[],
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async run(
    messages: Message[],
    panelModels: ModelRef[],
    timeoutMs: number,
  ): Promise<PanelMeta> {
    if (panelModels.length === 0) {
      return { results: [], failedModels: [] };
    }

    const tasks = panelModels.map((modelRef, i) => {
      const request: ChatRequest = {
        messages,
        model: modelRef,
        options: { signal: AbortSignal.timeout(timeoutMs) },
      };

      const startTime = this.clockPort.now();

      return this.chatPorts[i].complete(request).then(
        (value): TaskResult => ({
          status: 'fulfilled',
          value,
          modelRef,
          latencyMs: this.clockPort.now() - startTime,
        }),
        (reason): TaskResult => ({
          status: 'rejected',
          reason,
          modelRef,
          latencyMs: this.clockPort.now() - startTime,
        }),
      );
    });

    const settled = await Promise.all(tasks);

    const results: PanelResult[] = [];
    const failedModels: FailedModelInfo[] = [];

    for (const task of settled) {
      if (task.status === 'fulfilled' && task.value) {
        results.push({
          modelId: task.modelRef.model,
          provider: task.modelRef.provider,
          content: task.value.content,
          usage: {
            promptTokens: task.value.usage.promptTokens,
            completionTokens: task.value.usage.completionTokens,
          },
          latencyMs: task.latencyMs,
        });
      } else {
        const reason = task.reason;
        failedModels.push({
          modelId: task.modelRef.model,
          errorCode: reason instanceof FusionError
            ? reason.code
            : (reason as { constructor?: { name?: string } })?.constructor?.name ?? 'UNKNOWN',
          errorMessage: String((reason as { message?: unknown })?.message ?? reason ?? '').slice(0, 200),
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
