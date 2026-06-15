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

export function createApp(): { app: Hono; configPort: ConfigPort; fusionService: FusionService } {
  const configPath = process.env.FUSION_CONFIG_PATH ?? 'fusion.config.json';

  const configPort: ConfigPort = new JsonFileConfigAdapter(configPath);

  const loggerPort: LoggerPort = new ConsoleLoggerAdapter();

  const clockPort: ClockPort = {
    now: () => Date.now(),
  };

  const synthesizerModel = configPort.getSynthesizerModel();

  const factory = new ChatAdapterFactory();
  const chatModelPort: ChatModelPort = factory.create(synthesizerModel);

  const fusionService: FusionService = new RunFusionUseCase(
    chatModelPort,
    configPort,
    loggerPort,
    clockPort,
  );

  const app = createServer(fusionService, configPort);

  return { app, configPort, fusionService };
}
