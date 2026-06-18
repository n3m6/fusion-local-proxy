import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { openAiRequestToFusion, fusionStreamToOpenAiResponse } from './translator.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';

function asyncIterableOf(events: FusionStreamEvent[]): AsyncIterable<FusionStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < events.length) {
            return { value: events[i++]!, done: false };
          }
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool parsing in openAiRequestToFusion
// ---------------------------------------------------------------------------

describe('openAiRequestToFusion — tool parsing', () => {
  test('parses tools array into FusionRequest.tools', () => {
    const body = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the weather',
            parameters: { type: 'object', properties: { location: { type: 'string' } } },
          },
        },
      ],
    };

    const req = openAiRequestToFusion(body);
    assert.ok(Array.isArray(req.tools), 'tools must be an array');
    assert.equal(req.tools!.length, 1);
    assert.equal(req.tools![0].name, 'get_weather');
    assert.equal(req.tools![0].description, 'Get the weather');
    assert.equal(req.tools![0].type, 'function');
    assert.deepStrictEqual(req.tools![0].parameters, {
      type: 'object',
      properties: { location: { type: 'string' } },
    });
  });

  test('parses string tool_choice', () => {
    const body = {
      messages: [],
      tools: [{ type: 'function', function: { name: 'fn' } }],
      tool_choice: 'auto',
    };
    const req = openAiRequestToFusion(body);
    assert.equal(req.toolChoice, 'auto');
  });

  test('parses function tool_choice object', () => {
    const body = {
      messages: [],
      tools: [{ type: 'function', function: { name: 'fn' } }],
      tool_choice: { type: 'function', function: { name: 'fn' } },
    };
    const req = openAiRequestToFusion(body);
    assert.deepStrictEqual(req.toolChoice, { type: 'function', function: { name: 'fn' } });
  });

  test('omits tools when body.tools is absent', () => {
    const body = { messages: [] };
    const req = openAiRequestToFusion(body);
    assert.equal(req.tools, undefined);
    assert.equal(req.toolChoice, undefined);
  });

  test('parses tool messages with tool_call_id', () => {
    const body = {
      messages: [
        { role: 'user', content: 'Use the tool' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_123', type: 'function', function: { name: 'fn', arguments: '{}' } },
          ],
        },
        { role: 'tool', content: 'Tool result', tool_call_id: 'call_123' },
      ],
    };
    const req = openAiRequestToFusion(body);
    assert.equal(req.messages.length, 3);

    const assistantMsg = req.messages[1];
    assert.equal(assistantMsg.role, 'assistant');
    assert.ok(Array.isArray(assistantMsg.toolCalls));
    assert.equal(assistantMsg.toolCalls![0].id, 'call_123');
    assert.equal(assistantMsg.toolCalls![0].name, 'fn');
    assert.equal(assistantMsg.toolCalls![0].arguments, '{}');

    const toolMsg = req.messages[2];
    assert.equal(toolMsg.role, 'tool');
    assert.equal(toolMsg.content, 'Tool result');
    assert.equal(toolMsg.toolCallId, 'call_123');
  });
});

// ---------------------------------------------------------------------------
// fusionStreamToOpenAiResponse — tool_call_delta accumulation
// ---------------------------------------------------------------------------

describe('fusionStreamToOpenAiResponse — tool call reconstruction', () => {
  test('reconstructs tool calls from tool_call_delta events and sets finish_reason tool_calls', async () => {
    const events = asyncIterableOf([
      { type: 'tool_call_delta', index: 0, id: 'call_abc', name: 'get_weather' },
      { type: 'tool_call_delta', index: 0, argumentsDelta: '{"loc' },
      { type: 'tool_call_delta', index: 0, argumentsDelta: 'ation":"NYC"}' },
      { type: 'content_stop', finishReason: 'tool_calls' },
      {
        type: 'done',
        model: 'gpt-4o',
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      },
    ] as FusionStreamEvent[]);

    const response = await fusionStreamToOpenAiResponse(events);
    const choices = response.choices as Array<Record<string, unknown>>;
    assert.equal(choices[0].finish_reason, 'tool_calls');

    const message = choices[0].message as Record<string, unknown>;
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(toolCalls), 'must have tool_calls');
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].id, 'call_abc');
    const fn = toolCalls[0].function as Record<string, unknown>;
    assert.equal(fn.name, 'get_weather');
    assert.equal(fn.arguments, '{"location":"NYC"}');
  });

  test('handles multiple parallel tool calls', async () => {
    const events = asyncIterableOf([
      { type: 'tool_call_delta', index: 0, id: 'call_1', name: 'fn_a' },
      { type: 'tool_call_delta', index: 1, id: 'call_2', name: 'fn_b' },
      { type: 'tool_call_delta', index: 0, argumentsDelta: '{}' },
      { type: 'tool_call_delta', index: 1, argumentsDelta: '{"x":1}' },
      { type: 'content_stop', finishReason: 'tool_calls' },
      { type: 'done', model: 'gpt-4o' },
    ] as FusionStreamEvent[]);

    const response = await fusionStreamToOpenAiResponse(events);
    const choices = response.choices as Array<Record<string, unknown>>;
    const message = choices[0].message as Record<string, unknown>;
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    assert.equal(toolCalls.length, 2);
    assert.equal((toolCalls[0].function as Record<string, unknown>).name, 'fn_a');
    assert.equal((toolCalls[1].function as Record<string, unknown>).name, 'fn_b');
  });

  test('plain text response keeps finish_reason stop and no tool_calls', async () => {
    const events = asyncIterableOf([
      { type: 'content_delta', delta: 'Hello' },
      { type: 'content_stop' },
      { type: 'done', model: 'gpt-4o' },
    ] as FusionStreamEvent[]);

    const response = await fusionStreamToOpenAiResponse(events);
    const choices = response.choices as Array<Record<string, unknown>>;
    assert.equal(choices[0].finish_reason, 'stop');
    const message = choices[0].message as Record<string, unknown>;
    assert.equal(message.tool_calls, undefined);
    assert.equal(message.content, 'Hello');
  });
});

// ---------------------------------------------------------------------------
// SSE encoder — tool_call_delta chunks
// ---------------------------------------------------------------------------

import { encodeOpenAiSSE } from './sse-encoder.js';

describe('encodeOpenAiSSE — tool_call_delta', () => {
  async function collectSSE(events: FusionStreamEvent[]): Promise<string[]> {
    const chunks: string[] = [];
    for await (const chunk of encodeOpenAiSSE(asyncIterableOf(events), 'gpt-4o')) {
      chunks.push(chunk);
    }
    return chunks;
  }

  test('emits tool_calls delta chunk for tool_call_delta events', async () => {
    const chunks = await collectSSE([
      { type: 'tool_call_delta', index: 0, id: 'call_x', name: 'fn' },
      { type: 'tool_call_delta', index: 0, argumentsDelta: '{"k":"v"}' },
      { type: 'content_stop', finishReason: 'tool_calls' },
      { type: 'done', model: 'gpt-4o' },
    ]);

    const dataLines = chunks.filter((c) => c.startsWith('data: ') && !c.includes('[DONE]'));
    const firstTool = JSON.parse(dataLines[0].slice(6)) as Record<string, unknown>;
    const choices = firstTool.choices as Array<Record<string, unknown>>;
    const delta = choices[0].delta as Record<string, unknown>;
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(toolCalls), 'must have tool_calls in delta');
    assert.equal(toolCalls[0].id, 'call_x');
  });

  test('emits finish_reason tool_calls on content_stop with finishReason tool_calls', async () => {
    const chunks = await collectSSE([
      { type: 'content_stop', finishReason: 'tool_calls' },
      { type: 'done', model: 'gpt-4o' },
    ]);

    const stopChunk = chunks.find((c) => c.includes('finish_reason'));
    assert.ok(stopChunk, 'must have a finish_reason chunk');
    const parsed = JSON.parse(stopChunk!.slice(6)) as Record<string, unknown>;
    const choices = parsed.choices as Array<Record<string, unknown>>;
    assert.equal(choices[0].finish_reason, 'tool_calls');
  });
});
