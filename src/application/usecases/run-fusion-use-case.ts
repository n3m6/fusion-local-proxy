import { randomUUID } from 'node:crypto';
import type { FusionService } from '../ports/fusion-service.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { FusionRequest, PanelMeta, PanelResult } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { TokenUsage, Sampling } from '../../domain/model/chat-types.js';
import type { Message } from '../../domain/model/message.js';
import type { Analysis } from '../../domain/services/analysis-schema.js';
import { PanelRunner } from './panel-runner.js';
import { JudgeStep } from './judge-step.js';
import { SynthesizeStep } from './synthesize-step.js';

interface UsageSummary {
  totalTokens: number;
  tokensByStage: {
    panel: { total: number; reasoning: number };
    judge: { total: number; reasoning: number };
    synthesis: { total: number; reasoning: number };
  };
  cost: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    uncachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    reEncodedPanelTokens: number;
  };
}

function summarizeUsage(
  panelMeta: PanelMeta,
  judgeUsage: TokenUsage | undefined,
  synthUsage: TokenUsage | undefined,
): UsageSummary {
  const panelTokens = panelMeta.usage.totalTokens;
  const judgeTokens = judgeUsage?.totalTokens ?? 0;
  const synthTokens = synthUsage?.totalTokens ?? 0;

  const panelReasoning = panelMeta.usage.reasoningTokens ?? 0;
  const judgeReasoning = judgeUsage?.reasoningTokens ?? 0;
  const synthReasoning = synthUsage?.reasoningTokens ?? 0;

  // Cost-honest breakdown: reasoning tokens are a billed-but-invisible subset
  // of output, and the panel's output is re-encoded as synthesis input (panel
  // responses are embedded in the synthesizer prompt), so it is paid for twice.
  const inputTokens =
    panelMeta.usage.promptTokens +
    (judgeUsage?.promptTokens ?? 0) +
    (synthUsage?.promptTokens ?? 0);
  const outputTokens =
    panelMeta.usage.completionTokens +
    (judgeUsage?.completionTokens ?? 0) +
    (synthUsage?.completionTokens ?? 0);

  // Cache-tier split: sum across all three stages. Fields are omitted on
  // providers that do not report them, so absent means 0 for aggregation.
  const cachedInputTokens =
    (panelMeta.usage.cachedPromptTokens ?? 0) +
    (judgeUsage?.cachedPromptTokens ?? 0) +
    (synthUsage?.cachedPromptTokens ?? 0);
  const cacheWriteInputTokens =
    (panelMeta.usage.cacheWritePromptTokens ?? 0) +
    (judgeUsage?.cacheWritePromptTokens ?? 0) +
    (synthUsage?.cacheWritePromptTokens ?? 0);
  const uncachedInputTokens = inputTokens - cachedInputTokens - cacheWriteInputTokens;

  return {
    totalTokens: panelTokens + judgeTokens + synthTokens,
    tokensByStage: {
      panel: { total: panelTokens, reasoning: panelReasoning },
      judge: { total: judgeTokens, reasoning: judgeReasoning },
      synthesis: { total: synthTokens, reasoning: synthReasoning },
    },
    cost: {
      inputTokens,
      cachedInputTokens,
      cacheWriteInputTokens,
      uncachedInputTokens,
      outputTokens,
      reasoningTokens: panelReasoning + judgeReasoning + synthReasoning,
      reEncodedPanelTokens: panelMeta.usage.completionTokens,
    },
  };
}

const HEARTBEAT_INTERVAL_MS = 10_000;

export class RunFusionUseCase implements FusionService {
  constructor(
    private readonly panelRunner: PanelRunner,
    private readonly judgeStep: JudgeStep | null,
    private readonly synthesizeStep: SynthesizeStep,
    private readonly configPort: ConfigPort,
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
    private readonly heartbeatIntervalMs: number = HEARTBEAT_INTERVAL_MS,
  ) {}

  async *runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent> {
    const panelCount = this.configPort.getPanelModels().length;
    const timeoutMs = this.configPort.getTimeoutMs();
    const requestId = randomUUID();
    const runStart = this.clockPort.now();
    const messages = this.buildMessages(request);
    const sampling = this.buildSampling(request);

    this.loggerPort.log('info', 'fusion_run_start', {
      requestId,
      messageCount: messages.length,
      panelCount,
      judgeConfigured: this.judgeStep !== null,
      synthesizerModel: this.configPort.getSynthesizerModel().model,
      timeoutMs,
    });

    const panelMeta: PanelMeta = yield* this.runPanel(messages, timeoutMs, requestId, sampling);

    const { analysis, judgeUsage } = yield* this.runJudge(
      panelMeta.results,
      messages,
      timeoutMs,
      requestId,
    );

    const {
      usage: synthUsage,
      model: synthModel,
      synthError,
    } = yield* this.runSynthesis(panelMeta.results, messages, analysis, requestId, sampling);

    const usageSummary = summarizeUsage(panelMeta, judgeUsage, synthUsage);

    this.loggerPort.log('info', 'fusion_run_end', {
      requestId,
      durationMs: this.clockPort.now() - runStart,
      panelSuccessCount: panelMeta.results.length,
      failedModelCount: panelMeta.failedModels.length,
      analysisProduced: analysis !== null,
      outcome: synthError ? synthError.code : 'success',
      ...(synthModel ? { synthesizerModel: synthModel } : {}),
      ...usageSummary,
    });

    if (synthError) {
      yield synthError;
      return;
    }

    yield {
      type: 'done',
      failedModels: panelMeta.failedModels,
      ...(synthUsage ? { usage: synthUsage } : {}),
      ...(synthModel ? { model: synthModel } : {}),
    };
  }

  private buildMessages(request: FusionRequest): Message[] {
    return request.systemPrompt
      ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
      : [...request.messages];
  }

  private buildSampling(request: FusionRequest): Sampling {
    return {
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
      ...(request.topK !== undefined ? { topK: request.topK } : {}),
      ...(request.stopSequences !== undefined ? { stopSequences: request.stopSequences } : {}),
      ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
    };
  }

  private async *runPanel(
    messages: Message[],
    timeoutMs: number,
    requestId: string,
    sampling: Sampling,
  ): AsyncGenerator<FusionStreamEvent, PanelMeta> {
    const panelMeta: PanelMeta = yield* this.withHeartbeat(
      this.panelRunner.run(messages, timeoutMs, requestId, sampling),
      { type: 'progress', stage: 'panel', message: 'panel running' },
    );
    yield { type: 'progress', stage: 'panel', message: 'Panel stage complete' };
    return panelMeta;
  }

  private async *runJudge(
    panelResults: PanelResult[],
    messages: Message[],
    timeoutMs: number,
    requestId: string,
  ): AsyncGenerator<
    FusionStreamEvent,
    { analysis: Analysis | null; judgeUsage: TokenUsage | undefined }
  > {
    let analysis: Analysis | null = null;
    let judgeUsage: TokenUsage | undefined;
    if (this.judgeStep !== null) {
      const judgeResult = yield* this.withHeartbeat(
        this.judgeStep.analyze(panelResults, messages, timeoutMs, requestId),
        { type: 'progress', stage: 'judge', message: 'judge running' },
      );
      analysis = judgeResult.analysis;
      judgeUsage = judgeResult.usage;
    } else {
      this.loggerPort.log('debug', 'judge_skipped', { requestId });
    }
    yield { type: 'progress', stage: 'judge', message: 'Judge stage complete' };
    return { analysis, judgeUsage };
  }

  private async *runSynthesis(
    panelResults: PanelResult[],
    messages: Message[],
    analysis: Analysis | null,
    requestId: string,
    sampling: Sampling,
  ): AsyncGenerator<
    FusionStreamEvent,
    {
      usage: TokenUsage | undefined;
      model: string | undefined;
      synthError: (FusionStreamEvent & { type: 'error' }) | undefined;
    }
  > {
    let usage: TokenUsage | undefined;
    let model: string | undefined;
    let synthError: (FusionStreamEvent & { type: 'error' }) | undefined;

    for await (const event of this.withStreamHeartbeat(
      this.synthesizeStep.synthesize(panelResults, messages, analysis, requestId, sampling),
      { type: 'progress', stage: 'synthesis', message: 'synthesizing' },
    )) {
      if (event.type === 'content_delta') {
        yield { type: 'content_delta', delta: event.delta };
      } else if (event.type === 'content_stop') {
        yield { type: 'content_stop' };
      } else if (event.type === 'progress') {
        yield event;
      } else if (event.type === 'done') {
        usage = event.usage;
        model = event.model;
      } else if (event.type === 'error') {
        synthError = event;
        break;
      }
    }

    return { usage, model, synthError };
  }

  private async *withHeartbeat<T>(
    work: Promise<T>,
    ev: FusionStreamEvent,
  ): AsyncGenerator<FusionStreamEvent, T> {
    let done = false;
    const tracked = work.finally(() => {
      done = true;
    });
    while (!done) {
      let t: ReturnType<typeof setTimeout>;
      const tick = new Promise<void>((r) => {
        t = setTimeout(r, this.heartbeatIntervalMs);
      });
      await Promise.race([tracked.catch(() => undefined), tick]);
      clearTimeout(t!);
      if (!done) yield ev;
    }
    return await tracked;
  }

  private async *withStreamHeartbeat(
    iterable: AsyncIterable<FusionStreamEvent>,
    ev: FusionStreamEvent,
  ): AsyncGenerator<FusionStreamEvent> {
    const it = iterable[Symbol.asyncIterator]();
    let pending: Promise<IteratorResult<FusionStreamEvent>> = it.next();
    try {
      while (true) {
        let t: ReturnType<typeof setTimeout>;
        const tick = new Promise<void>((resolve) => {
          t = setTimeout(resolve, this.heartbeatIntervalMs);
        });
        const won = await Promise.race([
          pending.then((r): { tag: 'iter'; result: IteratorResult<FusionStreamEvent> } => ({
            tag: 'iter',
            result: r,
          })),
          tick.then((): { tag: 'tick' } => ({ tag: 'tick' })),
        ]);
        clearTimeout(t!);
        if (won.tag === 'tick') {
          yield ev;
        } else {
          if (won.result.done) break;
          yield won.result.value;
          pending = it.next();
        }
      }
    } finally {
      await it.return?.();
    }
  }
}
