# Task 08: Streaming infrastructure (adapter.stream(), SynthesizeStep upgrade, SSE encoder, route SSE)

## Metadata
- **Task:** 08
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 4 (Streaming Infra)

## Dependencies
- **Task 07** — Provides `ChatModelPort.stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>` method signature and the `ChatStreamChunk` discriminated union type (`content_delta`, `content_stop`, `usage`). This task implements `stream()` on `OpenAiChatAdapter`, upgrades `SynthesizeStep` to call `stream()` instead of `complete()`, and consumes `ChatStreamChunk` in both the adapter implementation and the SSE encoder.

## Traceability
- **Acceptance Criteria:** AC-5 (partial — `OpenAiChatAdapter` stream implementation), AC-10 (SSE keep-alive + `chat.completion.chunk` + `[DONE]`), AC-12 (AbortSignal passthrough in stream)
- **NFRs:** NFR-2 (Hono confined to infrastructure/inbound/http), NFR-3 (openai SDK used only in OpenAiChatAdapter), NFR-4 (only synthesis streams; keep-alive for panel/judge)
- **Replan Gate Criteria:** Phase 3 Gate 1 (SSE stream with keep-alive, `chat.completion.chunk`, `[DONE]`), Phase 3 Gate 2 (timeout cancellation via AbortController)

## Source Traceability
- **Goals:** AC-5, AC-10, AC-12
- **Plan:** Task 08, Phase 3 — Streaming Synthesis. Replan amendment: scope expanded to include SynthesizeStep upgrade from `complete()` to `stream()` (see phase-02/replan/replan-note.md).
- **Design:** Slice 4 — Streaming Synthesis + Timeouts
- **Structure:** Slice 4 — `src/infrastructure/outbound/llm/openai-chat-adapter.ts` (MODIFY), `src/application/usecases/synthesize-step.ts` (MODIFY — upgrade to stream), `src/application/usecases/synthesize-step.test.ts` (MODIFY — update stubs), `src/infrastructure/inbound/http/openai/sse-encoder.ts` (CREATE), `src/infrastructure/inbound/http/openai/route.ts` (MODIFY), `src/infrastructure/inbound/http/openai/translator.ts` (MODIFY)

## Description

This task implements the full streaming infrastructure: the `OpenAiChatAdapter` gains a `stream()` method, `SynthesizeStep` is upgraded from buffered `complete()` to incremental `stream()`, a new SSE encoder translates domain `FusionStreamEvent` iterables into OpenAI-format SSE strings, the OpenAI route detects `stream: true` and switches to Hono's SSE streaming helper, and the translator gains an export that pipes fusion events through the SSE encoder.

### 1. OpenAiChatAdapter.stream() implementation

Add an `async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>` method to `OpenAiChatAdapter`. This method is additive — the existing `complete()` method is preserved unchanged.

**SDK call**: Call `this.client.chat.completions.create()` with the same parameter mapping as `complete()` (messages, model, temperature, max_tokens, response_format) but add `stream: true` to the params object. Pass `{ signal: request.options?.signal }` as the second argument to `create()` so the caller's `AbortController` cancels the upstream LLM connection when fired.

**Chunk mapping**: The OpenAI SDK with `stream: true` returns an async iterable of `ChatCompletionChunk` objects. For each chunk received:
- If `choices[0]?.delta?.content` is a non-empty string, yield `{ type: 'content_delta', delta: content }`.
- If `choices[0]?.finish_reason` is set (e.g. `"stop"`, `"length"`), or if the stream ends without explicit finish, yield `{ type: 'content_stop' }`.
- If the final chunk carries `usage`, yield `{ type: 'usage', usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } }`.

**Error propagation**: Let SDK-level errors (network failures, non-2xx responses) propagate as exceptions from the async generator.

### 2. SynthesizeStep upgrade — from `complete()` to `stream()`

Modify `src/application/usecases/synthesize-step.ts` so that the `synthesize()` method calls `this.chatPort.stream(request)` instead of `this.chatPort.complete(request)`. The method signature, constructor, prompt building, logging, and timeout logic are unchanged. Only the LLM call mechanism changes.

**Before (Phase 2, buffered):**
```
const response = await this.chatPort.complete(request);
// log duration/usage
yield { type: 'content_delta', delta: response.content };
yield { type: 'content_stop' };
yield { type: 'done', usage: response.usage, model: synthesizerModel.model };
```

**After (Phase 3, streamed):**
```
this.loggerPort.logStageStart('synthesis');
const startTime = this.clockPort.now();

let usage: TokenUsage | undefined;

for await (const chunk of this.chatPort.stream(request)) {
  if (chunk.type === 'content_delta') {
    yield { type: 'content_delta', delta: chunk.delta };
  } else if (chunk.type === 'content_stop') {
    yield { type: 'content_stop' };
  } else if (chunk.type === 'usage') {
    usage = chunk.usage;
  }
}

const durationMs = this.clockPort.now() - startTime;
if (usage) {
  this.loggerPort.logStageEnd('synthesis', durationMs, usage);
} else {
  this.loggerPort.logStageEnd('synthesis', durationMs);
}

if (timer !== undefined) {
  clearTimeout(timer);
  timer = undefined;
}

yield {
  type: 'done',
  ...(usage ? { usage } : {}),
  model: synthesizerModel.model,
};
```

The `finally` block (clear timer, abort controller) is preserved unchanged from Phase 2.

**Key points:**
- `content_delta` and `content_stop` events are yielded immediately as they arrive from the stream — no buffering.
- Logging and the final `done` event occur after the stream completes.
- The `RunFusionUseCase` orchestration (which already forwards `content_delta` and `content_stop` events and captures `usage`/`model` from `done`) requires no changes — it already iterates over the `synthesize()` output and forwards events.

### 3. SynthesizeStep test updates

Modify `src/application/usecases/synthesize-step.test.ts` to update stubs and accommodate the `stream()`-based implementation:

- **Stub interface:** The `StubChatModelPort` must now implement `stream()` in addition to (or instead of) `complete()`. The stub's `stream()` returns an async generator yielding `ChatStreamChunk` values in the canonical order: one or more `content_delta` chunks, one `content_stop`, one `usage`.
- **Existing test expectations preserved:** All 13 tests must pass with the new stubs. The event sequence (`content_delta` → `content_stop` → `done`) is identical. The `content_delta` event(s) carry the same aggregate content as before.
- **Error propagation test:** The `stubChatPortReject` helper's `stream()` throws instead of `complete()` rejecting. The iterator rejects with the same error, and `logStageEnd` is not called.
- **Timeout signal test:** The `ChatRequest.options.signal` is still an `AbortSignal` — unchanged.
- **Prompt builder tests:** The `ChatRequest` is built identically — unchanged.
- **Logger tests:** `logStageStart` and `logStageEnd` are still called in the correct order; duration calculation uses the same clock pattern.

### 4. OpenAI SSE encoder (new file)

Create `src/infrastructure/inbound/http/openai/sse-encoder.ts` exporting:

```typescript
export function encodeOpenAiSSE(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): AsyncIterable<string>;
```

This function consumes domain `FusionStreamEvent` values and yields fully-formed SSE strings (each terminated with `\n\n`). It must generate a single `id` string (e.g. `"chatcmpl-"` followed by a random UUID via `crypto.randomUUID()`) and a `created` Unix timestamp (seconds, `Math.floor(Date.now() / 1000)`) at the start of the stream; these values are reused across all content chunks so the stream appears as a single logical completion to the client.

**Event mapping:**

| FusionStreamEvent type | SSE output |
|---|---|
| `progress` with stage `"panel"` | `: panel running\n\n` (keep-alive comment) |
| `progress` with stage `"judge"` | `: judging\n\n` (keep-alive comment) |
| `progress` with any other stage | `: <stage> <message>\n\n` (keep-alive comment) |
| `content_delta` | `data: {"id":"<id>","object":"chat.completion.chunk","created":<created>,"model":"<model>","choices":[{"index":0,"delta":{"content":"<escaped delta>"}}]}\n\n` |
| `content_stop` | `data: {"id":"<id>","object":"chat.completion.chunk","created":<created>,"model":"<model>","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n` |
| `done` | `data: [DONE]\n\n` |
| `error` | `data: {"error":{"code":"<code>","message":"<message>"}}\n\n` followed by stream closure (no further events) |

**String escaping**: Use `JSON.stringify` on the whole payload object to ensure proper escaping of newlines, quotes, and control characters.

**Keep-alive comments**: Progress events produce SSE comment lines (`:` prefix). No `data:` field is emitted for progress events.

**Stream lifecycle**: The `done` event terminates the stream with `data: [DONE]\n\n`. If the input iterable ends without a `done` event, yield `data: [DONE]\n\n` as a safety terminator. If an `error` event is encountered, yield the error JSON then stop iterating.

### 5. Route modification — stream detection and SSE path

Modify `src/infrastructure/inbound/http/openai/route.ts` so that after parsing the request body and translating it to a `FusionRequest`, the route checks `body.stream`:

- **When `stream` is truthy**: Use Hono's `streamSSE()` helper (imported from `hono/streaming`) to create a streaming response. Inside the callback, call `fusionService.runFusion(fusionRequest)` to obtain the `AsyncIterable<FusionStreamEvent>`, pass it through `fusionStreamToOpenAiSSE(events, model)`, and write each emitted string to the response via the stream's `write()` method. Error handling: catch exceptions from `runFusion()` and write an error SSE line before closing.

- **When `stream` is falsy or absent**: Preserve the existing non-streaming path (`c.json()` with `fusionStreamToOpenAiResponse()`). This path is unchanged.

**Imports needed**: Add `import { streamSSE } from 'hono/streaming'` and `import { fusionStreamToOpenAiSSE } from './translator.js'`.

### 6. Translator export — fusionStreamToOpenAiSSE

Add a new exported function to `src/infrastructure/inbound/http/openai/translator.ts`:

```typescript
export function fusionStreamToOpenAiSSE(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): AsyncIterable<string>;
```

This function delegates to `encodeOpenAiSSE(events, model)` from `./sse-encoder.js`. Its purpose is to keep the translator module as the single entry point for mapping fusion events to OpenAI wire formats.

### Important constraints

- The `openai` SDK import must remain confined to `OpenAiChatAdapter`. The SSE encoder and route must not import `openai` — they operate on domain types (`FusionStreamEvent`) only.
- Hono imports (`streamSSE`, `Context`) must remain confined to `src/infrastructure/inbound/http/`.
- The non-streaming JSON path must continue to work exactly as before. This task is additive except for the SynthesizeStep upgrade which replaces the `complete()` call with `stream()`.
- The `SynthesizeStep` constructor signature (`ChatModelPort`, `ConfigPort`, `LoggerPort`, `ClockPort`) must not change — it is already wired in the DI container.

## Files
- `src/domain/ports/chat-model-port.ts` (NO CHANGE — Task 07 already modified this; no further changes in this task)
- `src/infrastructure/outbound/llm/openai-chat-adapter.ts` (MODIFY) — Add `async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>` method using `client.chat.completions.create({ ...params, stream: true }, { signal: request.options?.signal })`. Yield `content_delta` for each delta content token, `content_stop` on stream finish, `usage` from the final chunk.
- `src/application/usecases/synthesize-step.ts` (MODIFY) — Upgrade `synthesize()` from `ChatModelPort.complete()` to `ChatModelPort.stream()`. Replace the single `complete()` call with a `for await` loop over `stream()`. Yield `content_delta` per token chunk, `content_stop` on stream stop, log after stream completion with captured usage, yield `done` with usage and model. Timeout/signal logic and constructor unchanged.
- `src/application/usecases/synthesize-step.test.ts` (MODIFY) — Update `StubChatModelPort` to implement `stream()` returning an async generator of `ChatStreamChunk` values. Update `stubChatPortReject` to throw from `stream()`. All 13 existing test expectations preserved (event types, order, logging, clock, error propagation, timeout signal, prompt content).
- `src/infrastructure/inbound/http/openai/sse-encoder.ts` (CREATE) — Export `encodeOpenAiSSE(events: AsyncIterable<FusionStreamEvent>, model: string): AsyncIterable<string>`. Emits keep-alive comments (`: panel running`, `: judging`) for progress events, OpenAI-format `data:` lines with `chat.completion.chunk` JSON payloads for content events, and `data: [DONE]` termination. Each output string is a complete SSE line with `\n\n` terminator.
- `src/infrastructure/inbound/http/openai/route.ts` (MODIFY) — Detect `stream: true` in request body after parsing. When streaming: use Hono `streamSSE()` to write SSE-formatted strings from `fusionStreamToOpenAiSSE()` piped from `fusionService.runFusion()`. When non-streaming: preserve the existing `c.json()` path unchanged.
- `src/infrastructure/inbound/http/openai/translator.ts` (MODIFY) — Add `export function fusionStreamToOpenAiSSE(events: AsyncIterable<FusionStreamEvent>, model: string): AsyncIterable<string>` that delegates to `encodeOpenAiSSE` from `./sse-encoder.js`.

## Test Expectations
- **OpenAiChatAdapter.stream() yields content_delta chunks**: When the OpenAI SDK stream emits chunks with `choices[0].delta.content` set, the adapter yields `{ type: 'content_delta', delta: <content> }` for each chunk.
- **OpenAiChatAdapter.stream() yields content_stop**: When the OpenAI SDK stream ends (final chunk with `finish_reason` or stream exhaustion), the adapter yields a `{ type: 'content_stop' }` chunk.
- **OpenAiChatAdapter.stream() yields usage from final chunk**: When the final SDK chunk includes a `usage` object, the adapter yields `{ type: 'usage', usage: { promptTokens, completionTokens, totalTokens } }` after `content_stop`.
- **OpenAiChatAdapter.stream() respects AbortSignal**: When the caller provides an AbortSignal in `request.options.signal` and fires it while the stream is active, the async generator stops yielding `ChatStreamChunk` values — subsequent iteration either throws the underlying SDK error or completes abruptly.
- **SynthesizeStep yields content_delta per stream chunk**: When the chat stub's `stream()` yields two `content_delta` chunks (`"Hello"`, `" world"`), the `synthesize()` iterator yields two `{ type: 'content_delta', delta: ... }` events in order.
- **SynthesizeStep yields content_stop then done**: After stream chunks, the event sequence ends with `content_stop` followed by `done` (with usage and model from the `usage` chunk).
- **SynthesizeStep logs after stream completes**: `logStageStart('synthesis')` is called before stream iteration; `logStageEnd('synthesis', durationMs, usage)` is called after the stream completes but before yielding `done`.
- **SynthesizeStep error propagation via stream()**: When the chat stub's `stream()` throws, the async iterator rejects with the same error, `logStageEnd` is not called, and the timer is cleared in `finally`.
- **SynthesizeStep timeout signal unchanged**: The `ChatRequest.options.signal` is still an `AbortSignal` instance when `timeoutMs` is positive.
- **SynthesizeStep prompt builder integration unchanged**: The system prompt is `buildSynthesisSystemPrompt()`; the user prompt includes analysis consensus when analysis is present, and fallback note when analysis is null.
- **SynthesizeStep existing 13 tests pass after migration**: All tests from Phase 2 Task 05 (`content_delta` → `content_stop` → `done` order, logger calls, clock usage, error propagation, timeout signal, prompt builder integration, model ref, done event payload, zero/negative timeout) pass with the new stream-based stubs.
- **SSE encoder emits keep-alive comments for progress events**: When the encoder receives `{ type: 'progress', stage: 'panel', message: 'running' }`, it yields `: panel running\n\n`. When it receives `{ type: 'progress', stage: 'judge', message: 'judging' }`, it yields `: judging\n\n`.
- **SSE encoder emits chat.completion.chunk for content_delta**: When the encoder receives `{ type: 'content_delta', delta: 'Hello' }`, it yields a string containing `data: ` followed by a JSON object with `"object":"chat.completion.chunk"`, `"choices":[{"index":0,"delta":{"content":"Hello"}}]`, the stream's consistent `id` and `created` values, and the provided `model` string, terminated with `\n\n`.
- **SSE encoder emits content_stop chunk with finish_reason**: When the encoder receives `{ type: 'content_stop' }`, it yields a `chat.completion.chunk` JSON line with `"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]`.
- **SSE encoder emits [DONE] on done event**: When the encoder receives `{ type: 'done' }`, it yields exactly `data: [DONE]\n\n` and stops iterating.
- **SSE encoder emits [DONE] when stream ends without done event**: When the input iterable completes without a `done` event, the encoder still yields `data: [DONE]\n\n` as the final output before returning.
- **Route selects SSE path for stream: true**: When `POST /v1/chat/completions` receives a body with `"stream": true`, the response uses SSE content-type and the body contains `data:` lines matching the OpenAI streaming format, with keep-alive comments appearing before content chunks.
- **Route preserves JSON path for stream: false**: When the request body has `"stream": false` or omits the `stream` field, the response is a single JSON object as before (unchanged behavior).
- **fusionStreamToOpenAiSSE delegates to encoder**: Calling `fusionStreamToOpenAiSSE(events, model)` produces the same SSE string sequence as calling `encodeOpenAiSSE(events, model)` directly.
- **Error event terminates SSE stream**: When the encoder receives `{ type: 'error', code: 'ALL_PANELS_FAILED', message: '...' }`, it yields a JSON error line then stops iterating — no `[DONE]` follows.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.

## Replan Review Status
- **State:** clean (round 1)
- **Outstanding Concerns:** None.
