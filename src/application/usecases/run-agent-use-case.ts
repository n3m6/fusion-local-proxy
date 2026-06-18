import { randomUUID } from 'node:crypto';
import type { AgentService } from '../ports/agent-service.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ModelRef, FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ChatRequest } from '../../domain/model/chat-types.js';

/** Single-model agent passthrough — no panel/judge/synthesis, no thinking mode injection. */
export class RunAgentUseCase implements AgentService {
  constructor(
    private readonly chatPort: ChatModelPort,
    private readonly modelRef: ModelRef,
    private readonly loggerPort: LoggerPort,
  ) {}

  async *runAgent(request: FusionRequest): AsyncIterable<FusionStreamEvent> {
    const requestId = randomUUID();
    const messages = request.systemPrompt
      ? [{ role: 'system' as const, content: request.systemPrompt }, ...request.messages]
      : [...request.messages];

    const chatRequest: ChatRequest = {
      messages,
      model: this.modelRef,
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
        ...(request.topP !== undefined ? { topP: request.topP } : {}),
        ...(request.stopSequences !== undefined ? { stopSequences: request.stopSequences } : {}),
        ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
        ...(request.tools !== undefined ? { tools: request.tools } : {}),
        ...(request.toolChoice !== undefined ? { toolChoice: request.toolChoice } : {}),
        requestId,
        stage: 'agent',
        label: 'agent',
      },
    };

    this.loggerPort.log('info', 'agent_run_start', {
      requestId,
      messageCount: messages.length,
      toolCount: request.tools?.length ?? 0,
      modelId: this.modelRef.model,
    });

    let lastUsage = undefined;

    try {
      for await (const chunk of this.chatPort.stream(chatRequest)) {
        switch (chunk.type) {
          case 'content_delta':
            yield { type: 'content_delta', delta: chunk.delta };
            break;
          case 'content_stop':
            yield { type: 'content_stop', finishReason: chunk.finishReason };
            break;
          case 'tool_call_delta':
            yield {
              type: 'tool_call_delta',
              index: chunk.index,
              ...(chunk.id !== undefined ? { id: chunk.id } : {}),
              ...(chunk.name !== undefined ? { name: chunk.name } : {}),
              ...(chunk.argumentsDelta !== undefined
                ? { argumentsDelta: chunk.argumentsDelta }
                : {}),
            };
            break;
          case 'usage':
            lastUsage = chunk.usage;
            break;
          case 'reasoning_progress':
            break;
        }
      }
    } catch (err) {
      this.loggerPort.logError('agent', err instanceof Error ? err : new Error(String(err)), {
        requestId,
        modelId: this.modelRef.model,
      });
      yield {
        type: 'error',
        code: 'agent_error',
        message: err instanceof Error ? err.message : 'Agent call failed',
      };
      return;
    }

    this.loggerPort.log('info', 'agent_run_end', { requestId, modelId: this.modelRef.model });

    yield {
      type: 'done',
      ...(lastUsage !== undefined ? { usage: lastUsage } : {}),
      model: this.modelRef.model,
    };
  }
}
