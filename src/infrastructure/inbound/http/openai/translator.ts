import { randomUUID } from 'node:crypto';
import type { FusionRequest } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import type {
  TokenUsage,
  ToolDefinition,
  ToolChoice,
} from '../../../../domain/model/chat-types.js';
import type { Message, ToolCall } from '../../../../domain/model/message.js';
import { FusionError } from '../../../../domain/model/fusion-types.js';
import { errorEventToFusionError, parseCommonRequestFields } from '../shared.js';
import { encodeOpenAiSSE } from './sse-encoder.js';

function parseMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (Array.isArray(content)) {
    return content
      .flatMap((part): string[] => {
        if (typeof part === 'string') return [part];
        if (typeof part !== 'object' || part === null) return [];
        const obj = part as Record<string, unknown>;
        if (typeof obj.text === 'string' && obj.text.length > 0) return [obj.text];
        return [];
      })
      .join('\n');
  }
  return JSON.stringify(content);
}

function parseIncomingMessage(m: Record<string, unknown>): Message {
  const role = String(m.role ?? 'user');

  if (role === 'tool') {
    return {
      role: 'tool',
      content: parseMessageContent(m.content),
      toolCallId: typeof m.tool_call_id === 'string' ? m.tool_call_id : undefined,
    };
  }

  if (role === 'assistant' && Array.isArray(m.tool_calls)) {
    const toolCalls: ToolCall[] = (m.tool_calls as Array<Record<string, unknown>>).flatMap(
      (tc): ToolCall[] => {
        const fn =
          typeof tc.function === 'object' && tc.function !== null
            ? (tc.function as Record<string, unknown>)
            : {};
        const id = typeof tc.id === 'string' ? tc.id : '';
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!id && !name) return [];
        return [{ id, name, arguments: typeof fn.arguments === 'string' ? fn.arguments : '' }];
      },
    );
    return {
      role: 'assistant',
      content: parseMessageContent(m.content),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  return {
    role: role as 'system' | 'user' | 'assistant',
    content: parseMessageContent(m.content),
  };
}

function parseTools(raw: unknown): ToolDefinition[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const tools: ToolDefinition[] = (raw as Array<unknown>).flatMap((t): ToolDefinition[] => {
    if (typeof t !== 'object' || t === null) return [];
    const tool = t as Record<string, unknown>;
    if (tool.type !== 'function') return [];
    const fn =
      typeof tool.function === 'object' && tool.function !== null
        ? (tool.function as Record<string, unknown>)
        : {};
    const name = typeof fn.name === 'string' ? fn.name : '';
    if (!name) return [];
    return [
      {
        type: 'function',
        name,
        ...(typeof fn.description === 'string' ? { description: fn.description } : {}),
        ...(fn.parameters !== undefined &&
        typeof fn.parameters === 'object' &&
        fn.parameters !== null
          ? { parameters: fn.parameters as Record<string, unknown> }
          : {}),
      },
    ];
  });
  return tools.length > 0 ? tools : undefined;
}

function parseToolChoice(raw: unknown): ToolChoice | undefined {
  if (raw === 'none' || raw === 'auto' || raw === 'required') return raw;
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.type === 'function') {
      const fn =
        typeof obj.function === 'object' && obj.function !== null
          ? (obj.function as Record<string, unknown>)
          : {};
      const name = typeof fn.name === 'string' ? fn.name : '';
      if (name) return { type: 'function', function: { name } };
    }
  }
  return undefined;
}

export function openAiRequestToFusion(body: Record<string, unknown>): FusionRequest {
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>).map(parseIncomingMessage)
    : [];

  const { model, stream, temperature, maxTokens, topP } = parseCommonRequestFields(body);
  const systemPrompt = typeof body.system === 'string' ? body.system : undefined;
  const rawStop = body.stop;
  const stopSequences = Array.isArray(rawStop)
    ? (rawStop as unknown[]).filter((s): s is string => typeof s === 'string')
    : typeof rawStop === 'string'
      ? [rawStop]
      : undefined;

  const tools = parseTools(body.tools);
  const toolChoice = parseToolChoice(body.tool_choice);

  return {
    messages,
    model,
    stream,
    systemPrompt,
    temperature,
    maxTokens,
    ...(topP !== undefined ? { topP } : {}),
    ...(stopSequences !== undefined && stopSequences.length > 0 ? { stopSequences } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(toolChoice !== undefined ? { toolChoice } : {}),
  };
}

export async function fusionStreamToOpenAiResponse(
  events: AsyncIterable<FusionStreamEvent>,
  model?: string,
): Promise<Record<string, unknown>> {
  let content = '';
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let eventModel = '';
  let doneReceived = false;
  let finishReason = 'stop';

  type ToolCallAcc = { id: string; name: string; arguments: string };
  const toolCallMap = new Map<number, ToolCallAcc>();

  for await (const event of events) {
    switch (event.type) {
      case 'content_delta':
        content += event.delta;
        break;
      case 'content_stop':
        finishReason = event.finishReason ?? 'stop';
        break;
      case 'tool_call_delta': {
        const existing = toolCallMap.get(event.index) ?? { id: '', name: '', arguments: '' };
        toolCallMap.set(event.index, {
          id: event.id ?? existing.id,
          name: event.name ?? existing.name,
          arguments: existing.arguments + (event.argumentsDelta ?? ''),
        });
        break;
      }
      case 'done':
        doneReceived = true;
        usage = {
          promptTokens: event.usage?.promptTokens ?? 0,
          completionTokens: event.usage?.completionTokens ?? 0,
          totalTokens: event.usage?.totalTokens ?? 0,
        };
        if (event.model) {
          eventModel = event.model;
        }
        break;
      case 'error':
        throw errorEventToFusionError(event);
      case 'progress':
        break;
    }
  }

  if (!doneReceived) {
    throw new FusionError('incomplete_stream', 'Stream completed without a done event');
  }

  const toolCallsResult = Array.from(toolCallMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: toolCallsResult.length > 0 ? content || null : content,
    ...(toolCallsResult.length > 0 ? { tool_calls: toolCallsResult } : {}),
  };

  return {
    id,
    object: 'chat.completion',
    created,
    model: model ?? (eventModel || ''),
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    },
  };
}

export function fusionStreamToOpenAiSSE(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): AsyncIterable<string> {
  return encodeOpenAiSSE(events, model);
}
