import type { Hono } from 'hono';
import { JsonFileConfigAdapter } from '../outbound/config/json-file-config-adapter.js';
import { ConsoleLoggerAdapter } from '../outbound/logging/console-logger-adapter.js';
import { ChatAdapterFactory } from '../outbound/llm/chat-adapter-factory.js';
import { RunFusionUseCase } from '../../application/usecases/run-fusion-use-case.js';
import { PanelRunner } from '../../application/usecases/panel-runner.js';
import { JudgeStep } from '../../application/usecases/judge-step.js';
import { SynthesizeStep } from '../../application/usecases/synthesize-step.js';
import { createServer } from '../inbound/http/server.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { FusionService } from '../../application/ports/fusion-service.js';

export function createApp(): { app: Hono; configPort: ConfigPort; fusionService: FusionService } {
  const configPath = process.env.FUSION_CONFIG_PATH ?? 'fusion.config.json';

  const configPort: ConfigPort = new JsonFileConfigAdapter(configPath);

  const loggerPort: LoggerPort = new ConsoleLoggerAdapter();

  const clockPort: ClockPort = {
    now: () => Date.now(),
  };

  const panelModels = configPort.getPanelModels();
  const synthesizerModel = configPort.getSynthesizerModel();

  const factory = new ChatAdapterFactory();
  const panelChatPorts: ChatModelPort[] = panelModels.map((m) => factory.create(m));
  const judgeChatPort: ChatModelPort = factory.create(
    configPort.getJudgeModel() ?? synthesizerModel,
  );
  const synthChatPort: ChatModelPort = factory.create(synthesizerModel);

  const panelRunner = new PanelRunner(panelChatPorts, loggerPort, clockPort);
  const judgeStep = new JudgeStep(judgeChatPort, loggerPort, clockPort);
  const synthesizeStep = new SynthesizeStep(synthChatPort, configPort, loggerPort, clockPort);

  const fusionService: FusionService = new RunFusionUseCase(
    panelRunner,
    judgeStep,
    synthesizeStep,
    configPort,
    loggerPort,
    clockPort,
  );

  const app = createServer(fusionService, configPort);

  return { app, configPort, fusionService };
}
