import { JsonFileConfigAdapter } from '../outbound/config/json-file-config-adapter.js';
import { ConsoleLoggerAdapter, parseLogLevel } from '../outbound/logging/console-logger-adapter.js';
import { ChatAdapterFactory } from '../outbound/llm/chat-adapter-factory.js';
import {
  OpenAiCompletionAdapter,
  createOpenAiCompletionClient,
} from '../outbound/llm/openai-completion-adapter.js';
import { RunFusionUseCase } from '../../application/usecases/run-fusion-use-case.js';
import { RunAgentUseCase } from '../../application/usecases/run-agent-use-case.js';
import { PanelRunner, type PanelPair } from '../../application/usecases/panel-runner.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import { JudgeStep } from '../../application/usecases/judge-step.js';
import { SynthesizeStep } from '../../application/usecases/synthesize-step.js';
import { createServer } from '../inbound/http/server.js';
import type { CreateServerOptions } from '../inbound/http/server.js';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { FusionService } from '../../application/ports/fusion-service.js';
import type { AgentService } from '../../application/ports/agent-service.js';

/**
 * Decide whether console logs should be ANSI-colored. Follows the de-facto
 * conventions: `NO_COLOR` (any value) disables, `FORCE_COLOR` forces on, and
 * otherwise color is enabled only when stdout is an interactive TTY so piped or
 * redirected JSON output stays uncolored and parseable.
 */
function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '') {
    return true;
  }
  return process.stdout.isTTY === true;
}

export function createApp(): {
  app: ReturnType<typeof createServer>;
  configPort: ConfigPort;
  fusionService: FusionService;
  agentService: AgentService | null;
  loggerPort: LoggerPort;
} {
  const configPath = process.env.FUSION_CONFIG_PATH ?? 'fusion.config.json';

  const configPort: ConfigPort = new JsonFileConfigAdapter(configPath);

  const loggerPort: LoggerPort = new ConsoleLoggerAdapter(
    parseLogLevel(process.env.LOG_LEVEL),
    shouldUseColor(),
  );

  const clockPort: ClockPort = {
    now: () => Date.now(),
  };

  const factory = new ChatAdapterFactory(loggerPort);

  // Panel pairs — model + adapter bundled so index alignment can never drift.
  const panelPairs: PanelPair[] = configPort
    .getPanelModels()
    .map((m) => ({ modelRef: m, port: factory.create(m) }));
  const panelRunner = new PanelRunner(panelPairs, loggerPort, clockPort);

  // Judge step — constructed only when a judge model is configured; null otherwise,
  // which signals RunFusionUseCase to skip the judge stage gracefully.
  const judgeModel = configPort.getJudgeModel();
  const judgeChatPort: ChatModelPort | null = judgeModel ? factory.create(judgeModel) : null;
  const judgeStep =
    judgeChatPort && judgeModel
      ? new JudgeStep(judgeChatPort, judgeModel, loggerPort, clockPort)
      : null;

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

  // Agent service — wired when an openai-type model is resolvable (dedicated or panel fallback).
  const agentModelRef = configPort.getAgentModel();
  const agentService: AgentService | null = agentModelRef
    ? new RunAgentUseCase(factory.create(agentModelRef), agentModelRef, loggerPort)
    : null;

  if (!agentModelRef) {
    loggerPort.log('warn', 'agent_not_wired', {
      reason:
        'No openai-type model available for agent role (no dedicated agent role or first panel is non-openai)',
    });
  }

  // Autocomplete / text-completion service — wired only when an openai-type model is resolvable.
  const autocompleteModelRef = configPort.getAutocompleteModel();
  const textCompletionPort = autocompleteModelRef
    ? new OpenAiCompletionAdapter(
        createOpenAiCompletionClient({
          baseURL: autocompleteModelRef.baseURL,
          apiKey: autocompleteModelRef.apiKey,
        }),
        { baseURL: autocompleteModelRef.baseURL, apiKey: autocompleteModelRef.apiKey },
        loggerPort,
      )
    : null;

  if (!autocompleteModelRef) {
    loggerPort.log('warn', 'autocomplete_not_wired', {
      reason:
        'No openai-type model available for autocomplete role (no dedicated autocomplete role or first panel is non-openai)',
    });
  }

  const enableDevUi = ['1', 'true'].includes((process.env.ENABLE_DEV_UI ?? '').toLowerCase());
  const serverOptions: CreateServerOptions = {
    enableDevUi,
    logger: loggerPort,
    agentService,
    textCompletionPort,
    autocompleteModel: autocompleteModelRef,
  };
  const app = createServer(fusionService, configPort, serverOptions);

  return { app, configPort, fusionService, agentService, loggerPort };
}
