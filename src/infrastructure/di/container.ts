import type { Hono } from 'hono';
import { JsonFileConfigAdapter } from '../outbound/config/json-file-config-adapter.js';
import { ConsoleLoggerAdapter } from '../outbound/logging/console-logger-adapter.js';
import { ChatAdapterFactory } from '../outbound/llm/chat-adapter-factory.js';
import { RunFusionUseCase } from '../../application/usecases/run-fusion-use-case.js';
import { createServer } from '../inbound/http/server.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { FusionService } from '../../application/ports/fusion-service.js';
import type { ModelRef } from '../../domain/model/fusion-types.js';

export function createApp(): { app: Hono; configPort: ConfigPort } {
  const configPath = process.env.FUSION_CONFIG_PATH ?? 'fusion.config.json';

  // 1. Config
  const configPort: ConfigPort = new JsonFileConfigAdapter(configPath);

  // 2. Logger
  const loggerPort: LoggerPort = new ConsoleLoggerAdapter();

  // 3. Clock
  const clockPort: ClockPort = {
    now: () => Date.now(),
  };

  // 4. Panel model selection
  const panelModels = configPort.getPanelModels();
  if (panelModels.length === 0) {
    throw new Error('At least one panel model is required in configuration');
  }
  const panelModel: ModelRef = panelModels[0];

  // 5. Chat adapter
  const factory = new ChatAdapterFactory();
  const chatModelPort: ChatModelPort = factory.create(panelModel);

  // 6. Use case
  const fusionService: FusionService = new RunFusionUseCase(
    chatModelPort,
    configPort,
    loggerPort,
    clockPort,
  );

  // 7. Server
  const app = createServer(fusionService, configPort);

  return { app, configPort };
}
