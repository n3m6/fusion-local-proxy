# Task 13: Anthropic outbound adapter

## Metadata
- **Task:** 13
- **Phase:** 4
- **Route:** full
- **Slice:** Anthropic API Support

## Dependencies
- **Task 12 — Streaming inbound route and config:** Establishes that `ChatModelPort.stream()` (added in Task 09) is fully wired through the application layer (`SynthesizeStep` uses `stream()`, `RunFusionUseCase` yields `FusionStreamEvent` iterables) and the inbound OpenAI route uses Hono `streamSSE()` to encode SSE events. Task 12 also ensures `fusion.config.json` carries all role assignments (`panel`, `judge`, `synthesizer`) and the `timeoutMs` field, and that the `ChatAdapterFactory` currently throws for `provider.type === 'anthropic'` — the factory modification in this task replaces that throw with constructor logic for `AnthropicChatAdapter`. The `ChatModelPort` interface (with both `complete()` and `stream()`) and the `ChatStreamEvent` discriminated union are stable before this task implements the second concrete adapter against them.

## Traceability
- **Acceptance Criteria:** AC-11 (partial — outbound adapter)
- **NFRs:** NFR-1, NFR-3
- **Replan Gate Criteria:** Phase 4 Gate 2 (no Anthropic types leak to domain/app)

## Source Traceability
- **Goals:** AC-11 — `AnthropicChatAdapter` implements `ChatModelPort` via `@anthropic-ai/sdk` and is selected by `ChatAdapterFactory` when `provider.type === 'anthropic'`
- **Plan:** Task 13, Phase 4 — Anthropic API Compatibility
- **Design:** Slice 5: Anthropic API Support
- **Structure:** Slice 5: Anthropic API Support — `src/infrastructure/outbound/llm/anthropic-chat-adapter.ts` (CREATE), `src/infrastructure/outbound/llm/chat-adapter-factory.ts` (MODIFY)

## Description

Implement the `AnthropicChatAdapter` — the second concrete adapter for `ChatModelPort`, using the `@anthropic-ai/sdk`. Then modify `ChatAdapterFactory` to register it. The `@anthropic-ai/sdk` import must be confined to these two files per NFR-3; no Anthropic-specific types (SDK classes, Anthropic SSE event names, `MessageCreateParams`, `RawMessageStreamEvent`, etc.) may appear in `src/domain/` or `src/application/`.

---

### 1. `AnthropicChatAdapter` (`src/infrastructure/outbound/llm/anthropic-chat-adapter.ts`)

Implements `ChatModelPort` — both `complete()` (non-streaming) and `stream()` (streaming) — using the `@anthropic-ai/sdk`. The adapter imports the `Anthropic` client class from `"@anthropic-ai/sdk"` and uses its `messages.create()` and `messages.stream()` methods.

#### Constructor

```typescript
constructor(client: Anthropic)
```

Receives a pre-configured `Anthropic` client instance. The caller (`ChatAdapterFactory`) is responsible for constructing the client with the correct `baseURL` and `apiKey` from the `ModelRef`. This keeps the adapter testable — a stub/mock client can be injected.

#### `complete(request: ChatRequest): Promise<ChatResponse>`

Maps the canonical `ChatRequest` to Anthropic's `MessageCreateParams`, calls `client.messages.create()`, and maps the SDK `Message` response back to the canonical `ChatResponse`.

##### Request mapping (canonical → Anthropic)

1. **`system` parameter:** Separate system-role messages from the conversation messages. The canonical `Message.role` can be `'system'`, `'user'`, or `'assistant'`. Anthropic's API accepts a top-level `system` parameter (string or array of text content blocks) and a `messages` array containing only `user` and `assistant` roles:
   - Collect every canonical message with `role === 'system'`.
   - If there is exactly one system message, set Anthropic's `system` parameter to that message's `content` string.
   - If there are multiple system messages, join their content strings with `"\n\n"` and set `system` to the joined string.
   - If there are zero system messages, omit the `system` parameter entirely.
   - The `messages` array sent to Anthropic excludes all system-role messages.

2. **`messages` parameter:** Map each remaining canonical message (roles `'user'` or `'assistant'`) to an Anthropic `MessageParam`:
   - `role === 'user'` → `{ role: 'user', content: msg.content }`
   - `role === 'assistant'` → `{ role: 'assistant', content: msg.content }`
   The `content` field in Anthropic's `MessageParam` accepts a plain string for simple text content, which is what the canonical domain model provides.

3. **`model`:** Set to `request.model.model`.

4. **`max_tokens`:** Anthropic's API requires `max_tokens` on every request. Map from `request.options?.maxTokens`:
   - When `maxTokens` is a positive integer, pass it as `max_tokens`.
   - When `maxTokens` is `undefined`, `null`, or `0`, use a default of `4096`. This default covers the fact that the canonical `ChatOptions.maxTokens` is optional but the Anthropic endpoint mandates the field.

5. **`temperature`:** When `request.options?.temperature` is present, pass it through. Otherwise omit.

6. **`response_format` mapping:** The canonical `ResponseFormat` is a discriminated union that maps to Anthropic's structured-output mechanism:
   - `{ type: 'text' }` — no structured-output parameter. The adapter sends no `output_config` or equivalent, relying on Anthropic's default text generation.
   - `{ type: 'json_object' }` — instruct Anthropic to produce JSON output. Set `output_config` with a format that requests JSON output. The exact SDK parameter name depends on the `@anthropic-ai/sdk` v0.104.1 API surface (e.g., `output_config: { format: { type: 'json_object' } }` if supported, or a system-prompt instruction as a fallback). The adapter must produce a best-effort JSON-structured call.
   - `{ type: 'json_schema'; schema: Record<string, unknown> }` — Anthropic does not have a native `json_schema` response format. The adapter maps this to the same JSON output mechanism as `json_object`, ignoring the schema value. The zod validation in the application layer (`safeParse`) provides the actual schema enforcement, so the outbound adapter only needs to request JSON output.

7. **`signal`:** Pass `request.options?.signal` (an `AbortSignal`) to the SDK call's `RequestOptions.signal` field so per-call timeouts configured in the application layer correctly cancel the upstream Anthropic request.

##### Response mapping (Anthropic → canonical)

The SDK `create()` call returns an Anthropic `Message` object. The adapter extracts:

- **`content`:** Anthropic returns `content: Array<ContentBlock>`. The canonical `ChatResponse.content` is a plain string. The adapter extracts the text from the first content block whose `type` is `'text'`. If no text block is found in the array, return `""` (empty string). The adapter reads `content[0].text` for the first text block, or iterates the array to find the first `type === 'text'` block and reads its `text` property. Non-text blocks (tool results, thinking, images) are skipped — they cannot be represented in the canonical `string` content field.

- **`usage`:** Anthropic returns `usage` with `input_tokens` and `output_tokens` (plus optional cache/thinking breakdown fields). Map to the canonical `TokenUsage`:
  - `promptTokens`: `usage.input_tokens`
  - `completionTokens`: `usage.output_tokens`
  - `totalTokens`: `usage.input_tokens + usage.output_tokens`
  If the SDK response has no `usage` field, default all three counts to `0`.

- **`model`:** From `response.model`.

Returns `Promise<ChatResponse>`.

##### Error handling

If the SDK call rejects (network error, API error, authentication failure, rate limit, etc.), the adapter re-throws the error as-is. The caller (application layer) is responsible for catching and translating errors into `FusionError` instances.

#### `stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>`

Uses the same request mapping as `complete()` to build Anthropic `MessageCreateParams`, then calls `client.messages.stream()` and translates the SDK's streaming events into the canonical `ChatStreamEvent` discriminated union.

The method returns an `AsyncIterable<ChatStreamEvent>` so the application layer can consume it with `for await...of`. The implementation uses the `@anthropic-ai/sdk` v0.104.1 `MessageStream` object, which supports both event-based consumption and async iteration.

##### Stream event mapping

The Anthropic SDK's `MessageStream` emits convenience events. The adapter maps them to `ChatStreamEvent` variants:

- **Text delta → `ChatStreamEvent.token`:** For every text delta produced by the stream (the SDK's `'text'` event, or extracted from `content_block_delta` events with `delta.type === 'text_delta'`), yield `{ type: 'token', text: delta.text }`. Each call to `yield` produces one token event per text delta. The `text` string carries the raw delta content from Anthropic — no transformation, aggregation, or buffering.

- **Stream completion → `ChatStreamEvent.done`:** When the stream finishes successfully (all content blocks completed, message finalised), yield `{ type: 'done', usage }` where `usage` is the canonical `TokenUsage` extracted from the final message's usage:
  - `promptTokens`: `input_tokens`
  - `completionTokens`: `output_tokens`
  - `totalTokens`: `input_tokens + output_tokens`
  If the stream ends without usage information (unusual but possible), yield `{ type: 'done' }` with no `usage` field. The `done` event is always the last event yielded on success — no further events follow.

- **Stream error → `ChatStreamEvent.error`:** If the stream terminates abnormally (SDK `'error'` event, `'abort'` event, or an exception thrown during iteration), yield `{ type: 'error', code, message }` where:
  - `code` is a machine-readable identifier: `'upstream_error'` for API/network errors, `'aborted'` for abort/timeout cancellations.
  - `message` is the error's `.message` string, or `"Stream aborted"` for abort events without an error object.
  When an error event is yielded, the stream stops — no `done` event follows.

##### Implementation pattern

The async generator function:

1. Builds the `MessageCreateParams` exactly as `complete()` does (same system-message extraction, max_tokens default, response_format mapping, signal passthrough).
2. Calls `this.client.messages.stream(params)`.
3. Enters an async iteration or event-listening loop over the `MessageStream`.
4. For each text delta: yields `{ type: 'token', text }`.
5. On final message: captures token usage.
6. After the loop completes normally: yields `{ type: 'done', usage }`.
7. On any error or abort during the loop: yields `{ type: 'error', code, message }` and exits.

The `AbortSignal` from `request.options?.signal` is passed to the SDK's `MessageCreateParams` so that an external `AbortController.abort()` call (triggered by the application-layer timeout) causes the stream to terminate with an abort event, which the adapter translates to `ChatStreamEvent.error` with code `'aborted'`.

##### No Anthropic types in stream yields

The `ChatStreamEvent` type is defined in the domain layer (`src/domain/ports/chat-model-port.ts`) and contains only domain types (`TokenUsage`). The adapter yields plain objects matching the `ChatStreamEvent` union — it never yields Anthropic SDK objects, `RawMessageStreamEvent` values, or any provider-specific types. This satisfies Phase 4 Gate 2 (no Anthropic types leak to domain or application layers).

---

### 2. `ChatAdapterFactory` (`src/infrastructure/outbound/llm/chat-adapter-factory.ts`)

Modify the existing factory (created in Task 04) to construct `AnthropicChatAdapter` instances for `provider.type === 'anthropic'`. The factory already supports `'openai'`; this task adds a second branch — the existing `'openai'` logic and the unknown-type throw must remain unchanged in structure.

#### Changes to `create(modelRef: ModelRef): ChatModelPort`

Add a new condition before the existing throw:

- When `modelRef.provider === 'anthropic'`:
  1. Import `Anthropic` from `"@anthropic-ai/sdk"` (at the top of the file, alongside the existing `OpenAI` import from `"openai"`).
  2. Construct an `Anthropic` client with `{ baseURL: modelRef.baseURL, apiKey: modelRef.apiKey }`.
  3. Return `new AnthropicChatAdapter(client)`.

- When `modelRef.provider === 'openai'`: Preserve the existing logic exactly — no changes.

- For any other `modelRef.provider` value: Preserve the existing throw — the error message may remain `Unknown provider type: '<value>'` since the list of known types now includes both `'openai'` and `'anthropic'`.

The factory imports `Anthropic` from `"@anthropic-ai/sdk"` solely for client construction (consistent with how it already imports `OpenAI` from `"openai"`). The adapter class is the only place the SDK is used for API calls. Both files together satisfy NFR-3 — no other file in the project imports `@anthropic-ai/sdk`.

#### Imports added

The file must add:
```typescript
import Anthropic from '@anthropic-ai/sdk';
```

And:
```typescript
import { AnthropicChatAdapter } from './anthropic-chat-adapter.js';
```

The existing `import OpenAI from 'openai'` and `import { OpenAiChatAdapter } from './openai-chat-adapter.js'` remain.

---

### Dependency rule enforcement

- `src/infrastructure/outbound/llm/anthropic-chat-adapter.ts` imports from `@anthropic-ai/sdk` and from `src/domain/ports/chat-model-port.ts` and `src/domain/model/chat-types.ts`. It must have zero imports from `src/application/`.
- `src/infrastructure/outbound/llm/chat-adapter-factory.ts` additionally imports `Anthropic` from `@anthropic-ai/sdk`. It already imports from domain types (`ModelRef`) and the two adapter modules. Zero imports from `src/application/`.
- No Anthropic SDK types, class names, or event-type strings appear in any file under `src/domain/` or `src/application/`.

## Files
- `src/infrastructure/outbound/llm/anthropic-chat-adapter.ts` (CREATE) — `AnthropicChatAdapter` implements `ChatModelPort` via `@anthropic-ai/sdk`: `complete()` maps `ChatRequest` → `MessageCreateParams` and SDK `Message` response → `ChatResponse`; `stream()` maps `MessageStream` events → `ChatStreamEvent` discriminated union (`token`, `done`, `error`)
- `src/infrastructure/outbound/llm/chat-adapter-factory.ts` (MODIFY) — Register `AnthropicChatAdapter` for `provider.type === 'anthropic'` by importing `Anthropic` from `@anthropic-ai/sdk`, constructing an `Anthropic` client from `ModelRef`, and returning `new AnthropicChatAdapter(client)`; preserve the existing `'openai'` branch and unknown-type throw

## Test Expectations
- **Adapter complete maps messages:** When `AnthropicChatAdapter.complete()` receives a `ChatRequest` with `messages: [{ role: "user", content: "hello" }]` and `model.model: "claude-sonnet-4-20250514"`, the underlying Anthropic SDK client is called with a `messages` array containing `{ role: "user", content: "hello" }` and `model: "claude-sonnet-4-20250514"`. The returned `ChatResponse.content` equals the text from the first text-type content block in the SDK response.
- **Adapter extracts system messages:** When `ChatRequest.messages` includes `{ role: "system", content: "You are helpful." }` and `{ role: "user", content: "hi" }`, the SDK is called with `system: "You are helpful."` and `messages: [{ role: "user", content: "hi" }]`. The system-role message does not appear in the `messages` array sent to Anthropic.
- **Adapter merges multiple system messages:** When `ChatRequest.messages` includes two system-role messages `"Be concise."` and `"Use markdown."`, the SDK is called with `system` set to the joined string `"Be concise.\n\nUse markdown."`.
- **Adapter omits system when absent:** When no message has `role: "system"`, the SDK call does not include a `system` parameter.
- **Adapter extracts text content from content blocks:** When the Anthropic SDK returns a `Message` with `content: [{ type: "text", text: "Hello!" }]`, the returned `ChatResponse.content` is `"Hello!"`. When `content` is `[{ type: "tool_use", ... }, { type: "text", text: "Result." }]`, the adapter returns `"Result."` (the first text block). When `content` has no text-type block, the adapter returns `""`.
- **Adapter maps usage correctly:** When the SDK response includes `usage: { input_tokens: 50, output_tokens: 100 }`, the returned `ChatResponse.usage` has `promptTokens: 50`, `completionTokens: 100`, `totalTokens: 150`.
- **Adapter handles missing usage:** When the SDK response has no `usage` field, the returned `ChatResponse.usage` has all three token counts as `0`.
- **Adapter provides default max_tokens:** When `ChatRequest.options` has no `maxTokens` (or it is `undefined`), the SDK is called with `max_tokens: 4096`. Anthropic's endpoint requires this field; the adapter supplies the default.
- **Adapter passes through maxTokens when set:** When `ChatRequest.options.maxTokens` is `500`, the SDK is called with `max_tokens: 500`.
- **Adapter passes temperature:** When `ChatRequest.options.temperature` is `0.3`, the SDK is called with `temperature: 0.3`. When `temperature` is absent from options, the SDK call omits the `temperature` parameter.
- **Adapter maps json_object response format:** When `ChatRequest.options.responseFormat` is `{ type: "json_object" }`, the SDK call includes a structured-output configuration requesting JSON output (either via `output_config` or equivalent mechanism available in `@anthropic-ai/sdk` v0.104.1).
- **Adapter maps json_schema response format:** When `ChatRequest.options.responseFormat` is `{ type: "json_schema", schema: { ... } }`, the adapter requests JSON output (same mechanism as `json_object`). The `schema` value from the domain type is not passed to the Anthropic SDK as a native schema format since Anthropic does not support `json_schema` response format.
- **Adapter passes AbortSignal to complete:** When `ChatRequest.options.signal` is an `AbortSignal` from an `AbortController`, the SDK call includes that signal so that calling `controller.abort()` cancels the upstream request.
- **Adapter complete propagates SDK errors:** When the underlying Anthropic SDK call rejects (network failure, API error, 4xx/5xx status), `complete()` rejects with that same error.
- **Adapter stream yields token events:** When `stream()` is called and the SDK stream produces text deltas `"Hello"`, `" world"`, `"!"`, the async iterable yields `{ type: "token", text: "Hello" }`, then `{ type: "token", text: " world" }`, then `{ type: "token", text: "!" }` in that order.
- **Adapter stream yields done with usage:** After all text deltas have been yielded and the SDK stream completes successfully, the async iterable yields `{ type: "done", usage: { promptTokens: ..., completionTokens: ..., totalTokens: ... } }` and then the iteration ends. The usage values come from the final message's `usage.input_tokens` and `usage.output_tokens`.
- **Adapter stream yields done without usage when unavailable:** When the SDK stream ends without providing usage information, the async iterable yields `{ type: "done" }` (no `usage` property) and then the iteration ends.
- **Adapter stream yields error on upstream failure:** When the SDK stream encounters an API error mid-stream, the async iterable yields `{ type: "error", code: "upstream_error", message: "<error message>" }` and then the iteration ends. No `done` event follows an `error` event.
- **Adapter stream yields error on abort:** When the `AbortSignal` passed via `ChatRequest.options.signal` is triggered during streaming, the async iterable yields `{ type: "error", code: "aborted", message: "..." }` and then the iteration ends.
- **Adapter stream passes request options:** When `ChatRequest` includes `temperature: 0.5` and `maxTokens: 2000`, the `stream()` method builds the same `MessageCreateParams` (including those fields) as `complete()` before passing them to the SDK's `stream()` call.
- **ChatAdapterFactory creates Anthropic adapter:** Calling `ChatAdapterFactory.create()` with `modelRef.provider === "anthropic"` returns an instance of `AnthropicChatAdapter`. When `complete()` is called on the returned adapter with a valid `ChatRequest`, the adapter makes an HTTP request through the `@anthropic-ai/sdk` to the `baseURL` configured in the `ModelRef`.
- **ChatAdapterFactory preserves OpenAI path:** Calling `ChatAdapterFactory.create()` with `modelRef.provider === "openai"` continues to return an `OpenAiChatAdapter` instance with no change in behaviour.
- **ChatAdapterFactory throws on unknown provider:** Calling `ChatAdapterFactory.create()` with `modelRef.provider` set to any value other than `"openai"` or `"anthropic"` throws an `Error` whose message indicates the provider type is unsupported.
- **No Anthropic types in domain or application:** Running `grep -r "MessageCreateParams\|RawMessageStreamEvent\|MessageStream\|from '@anthropic-ai" src/domain/ src/application/` returns no matches. The `@anthropic-ai/sdk` import string appears only in `src/infrastructure/outbound/llm/anthropic-chat-adapter.ts` and `src/infrastructure/outbound/llm/chat-adapter-factory.ts`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
