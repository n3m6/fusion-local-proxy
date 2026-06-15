import type { FusionService } from '../ports/fusion-service.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { FusionRequest, PanelMeta } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { TokenUsage } from '../../domain/model/chat-types.js';
import type { Message } from '../../domain/model/message.js';
import type { Analysis } from '../../domain/services/analysis-schema.js';
import { PanelRunner } from './panel-runner.js';
import { JudgeStep } from './judge-step.js';
import { SynthesizeStep } from './synthesize-step.js';

export class RunFusionUseCase implements FusionService {
  constructor(
    private readonly panelRunner: PanelRunner,
    private readonly judgeStep: JudgeStep,
    private readonly synthesizeStep: SynthesizeStep,
    private readonly configPort: ConfigPort,
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async *runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent> {
    // 1. Resolve configuration
    const panelModels = this.configPort.getPanelModels();
    const judgeModel = this.configPort.getJudgeModel();
    const timeoutMs = this.configPort.getTimeoutMs();

    // 2. Build messages array (prepend system prompt if present)
    const messages: Message[] = request.systemPrompt
      ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
      : [...request.messages];

    // 3. Panel stage
    this.loggerPort.logStageStart('panel');
    const panelStart = this.clockPort.now();
    const panelMeta: PanelMeta = await this.panelRunner.run(messages, panelModels, timeoutMs);
    this.loggerPort.logStageEnd('panel', this.clockPort.now() - panelStart);

    // 4. Yield panel progress
    yield { type: 'progress', stage: 'panel', message: 'Panel stage complete' };

    // 5. Judge stage (conditional)
    let analysis: Analysis | null = null;
    if (judgeModel !== null) {
      this.loggerPort.logStageStart('judge');
      const judgeStart = this.clockPort.now();
      analysis = await this.judgeStep.analyze(panelMeta.results, messages, judgeModel, timeoutMs);
      this.loggerPort.logStageEnd('judge', this.clockPort.now() - judgeStart);
    }

    // 6. Yield judge progress (always, even when judge was skipped)
    yield { type: 'progress', stage: 'judge', message: 'Judge stage complete' };

    // 7. Synthesis stage — iterate and re-yield content events, capture usage/model from done
    let synthUsage: TokenUsage | undefined;
    let synthModel: string | undefined;

    for await (const event of this.synthesizeStep.synthesize(panelMeta.results, messages, analysis)) {
      if (event.type === 'content_delta') {
        yield { type: 'content_delta', delta: event.delta };
      } else if (event.type === 'content_stop') {
        yield { type: 'content_stop' };
      } else if (event.type === 'done') {
        // Capture usage and model from synthesis done event; do NOT yield it
        synthUsage = event.usage;
        synthModel = event.model;
      }
      // Ignore progress, error, etc. events from synthesis
    }

    // 8. Yield combined final done event
    yield {
      type: 'done',
      failedModels: panelMeta.failedModels,
      ...(synthUsage ? { usage: synthUsage } : {}),
      ...(synthModel ? { model: synthModel } : {}),
    };
  }
}
