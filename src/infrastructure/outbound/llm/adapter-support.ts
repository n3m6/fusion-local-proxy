import type { ChatRequest } from '../../../domain/model/chat-types.js';
import type { LogFields } from '../../../domain/ports/logger-port.js';
import { promptChars } from '../../../domain/model/message.js';

export interface AdapterConfig {
  readonly baseURL: string;
  readonly apiKey: string;
}

export function buildRequestLogFields(
  request: ChatRequest,
  provider: string,
  mode: 'complete' | 'stream',
): LogFields {
  return {
    provider,
    modelId: request.model.model,
    baseURL: request.model.baseURL,
    requestId: request.options?.requestId,
    stage: request.options?.stage,
    label: request.options?.label,
    mode,
    messageCount: request.messages.length,
    promptChars: promptChars(request.messages),
    temperature: request.options?.temperature,
    maxTokens: request.options?.maxTokens,
    responseFormat: request.options?.responseFormat?.type,
    thinkingStrength: request.model.thinkingStrength,
    thinkingMode: request.model.thinkingMode,
    prompt: request.messages,
  };
}

export function buildBaseLogFields(request: ChatRequest, provider: string): LogFields {
  return {
    provider,
    modelId: request.model.model,
    baseURL: request.model.baseURL,
    requestId: request.options?.requestId,
    stage: request.options?.stage,
    label: request.options?.label,
    thinkingMode: request.model.thinkingMode,
  };
}

// ---------------------------------------------------------------------------
// Stream accumulation helpers (SDK-agnostic)
// ---------------------------------------------------------------------------

/** Mutable accumulator for streaming metrics tracked across chunk events. */
export interface StreamMetrics {
  ttftMs: number | undefined;
  deltaCount: number;
  contentChars: number;
  fullContent: string;
  /** Total characters of hidden reasoning/thinking seen on the stream (not part of `contentChars`). */
  reasoningChars: number;
}

export function createStreamMetrics(): StreamMetrics {
  return { ttftMs: undefined, deltaCount: 0, contentChars: 0, fullContent: '', reasoningChars: 0 };
}

/** Update `metrics` with one content delta chunk and record TTFT on first call. */
export function onContentDelta(metrics: StreamMetrics, delta: string, startTime: number): void {
  if (metrics.ttftMs === undefined) {
    metrics.ttftMs = Date.now() - startTime;
  }
  metrics.deltaCount++;
  metrics.contentChars += delta.length;
  metrics.fullContent += delta;
}

/** Accumulate one reasoning/thinking delta's character count (reasoning text is never retained). */
export function onReasoningDelta(metrics: StreamMetrics, text: string): void {
  metrics.reasoningChars += text.length;
}

// ---------------------------------------------------------------------------
// Response log-field builders
// ---------------------------------------------------------------------------

type TokenFields = { prompt: number; completion: number; total: number; reasoning?: number };

export function buildStreamResponseLogFields(
  request: ChatRequest,
  provider: string,
  metrics: StreamMetrics,
  startTime: number,
  tokens?: TokenFields,
): LogFields {
  return {
    ...buildBaseLogFields(request, provider),
    mode: 'stream',
    latencyMs: Date.now() - startTime,
    ttftMs: metrics.ttftMs,
    deltaCount: metrics.deltaCount,
    contentChars: metrics.contentChars,
    ...(metrics.reasoningChars > 0 ? { reasoningChars: metrics.reasoningChars } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
    content: metrics.fullContent,
  };
}

export function buildCompleteResponseLogFields(
  request: ChatRequest,
  provider: string,
  startTime: number,
  content: string,
  tokens: TokenFields,
  extra?: Record<string, unknown>,
): LogFields {
  return {
    ...buildBaseLogFields(request, provider),
    mode: 'complete',
    latencyMs: Date.now() - startTime,
    contentChars: content.length,
    tokens,
    content,
    ...extra,
  };
}
