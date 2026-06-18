import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { RunAgentUseCase } from './run-agent-use-case.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ChatRequest, ChatStreamChunk } from '../../domain/model/chat-types.js';
import type { ModelRef } from '../../domain/model/fusion-types.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { LoggerPort, LogLevel, LogFields } from '../../domain/ports/logger-port.js';
import type { FailedModelInfo } from '../../domain/model/stream-types.js';
import type { TokenUsage } from '../../domain/model/chat-types.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const MODEL_REF: ModelRef = {
  provider: 'openai',
  model: 'gpt-4o',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
};

function stubLoggerPort(): LoggerPort {
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

function stubChatPort(chunks: ChatStreamChunk[]): ChatModelPort {
  return {
    async complete(_request: ChatRequest) {
      return {
        content: '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: '',
      };
    },
    async *stream(_request: ChatRequest) {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function makeRequest(overrides: Partial<FusionRequest> = {}): FusionRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

async function collectEvents(useCase: RunAgentUseCase, request: FusionRequest) {
  const events = [];
  for await (const event of useCase.runAgent(request)) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunAgentUseCase', () => {
  test('forwards content_delta events', async () => {
    const port = stubChatPort([
      { type: 'content_delta', delta: 'Hello' },
      { type: 'content_delta', delta: ' world' },
      { type: 'content_stop', finishReason: 'stop' },
      { type: 'usage', usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 } },
    ]);
    const useCase = new RunAgentUseCase(port, MODEL_REF, stubLoggerPort());
    const events = await collectEvents(useCase, makeRequest());

    const deltas = events.filter((e) => e.type === 'content_delta');
    assert.equal(deltas.length, 2);
    assert.equal((deltas[0] as { type: 'content_delta'; delta: string }).delta, 'Hello');
  });

  test('forwards content_stop with finishReason', async () => {
    const port = stubChatPort([{ type: 'content_stop', finishReason: 'stop' }]);
    const useCase = new RunAgentUseCase(port, MODEL_REF, stubLoggerPort());
    const events = await collectEvents(useCase, makeRequest());

    const stop = events.find((e) => e.type === 'content_stop');
    assert.ok(stop);
    assert.equal((stop as { type: 'content_stop'; finishReason?: string }).finishReason, 'stop');
  });

  test('forwards tool_call_delta events', async () => {
    const port = stubChatPort([
      { type: 'tool_call_delta', index: 0, id: 'call_x', name: 'get_weather' },
      { type: 'tool_call_delta', index: 0, argumentsDelta: '{"city":"NYC"}' },
      { type: 'content_stop', finishReason: 'tool_calls' },
    ]);
    const useCase = new RunAgentUseCase(port, MODEL_REF, stubLoggerPort());
    const events = await collectEvents(useCase, makeRequest());

    const toolDeltas = events.filter((e) => e.type === 'tool_call_delta');
    assert.equal(toolDeltas.length, 2);
    const first = toolDeltas[0] as {
      type: 'tool_call_delta';
      index: number;
      id?: string;
      name?: string;
    };
    assert.equal(first.id, 'call_x');
    assert.equal(first.name, 'get_weather');
  });

  test('ends with done event containing model and usage', async () => {
    const port = stubChatPort([
      { type: 'content_stop' },
      { type: 'usage', usage: { promptTokens: 3, completionTokens: 7, totalTokens: 10 } },
    ]);
    const useCase = new RunAgentUseCase(port, MODEL_REF, stubLoggerPort());
    const events = await collectEvents(useCase, makeRequest());

    const done = events.find((e) => e.type === 'done');
    assert.ok(done);
    const doneEvent = done as { type: 'done'; model?: string; usage?: TokenUsage };
    assert.equal(doneEvent.model, MODEL_REF.model);
    assert.equal(doneEvent.usage?.totalTokens, 10);
  });

  test('does NOT inject thinkingMode into messages', async () => {
    let capturedMessages: unknown[] = [];
    const port: ChatModelPort = {
      async complete(_req) {
        return {
          content: '',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: '',
        };
      },
      async *stream(req: ChatRequest) {
        capturedMessages = req.messages as unknown[];
        yield { type: 'content_stop' };
      },
    };
    const useCase = new RunAgentUseCase(port, MODEL_REF, stubLoggerPort());
    await collectEvents(useCase, makeRequest());

    // No system message from thinking mode should be prepended
    assert.equal(capturedMessages.length, 1, 'must not inject extra messages');
  });

  test('passes tools and toolChoice through to ChatRequest', async () => {
    let capturedOptions: unknown = null;
    const port: ChatModelPort = {
      async complete(_req) {
        return {
          content: '',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: '',
        };
      },
      async *stream(req: ChatRequest) {
        capturedOptions = req.options;
        yield { type: 'content_stop' };
      },
    };
    const useCase = new RunAgentUseCase(port, MODEL_REF, stubLoggerPort());
    const tools = [{ type: 'function' as const, name: 'fn', description: 'test fn' }];
    await collectEvents(useCase, makeRequest({ tools, toolChoice: 'auto' }));

    const opts = capturedOptions as { tools?: unknown; toolChoice?: unknown };
    assert.deepStrictEqual(opts.tools, tools);
    assert.equal(opts.toolChoice, 'auto');
  });

  test('emits error event on adapter failure', async () => {
    const port: ChatModelPort = {
      async complete(_req) {
        return {
          content: '',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: '',
        };
      },
      async *stream(_req: ChatRequest) {
        throw new Error('upstream failure');
      },
    };
    const useCase = new RunAgentUseCase(port, MODEL_REF, stubLoggerPort());
    const events = await collectEvents(useCase, makeRequest());

    const errorEvent = events.find((e) => e.type === 'error');
    assert.ok(errorEvent, 'must emit an error event');
    const err = errorEvent as { type: 'error'; code: string; message: string };
    assert.equal(err.code, 'agent_error');
    assert.ok(err.message.includes('upstream failure'));
  });

  test('prepends systemPrompt as system message', async () => {
    let capturedMessages: unknown[] = [];
    const port: ChatModelPort = {
      async complete(_req) {
        return {
          content: '',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: '',
        };
      },
      async *stream(req: ChatRequest) {
        capturedMessages = req.messages as unknown[];
        yield { type: 'content_stop' };
      },
    };
    const useCase = new RunAgentUseCase(port, MODEL_REF, stubLoggerPort());
    await collectEvents(useCase, makeRequest({ systemPrompt: 'You are a helpful assistant.' }));

    assert.equal(capturedMessages.length, 2);
    const first = capturedMessages[0] as { role: string; content: string };
    assert.equal(first.role, 'system');
    assert.equal(first.content, 'You are a helpful assistant.');
  });
});
