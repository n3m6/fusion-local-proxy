import { JsonFileConfigAdapter } from '../outbound/config/json-file-config-adapter.js';
import { ConsoleLoggerAdapter } from '../outbound/logging/console-logger-adapter.js';
import { ChatAdapterFactory } from '../outbound/llm/chat-adapter-factory.js';
import { RunFusionUseCase } from '../../application/usecases/run-fusion-use-case.js';
import { PanelRunner } from '../../application/usecases/panel-runner.js';
import { JudgeStep } from '../../application/usecases/judge-step.js';
import { SynthesizeStep } from '../../application/usecases/synthesize-step.js';
import { createServer } from '../inbound/http/server.js';
import type { CreateServerOptions } from '../inbound/http/server.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ChatRequest, ChatResponse, ChatStreamChunk } from '../../domain/model/chat-types.js';
import type { FusionService } from '../../application/ports/fusion-service.js';

/**
 * No-op `ChatModelPort` used when no judge model is configured. Its `complete()`
 * returns `'{}'` so `JudgeStep` parses an empty object that fails
 * `analysisSchema.safeParse()`, triggering graceful degradation (analysis
 * omitted, synthesis falls back to raw panel results). It makes no network calls.
 */
const noopChatModelPort: ChatModelPort = {
  async complete(_request: ChatRequest): Promise<ChatResponse> {
    return {
      content: '{}',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'noop',
    };
  },
  async *stream(_request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    // empty — JudgeStep only calls complete(); stream() exists for interface compliance
  },
};

export function createApp(): {
  app: ReturnType<typeof createServer>;
  configPort: ConfigPort;
  fusionService: FusionService;
} {
  const configPath = process.env.FUSION_CONFIG_PATH ?? 'fusion.config.json';

  const configPort: ConfigPort = new JsonFileConfigAdapter(configPath);

  const loggerPort: LoggerPort = new ConsoleLoggerAdapter();

  const clockPort: ClockPort = {
    now: () => Date.now(),
  };

  const factory = new ChatAdapterFactory();

  // Panel ports — one ChatModelPort per configured panel ModelRef (may be empty).
  const panelModels = configPort.getPanelModels();
  const panelChatPorts: ChatModelPort[] = panelModels.map((m) => factory.create(m));
  const panelRunner = new PanelRunner(panelChatPorts, loggerPort, clockPort);

  // Judge port — real adapter when configured, otherwise the no-op stub so the
  // ensemble degrades gracefully (analysis omitted) instead of failing.
  const judgeModel = configPort.getJudgeModel();
  const judgeChatPort: ChatModelPort = judgeModel ? factory.create(judgeModel) : noopChatModelPort;
  const judgeStep = new JudgeStep(judgeChatPort, loggerPort, clockPort);

  // Synthesizer port — guaranteed present by JsonFileConfigAdapter validation.
  const synthesizerModel = configPort.getSynthesizerModel();
  const synthChatPort: ChatModelPort = factory.create(synthesizerModel);
  const synthesizeStep = new SynthesizeStep(synthChatPort, configPort, loggerPort, clockPort);

  const fusionService: FusionService = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const enableDevUi = ['1', 'true'].includes((process.env.ENABLE_DEV_UI ?? '').toLowerCase());
  const serverOptions: CreateServerOptions = { enableDevUi };
  const app = createServer(fusionService, configPort, serverOptions);

  return { app, configPort, fusionService };
}
