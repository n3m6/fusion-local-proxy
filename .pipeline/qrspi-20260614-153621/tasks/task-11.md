# Task 11: OpenAI streaming adapter and SSE encoder

## Metadata
- **Task:** 11
- **Phase:** 3
- **Route:** full
- **Slice:** Streaming Synthesis + Timeouts

## Dependencies
- **Task 09 — Domain streaming extension:** Extended `ChatModelPort` in `src/domain/ports/chat-model-port.ts` with the `ChatStreamEvent` discriminated union type (`token`, `done`, `error`) and the `stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>` method. Task 11 implements `stream()` on `OpenAiChatAdapter` to satisfy this extended port contract. The `stream()` signature, `ChatStreamEvent` type, and `TokenUsage` import added in Task 09 are the contract this task fulfills.

## Traceability
- **Acceptance Criteria:** AC-10 (partial — SSE encoding: `chat.completion.chunk` JSON and `[DONE]` wire format), AC-12 (partial — `AbortController` / `AbortSignal` wiring from `ChatRequest.options.signal` into the `openai` SDK call)
- **NFRs:** NFR-1 (dependency rule: adapter depends on domain port/types and `openai` SDK; SSE encoder depends only on domain types), NFR-3 (`openai` SDK confined to `OpenAiChatAdapter`; the SSE encoder has zero SDK imports)
- **Replan Gate Criteria:** Phase 3 Gate 1 (SSE encoder ready — `encodeOpenAiSSE` maps `content_delta` → `chat.completion.chunk` and `done` → `[DONE]`), Phase 3 Gate 2 (`AbortController` wired — `AbortSignal` from `ChatRequest.options.signal` is passed to `client.chat.completions.stream()` so a timed-out signal cancels the upstream LLM call)

## Source Traceability
- **Goals:** AC-10 (streaming SSE endpoint emits `chat.completion.chunk` events and `data: [DONE]`), AC-12 (`AbortController` timeout cancels upstream LLM call)
- **Plan:** Task 11, Phase 3 — Streaming Synthesis
- **Design:** Slice 4: Streaming Synthesis + Timeouts
- **Structure:** Slice 4: Streaming Synthesis + Timeouts — `src/infrastructure/outbound/llm/openai-chat-adapter.ts` (MODIFY), `src/infrastructure/inbound/http/openai/sse-encoder.ts` (CREATE)

## Description

This task delivers two artifacts for the streaming pipeline: the `stream()` implementation on `OpenAiChatAdapter` (a cross-phase revisit of the adapter originally created in Task 04) and the OpenAI SSE encoder module that maps domain-level `FusionStreamEvent` values to OpenAI-compatible SSE wire format. Together, these provide the infrastructure-side streaming support that the application layer (Task 10) and inbound route (Task 12) depend on.

---

### Part 1: `OpenAiChatAdapter.stream()` implementation (`src/infrastructure/outbound/llm/openai-chat-adapter.ts`)

Add a `stream()` method to the existing `OpenAiChatAdapter` class. The method implements the `ChatModelPort.stream()` contract added in Task 09, yielding `ChatStreamEvent` objects from the `openai` SDK's streaming convenience method. The existing `complete()` method must remain untouched.

**Method signature:**

```typescript
async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>
```

Returns an async generator that yields `ChatStreamEvent` objects (`{ type: 'token', text }`, `{ type: 'done', usage? }`, `{ type: 'error', code, message }`).

**Request mapping (reuses the same mapping logic as `complete()`):**

1. Map `ChatRequest` → OpenAI SDK params with the same fields as `complete()`:
   - `messages` — passed through (domain `Message` shape `{ role, content }` matches SDK).
   - `model` — set to `request.model.model`.
   - `temperature` — from `request.options?.temperature`.
   - `max_tokens` — from `request.options?.maxTokens`.
   - `response_format` — mapped from `request.options?.responseFormat` using the identical logic as `complete()`: `{ type: 'text' }` → omitted; `{ type: 'json_object' }` → `response_format: { type: 'json_object' }`; `{ type: 'json_schema', schema }` → `response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } }`.

2. Additionally, set `stream_options: { include_usage: true }` so the upstream OpenAI-compatible provider includes token usage in the final chunk of the stream. Without this flag, usage data is unavailable for the terminal `done` event.

**SDK call and `AbortSignal` wiring:**

Call `this.client.chat.completions.stream(params, { signal: request.options?.signal })`.

The second argument is the SDK's `RequestOptions`, which accepts an `AbortSignal` via its `signal` field. When the caller (application layer or DI container) constructs the `ChatRequest` with an `AbortSignal` on `options.signal` — typically from an `AbortController` whose timeout is derived from `ConfigPort.getTimeoutMs()` — the SDK's underlying HTTP request is cancelled if the signal fires before the stream completes. When the signal fires (e.g., 30-second timeout elapses), the SDK raises an `AbortError`, which the adapter catches and translates to a `ChatStreamEvent.error`.

**Stream iteration and event yielding:**

The SDK's `client.chat.completions.stream()` returns a `ChatCompletionStream` (from `openai` v6), which is an `AsyncIterable<ChatCompletionChunk>`. The method iterates this:

1. **Token events:** For each `ChatCompletionChunk` yielded by `for await (const chunk of sdkStream)`, extract `chunk.choices?.[0]?.delta?.content`. When the delta string is non-empty, yield `{ type: 'token' as const, text: delta }`. The `readonly` convention for all event fields is upheld.

2. **Done event:** After the `for await` loop completes normally (stream exhausted by the provider), extract usage information. The adapter calls `await sdkStream.finalChatCompletion()` to obtain the assembled `ChatCompletion` response, then reads `finalChatCompletion.usage` (if present) to construct a `TokenUsage` object with `promptTokens`, `completionTokens`, and `totalTokens`. If usage is unavailable (e.g., the provider omits it despite `stream_options.include_usage`), `usage` is `undefined` on the done event. Yield `{ type: 'done' as const, usage }` as the terminal event. (If `usage` is `undefined`, the field is omitted from the event object.)

3. **Error event:** If the `for await` loop throws, or if the SDK stream emits an error:
   - Catch the error.
   - Determine the error code: `'timeout'` when `error.name === 'AbortError'` (the `AbortSignal` fired), otherwise `'upstream_error'` (network failure, API error, etc.).
   - Determine the message: `error.message` if `error instanceof Error`, otherwise `String(error)`.
   - Yield `{ type: 'error' as const, code, message }` as the terminal event.
   - The method does **not** re-throw — all failures are surfaced through the `AsyncIterable` as `error` events so the caller can handle them uniformly.

**Design notes:**

- The async generator pattern (`async *stream()`) ensures the `AsyncIterable<ChatStreamEvent>` return type is satisfied without an explicit wrapper class.
- The `for await...of` loop is the only iteration mechanism used — the SDK's `.on('content', ...)` event emitter is not wired, keeping the implementation compatible with the standard async iteration protocol.
- The `complete()` method is not modified. The two methods coexist on the same class, sharing the same `private readonly client: OpenAI` field injected via the constructor (unchanged from Task 04).
- The method imports `ChatStreamEvent` from `../../../domain/ports/chat-model-port.js` (added by Task 09) and `TokenUsage` from `../../../domain/model/chat-types.js` (already imported by the file for `complete()`).

---

### Part 2: OpenAI SSE encoder (`src/infrastructure/inbound/http/openai/sse-encoder.ts`)

Create a new module that exports two stateless pure functions for encoding `FusionStreamEvent` values and keep-alive signals into OpenAI-compatible SSE wire format strings.

The SSE wire format follows the OpenAI specification: each data event is a `data:` line containing a JSON payload followed by a blank line (`\n\n`). Keep-alive/progress signals use SSE comment lines (`:` prefix). No `event:` field is emitted — OpenAI chat completion chunks do not use the SSE `event:` field.

#### `encodeOpenAiSSE(event: FusionStreamEvent): string | null`

Maps a `FusionStreamEvent` to an SSE data line string, or returns `null` when the event should not produce SSE output.

| Event type | Output | Details |
|---|---|---|
| `content_delta` | `data: <ChatCompletionChunk JSON>\n\n` | Constructs a valid `ChatCompletionChunk` JSON object and serialises it. |
| `done` | `data: [DONE]\n\n` | The OpenAI SSE sentinel signalling stream termination. |
| `progress` | `null` | Progress is surfaced via `encodeKeepAlive`, not as SSE data events. |
| `content_stop` | `null` | In streaming mode, completion is signalled by `[DONE]`, not a separate stop chunk. |
| `error` | `null` | Errors are handled by the route handler (Task 12), which writes an error comment or closes the stream. This encoder only handles the positive path. |

**`content_delta` chunk shape:**

When `event.type === 'content_delta'`, the function constructs a JSON object with this schema and serialises it with `JSON.stringify`:

```json
{
  "id": "fusion-{timestamp}-{random}",
  "object": "chat.completion.chunk",
  "created": {Unix timestamp in seconds},
  "model": "fusion",
  "choices": [
    {
      "index": 0,
      "delta": { "content": "{event.delta}" },
      "finish_reason": null
    }
  ]
}
```

- `id` — a unique chunk identifier. Since the function is stateless, it generates a fresh ID on each call using `fusion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`. Uniqueness per chunk is sufficient; no cross-chunk correlation is required.
- `object` — always `"chat.completion.chunk"`.
- `created` — `Math.floor(Date.now() / 1000)` on each call.
- `model` — always `"fusion"`. The encoder has no access to the actual model name (the `FusionStreamEvent` does not carry it), and `"fusion"` is a reasonable default since the proxy presents itself as a single model.
- `choices[0].delta.content` — the `event.delta` string.
- `choices[0].finish_reason` — always `null` for content delta events. The `done` event terminates the stream, not a finish_reason on a chunk.

The return value is `data: ${JSON.stringify(chunk)}\n\n`. No `event:` line is prepended.

**`done` output:**

Returns the literal string `data: [DONE]\n\n`. No JSON wrapping, no additional fields — this matches the OpenAI wire format exactly.

**Null cases:**

For `progress`, `content_stop`, and `error` events, the function returns `null`. The caller (route handler in Task 12) uses the `null` return to decide whether to call `writeSSE()` or skip. This keeps the encoder focused and the route handler in control of stream lifecycle.

#### `encodeKeepAlive(stage: string): string`

Returns an SSE comment line for keep-alive/progress communication. The function takes a human-readable stage description (e.g., `"panel running"`, `"judging"`, `"synthesizing"`) and returns the SSE wire format.

Output format: `: {stage}\n\n`

Examples:
- `encodeKeepAlive("panel running")` → `": panel running\n\n"`
- `encodeKeepAlive("judging")` → `": judging\n\n"`

SSE clients ignore lines starting with `:` (comments), so these serve as keep-alive signals without affecting the parsed data stream. They prevent the client or intermediate proxies from timing out the connection during the non-streamed panel and judge phases.

**Imports:**

The module imports only from domain types — specifically `FusionStreamEvent` from `../../../../domain/model/stream-types.js`. There are zero imports from any SDK (`openai`, `@anthropic-ai/sdk`, `hono`, `zod`) or from `src/application/` or `src/infrastructure/` (other infrastructure modules), satisfying NFR-1 and NFR-3.

---

## Files
- `src/infrastructure/outbound/llm/openai-chat-adapter.ts` (MODIFY) — Add `stream()` async generator method implementing `ChatModelPort.stream()` using `openai` SDK `client.chat.completions.stream()`; wire `AbortSignal` from `ChatRequest.options.signal` into the SDK call; map `ChatCompletionChunk` deltas to `ChatStreamEvent.token` events; yield terminal `done` (with optional usage from `stream.finalChatCompletion()`) or `error` (on `AbortError` → code `'timeout'`, otherwise `'upstream_error'`); preserve existing `complete()` method unchanged.
- `src/infrastructure/inbound/http/openai/sse-encoder.ts` (CREATE) — `encodeOpenAiSSE(event: FusionStreamEvent): string | null` — maps `content_delta` → `data: <ChatCompletionChunk JSON>\n\n` (fresh `id`, `created`, `model: "fusion"`, `choices[0].delta.content`, `finish_reason: null`), `done` → `data: [DONE]\n\n`, all other event types → `null`; `encodeKeepAlive(stage: string): string` — returns `: {stage}\n\n` SSE comment line.

## Test Expectations
- **SSE encoder — content_delta produces chunk:** Calling `encodeOpenAiSSE({ type: 'content_delta', delta: 'Hello' })` returns a string starting with `data: ` and ending with `\n\n`. Parsing the `data:` portion as JSON yields an object with `object: "chat.completion.chunk"`, `choices[0].delta.content: "Hello"`, `choices[0].index: 0`, `choices[0].finish_reason: null`, a string `id`, a number `created`, and `model: "fusion"`. Two sequential calls produce different `id` values.
- **SSE encoder — done produces sentinel:** Calling `encodeOpenAiSSE({ type: 'done', usage: undefined })` returns exactly `data: [DONE]\n\n`.
- **SSE encoder — progress returns null:** Calling `encodeOpenAiSSE({ type: 'progress', stage: 'panel', message: 'Running panel...' })` returns `null`.
- **SSE encoder — content_stop returns null:** Calling `encodeOpenAiSSE({ type: 'content_stop' })` returns `null`.
- **SSE encoder — error returns null:** Calling `encodeOpenAiSSE({ type: 'error', code: 'timeout', message: 'timed out' })` returns `null`.
- **SSE encoder — keep-alive format:** Calling `encodeKeepAlive('panel running')` returns exactly `: panel running\n\n`. Calling `encodeKeepAlive('judging')` returns exactly `: judging\n\n`.
- **SSE encoder — empty string stage:** Calling `encodeKeepAlive('')` returns `: \n\n` (comment with empty body, valid SSE).
- **Adapter stream — yields token events:** When `OpenAiChatAdapter.stream()` receives a `ChatRequest` with `messages: [{ role: 'user', content: 'Say hello' }]` and the stub/mock SDK stream yields chunks with delta contents `"Hello"`, `" world"`, `"!"`, the async generator yields `{ type: 'token', text: 'Hello' }`, `{ type: 'token', text: ' world' }`, `{ type: 'token', text: '!' }` in that order.
- **Adapter stream — yields done event with usage:** When the SDK stream completes successfully and `sdkStream.finalChatCompletion()` returns a `ChatCompletion` with `usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }`, the async generator yields a terminal `{ type: 'done', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }` after all token events.
- **Adapter stream — yields done event without usage:** When the SDK stream completes but `sdkStream.finalChatCompletion()` returns a response with no `usage` field, the terminal event is `{ type: 'done' }` (no `usage` property on the object).
- **Adapter stream — yields error event on AbortError:** When the SDK stream throws an error whose `name` is `'AbortError'` (the `AbortSignal` from `request.options.signal` fires mid-stream), the async generator yields a terminal `{ type: 'error', code: 'timeout', message: '<error.message>' }` instead of a `done` event. The generator does not re-throw.
- **Adapter stream — yields error event on upstream error:** When the SDK stream throws a network error or API error (not `AbortError`), the async generator yields a terminal `{ type: 'error', code: 'upstream_error', message: '<error.message>' }`.
- **Adapter stream — passes AbortSignal to SDK:** When `request.options.signal` is an `AbortSignal` instance, the underlying `this.client.chat.completions.stream()` is called with `{ signal: request.options.signal }` as the second argument. When `request.options.signal` is `undefined` or `request.options` is absent, no `signal` is passed to the SDK call.
- **Adapter stream — passes options to SDK:** When `request.options` includes `temperature: 0.7` and `maxTokens: 256`, the SDK is called with `temperature: 0.7` and `max_tokens: 256`.
- **Adapter stream — passes response_format json_object:** When `request.options.responseFormat` is `{ type: 'json_object' }`, the SDK params include `response_format: { type: 'json_object' }`.
- **Adapter stream — passes response_format json_schema:** When `request.options.responseFormat` is `{ type: 'json_schema', schema: { type: 'object', properties: { x: { type: 'string' } } } }`, the SDK params include `response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: { type: 'object', properties: { x: { type: 'string' } } } } }`.
- **Adapter stream — sets stream_options.include_usage:** The SDK params always include `stream_options: { include_usage: true }` so usage is available in the terminal chunk.
- **Adapter stream — handles empty deltas:** When an SDK chunk has `delta.content` that is `null`, `undefined`, or empty string, no `token` event is yielded for that chunk. The generator skips empty deltas silently.
- **Adapter stream — adapter imports and dependency rule:** The modified `openai-chat-adapter.ts` imports `ChatStreamEvent` from the domain port file and `openai` SDK types. It does not import from `src/application/` or any other infrastructure module. It does not import `@anthropic-ai/sdk`, `hono`, or `zod`.
- **SSE encoder — no SDK imports:** The file `src/infrastructure/inbound/http/openai/sse-encoder.ts` has zero imports from `openai`, `@anthropic-ai/sdk`, `hono`, or any SDK. It imports only domain model types (`FusionStreamEvent` from `stream-types.ts`).

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
