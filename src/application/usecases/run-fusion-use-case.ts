import { randomUUID } from 'node:crypto';
import type { FusionService } from '../ports/fusion-service.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { FusionRequest, PanelMeta, PanelResult } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { TokenUsage } from '../../domain/model/chat-types.js';
import type { Message } from '../../domain/model/message.js';
import type { Analysis } from '../../domain/services/analysis-schema.js';
import { PanelRunner } from './panel-runner.js';
import { JudgeStep } from './judge-step.js';
import { SynthesizeStep } from './synthesize-step.js';

const HEARTBEAT_INTERVAL_MS = 10_000;

type Sampling = {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  metadata?: { readonly user_id?: string | null };
};

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

    const panelMeta: PanelMeta = yield* this.runPanel(
      messages,
      timeoutMs,
      requestId,
      sampling,
    );

    const analysis: Analysis | null = yield* this.runJudge(
      panelMeta.results,
      messages,
      timeoutMs,
      requestId,
    );

    const { usage: synthUsage, model: synthModel } = yield* this.runSynthesis(
      panelMeta.results,
      messages,
      analysis,
      requestId,
      sampling,
    );

    this.loggerPort.log('info', 'fusion_run_end', {
      requestId,
      durationMs: this.clockPort.now() - runStart,
      panelSuccessCount: panelMeta.results.length,
      failedModelCount: panelMeta.failedModels.length,
      analysisProduced: analysis !== null,
      ...(synthModel ? { synthesizerModel: synthModel } : {}),
      ...(synthUsage ? { totalTokens: synthUsage.totalTokens } : {}),
    });

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
  ): AsyncGenerator<FusionStreamEvent, Analysis | null> {
    let analysis: Analysis | null = null;
    // Gate on a single runtime read of the judge model so the decision and the
    // value share one source of truth. Both the injected step and a configured
    // model must be present; if they ever disagree the judge is skipped rather
    // than crashing on a null model ref passed into analyze().
    const judgeModel = this.configPort.getJudgeModel();
    if (this.judgeStep !== null && judgeModel !== null) {
      analysis = yield* this.withHeartbeat(
        this.judgeStep.analyze(panelResults, messages, judgeModel, timeoutMs, requestId),
        { type: 'progress', stage: 'judge', message: 'judge running' },
      );
    } else {
      this.loggerPort.log('debug', 'judge_skipped', { requestId });
    }
    yield { type: 'progress', stage: 'judge', message: 'Judge stage complete' };
    return analysis;
  }

  private async *runSynthesis(
    panelResults: PanelResult[],
    messages: Message[],
    analysis: Analysis | null,
    requestId: string,
    sampling: Sampling,
  ): AsyncGenerator<FusionStreamEvent, { usage: TokenUsage | undefined; model: string | undefined }> {
    let usage: TokenUsage | undefined;
    let model: string | undefined;

    for await (const event of this.synthesizeStep.synthesize(
      panelResults,
      messages,
      analysis,
      requestId,
      sampling,
    )) {
      if (event.type === 'content_delta') {
        yield { type: 'content_delta', delta: event.delta };
      } else if (event.type === 'content_stop') {
        yield { type: 'content_stop' };
      } else if (event.type === 'done') {
        usage = event.usage;
        model = event.model;
      }
    }

    return { usage, model };
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
}
