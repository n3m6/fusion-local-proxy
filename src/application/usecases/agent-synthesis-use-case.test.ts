import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSynthesisUseCase } from './agent-synthesis-use-case.js';
import type { AgentService } from '../ports/agent-service.js';
import type { FusionService } from '../ports/fusion-service.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { LoggerPort, LogLevel, LogFields } from '../../domain/ports/logger-port.js';
import type { TokenUsage } from '../../domain/model/chat-types.js';
import type { FailedModelInfo } from '../../domain/model/stream-types.js';
import { NO_TOOLS_DIRECTIVE } from '../../domain/services/tool-conversation.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function stubLogger(): LoggerPort {
  return {
    logStageStart(_stage: string): void {},
    logStageEnd(_stage: string, _durationMs: number, _usage?: TokenUsage): void {},
    logFailedModels(_models: FailedModelInfo[]): void {},
    logError(_stage: string, _error: Error, _fields?: LogFields): void {},
    logRequest(_fields: LogFields): void {},
    logResponse(_fields: LogFields): void {},
    log(_level: LogLevel, _event: string, _fields?: LogFields): void {},
  };
}

function stubAgent(events: FusionStreamEvent[]): AgentService {
  return {
    async *runAgent(_request: FusionRequest) {
      for (const e of events) {
        yield e;
      }
    },
  };
}

function stubFusion(events: FusionStreamEvent[]): FusionService {
  return {
    async *runFusion(_request: FusionRequest) {
      for (const e of events) {
        yield e;
      }
    },
  };
}

function baseRequest(overrides: Partial<FusionRequest> = {}): FusionRequest {
  return {
    messages: [{ role: 'user', content: 'What is the weather in NYC?' }],
    ...overrides,
  };
}

async function collect(iter: AsyncIterable<FusionStreamEvent>): Promise<FusionStreamEvent[]> {
  const events: FusionStreamEvent[] = [];
  for await (const e of iter) {
    events.push(e);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tool-turn path: agent stream starts with tool_call_delta
// ---------------------------------------------------------------------------

describe('AgentSynthesisUseCase — tool turn', () => {
  test('relays all agent events verbatim when first event is tool_call_delta', async () => {
    const agentEvents: FusionStreamEvent[] = [
      { type: 'tool_call_delta', index: 0, id: 'c1', name: 'get_weather' },
      { type: 'tool_call_delta', index: 0, argumentsDelta: '{"city":"NYC"}' },
      { type: 'content_stop', finishReason: 'tool_calls' },
      { type: 'done', model: 'gpt-4o' },
    ];
    const fusionEvents: FusionStreamEvent[] = [
      { type: 'content_delta', delta: 'fusion answer' },
      { type: 'done' },
    ];

    const useCase = new AgentSynthesisUseCase(
      stubAgent(agentEvents),
      stubFusion(fusionEvents),
      stubLogger(),
    );
    const result = await collect(useCase.runAgent(baseRequest()));

    assert.equal(result.length, agentEvents.length);
    assert.equal(result[0].type, 'tool_call_delta');
    assert.equal(result[result.length - 1].type, 'done');
  });

  test('does not call fusion when agent emits tool_call_delta first', async () => {
    let fusionCalled = false;
    const fusionService: FusionService = {
      async *runFusion(_r) {
        fusionCalled = true;
        yield { type: 'done' };
      },
    };
    const agentEvents: FusionStreamEvent[] = [
      { type: 'tool_call_delta', index: 0, id: 'c1', name: 'fn' },
      { type: 'content_stop', finishReason: 'tool_calls' },
      { type: 'done' },
    ];

    const useCase = new AgentSynthesisUseCase(stubAgent(agentEvents), fusionService, stubLogger());
    await collect(useCase.runAgent(baseRequest()));

    assert.equal(fusionCalled, false);
  });

  test('logs mode=tool when routing to agent pass-through', async () => {
    const logged: { event: string; fields?: LogFields }[] = [];
    const logger: LoggerPort = {
      ...stubLogger(),
      log(_level: LogLevel, event: string, fields?: LogFields) {
        logged.push({ event, fields });
      },
    };
    const agentEvents: FusionStreamEvent[] = [
      { type: 'tool_call_delta', index: 0, id: 'c1', name: 'fn' },
      { type: 'done' },
    ];

    const useCase = new AgentSynthesisUseCase(stubAgent(agentEvents), stubFusion([]), logger);
    await collect(useCase.runAgent(baseRequest()));

    const routeLog = logged.find((l) => l.event === 'agent_route');
    assert.ok(routeLog, 'must log agent_route');
    assert.equal((routeLog.fields as { mode: string }).mode, 'tool');
  });

  test('routes to tool and relays preamble when content_delta precedes tool_call_delta', async () => {
    let fusionCalled = false;
    const fusionService: FusionService = {
      async *runFusion(_r) {
        fusionCalled = true;
        yield { type: 'done' };
      },
    };

    const agentEvents: FusionStreamEvent[] = [
      { type: 'content_delta', delta: 'Let me check…' },
      { type: 'tool_call_delta', index: 0, id: 'c1', name: 'get_weather' },
      { type: 'tool_call_delta', index: 0, argumentsDelta: '{"city":"NYC"}' },
      { type: 'content_stop', finishReason: 'tool_calls' },
      { type: 'done' },
    ];

    const useCase = new AgentSynthesisUseCase(stubAgent(agentEvents), fusionService, stubLogger());
    const result = await collect(useCase.runAgent(baseRequest()));

    assert.equal(fusionCalled, false, 'fusion must not be called on a tool turn');
    assert.equal(result.length, agentEvents.length, 'all agent events must be relayed');
    assert.equal(result[0].type, 'content_delta', 'preamble content_delta must be relayed');
    assert.equal(result[1].type, 'tool_call_delta', 'tool_call_delta must follow the preamble');
  });
});

// ---------------------------------------------------------------------------
// Synthesis path: agent stream starts with content_delta
// ---------------------------------------------------------------------------

describe('AgentSynthesisUseCase — synthesis turn (content_delta first)', () => {
  test('calls fusion and streams its events when first agent event is content_delta', async () => {
    const fusionEvents: FusionStreamEvent[] = [
      { type: 'content_delta', delta: 'synthesized answer' },
      { type: 'done' },
    ];

    const useCase = new AgentSynthesisUseCase(
      stubAgent([{ type: 'content_delta', delta: 'agent draft' }, { type: 'done' }]),
      stubFusion(fusionEvents),
      stubLogger(),
    );
    const result = await collect(useCase.runAgent(baseRequest()));

    assert.equal(result.length, fusionEvents.length);
    assert.equal(result[0].type, 'content_delta');
    assert.equal(
      (result[0] as { type: 'content_delta'; delta: string }).delta,
      'synthesized answer',
    );
  });

  test('passes flattened messages and strips tools from fusion request', async () => {
    let capturedRequest: FusionRequest | null = null;
    const fusionService: FusionService = {
      async *runFusion(req) {
        capturedRequest = req;
        yield { type: 'done' };
      },
    };

    const request = baseRequest({
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'get_weather', arguments: '{"city":"NYC"}' }],
        },
        { role: 'tool', content: 'Sunny', toolCallId: 'c1' },
      ],
      tools: [{ type: 'function', name: 'get_weather', description: 'Get weather' }],
      toolChoice: 'auto',
    });

    const useCase = new AgentSynthesisUseCase(
      stubAgent([{ type: 'content_delta', delta: 'draft' }]),
      fusionService,
      stubLogger(),
    );
    await collect(useCase.runAgent(request));

    assert.ok(capturedRequest, 'fusion must have been called');
    const req = capturedRequest as FusionRequest;
    assert.equal(req.tools, undefined, 'tools must be stripped');
    assert.equal(req.toolChoice, undefined, 'toolChoice must be stripped');
    // Verify tool messages have been flattened
    const hasTool = req.messages.some((m) => m.role === 'tool');
    assert.equal(hasTool, false, 'tool role messages must be flattened');
    // Verify the no-tools directive is injected
    const hasDirective = req.messages.some(
      (m) => m.role === 'system' && m.content === NO_TOOLS_DIRECTIVE,
    );
    assert.equal(hasDirective, true, 'no-tools directive must be present in synthesis request');
  });

  test('logs mode=synthesis when routing to fusion', async () => {
    const logged: { event: string; fields?: LogFields }[] = [];
    const logger: LoggerPort = {
      ...stubLogger(),
      log(_level: LogLevel, event: string, fields?: LogFields) {
        logged.push({ event, fields });
      },
    };

    const useCase = new AgentSynthesisUseCase(
      stubAgent([{ type: 'content_delta', delta: 'x' }]),
      stubFusion([{ type: 'done' }]),
      logger,
    );
    await collect(useCase.runAgent(baseRequest()));

    const routeLog = logged.find((l) => l.event === 'agent_route');
    assert.ok(routeLog, 'must log agent_route');
    assert.equal((routeLog.fields as { mode: string }).mode, 'synthesis');
  });

  test('logs a requestId on agent_route and forwards the same id to the inner agent', async () => {
    let capturedRequestId: string | undefined;
    const innerAgent: AgentService = {
      async *runAgent(_request: FusionRequest, requestId?: string) {
        capturedRequestId = requestId;
        yield { type: 'content_delta', delta: 'draft' };
      },
    };
    const logged: { event: string; fields?: LogFields }[] = [];
    const logger: LoggerPort = {
      ...stubLogger(),
      log(_level: LogLevel, event: string, fields?: LogFields) {
        logged.push({ event, fields });
      },
    };

    const useCase = new AgentSynthesisUseCase(innerAgent, stubFusion([{ type: 'done' }]), logger);
    await collect(useCase.runAgent(baseRequest()));

    const routeLog = logged.find((l) => l.event === 'agent_route');
    assert.ok(routeLog, 'must log agent_route');
    const routeRequestId = (routeLog.fields as { requestId?: string }).requestId;
    assert.ok(routeRequestId, 'agent_route must carry a requestId');
    assert.equal(
      capturedRequestId,
      routeRequestId,
      'inner agent must receive the same requestId logged on agent_route',
    );
  });

  test('honors a caller-supplied requestId instead of generating its own', async () => {
    let capturedRequestId: string | undefined;
    const innerAgent: AgentService = {
      async *runAgent(_request: FusionRequest, requestId?: string) {
        capturedRequestId = requestId;
        yield { type: 'content_delta', delta: 'draft' };
      },
    };
    const logged: { event: string; fields?: LogFields }[] = [];
    const logger: LoggerPort = {
      ...stubLogger(),
      log(_level: LogLevel, event: string, fields?: LogFields) {
        logged.push({ event, fields });
      },
    };

    const useCase = new AgentSynthesisUseCase(innerAgent, stubFusion([{ type: 'done' }]), logger);
    await collect(useCase.runAgent(baseRequest(), 'caller-supplied-id'));

    assert.equal(
      capturedRequestId,
      'caller-supplied-id',
      'wrapper must forward the caller-supplied requestId to the inner agent',
    );
    const routeLog = logged.find((l) => l.event === 'agent_route');
    assert.equal(
      (routeLog?.fields as { requestId?: string }).requestId,
      'caller-supplied-id',
      'agent_route must log the caller-supplied requestId',
    );
  });
});

// ---------------------------------------------------------------------------
// Synthesis path: agent stream ends with no decisive event
// ---------------------------------------------------------------------------

describe('AgentSynthesisUseCase — synthesis turn (empty agent stream)', () => {
  test('falls through to fusion when agent emits no content_delta or tool_call_delta', async () => {
    const fusionEvents: FusionStreamEvent[] = [
      { type: 'content_delta', delta: 'fusion answer' },
      { type: 'done' },
    ];

    // Agent emits only content_stop + done, no decisive event.
    const agentEvents: FusionStreamEvent[] = [
      { type: 'content_stop', finishReason: 'stop' },
      { type: 'done' },
    ];

    const useCase = new AgentSynthesisUseCase(
      stubAgent(agentEvents),
      stubFusion(fusionEvents),
      stubLogger(),
    );
    const result = await collect(useCase.runAgent(baseRequest()));

    assert.equal(result.length, fusionEvents.length);
    assert.equal(result[0].type, 'content_delta');
  });

  test('falls through to fusion when agent stream is immediately done', async () => {
    let fusionCalled = false;
    const fusionService: FusionService = {
      async *runFusion(_r) {
        fusionCalled = true;
        yield { type: 'done' };
      },
    };

    const useCase = new AgentSynthesisUseCase(stubAgent([]), fusionService, stubLogger());
    await collect(useCase.runAgent(baseRequest()));

    assert.equal(fusionCalled, true);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('AgentSynthesisUseCase — error handling', () => {
  test('relays error event from agent before any decisive event', async () => {
    const agentEvents: FusionStreamEvent[] = [
      { type: 'error', code: 'agent_error', message: 'upstream failure' },
    ];
    let fusionCalled = false;
    const fusionService: FusionService = {
      async *runFusion(_r) {
        fusionCalled = true;
        yield { type: 'done' };
      },
    };

    const useCase = new AgentSynthesisUseCase(stubAgent(agentEvents), fusionService, stubLogger());
    const result = await collect(useCase.runAgent(baseRequest()));

    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'error');
    assert.equal(fusionCalled, false, 'fusion must not be called after agent error');
  });
});
