# Task 09: Anthropic outbound adapter, factory, and config enum

## Metadata
- **Task:** 09
- **Phase:** 4
- **Route:** full
- **Slice:** Slice 5 (Anthropic Outbound)

## Dependencies
- **Task 07 — Domain streaming interface:** `ChatModelPort` is extended with a `stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>` signature, and `ChatStreamChunk` discriminated union type (`content_delta` / `content_stop` / `usage`) exists in `src/domain/model/chat-types.ts`. The `AnthropicChatAdapter` must implement both `complete()` and `stream()` from the extended port interface.

## Traceability
- **Acceptance Criteria:** AC-11 (partial — `AnthropicChatAdapter` implements `ChatModelPort` via `@anthropic-ai/sdk` and is selected by `ChatAdapterFactory` when `provider.type === 'anthropic'`)
- **NFRs:** NFR-1 (architecture dependency rule — adapter lives in infrastructure, imports only domain port/types), NFR-3 (SDK confinement — `@anthropic-ai/sdk` used only in `AnthropicChatAdapter`)
- **Replan Gate Criteria:** Phase 4 Gate 2 (`ChatAdapterFactory.create()` returns an `AnthropicChatAdapter` for `provider.type === 'anthropic'` and the adapter correctly maps canonical request/response types without leaking Anthropic-specific shapes into domain or application layers)

## Source Traceability
- **Goals:** AC-11 — `AnthropicChatAdapter` implements `ChatModelPort` via `@anthropic-ai/sdk` and is selected by `ChatAdapterFactory` when `provider.type === 'anthropic'`.
- **Plan:** Task 09, Phase 4 — Anthropic API Compatibility
- **Design:** Slice 5 — Anthropic API Support (outbound adapter + factory + config enum)
- **Structure:** Slice 5 — `src/infrastructure/outbound/llm/anthropic-chat-adapter.ts`, `src/infrastructure/outbound/llm/chat-adapter-factory.ts`, `src/infrastructure/outbound/config/json-file-config-adapter.ts`, `src/infrastructure/outbound/llm/anthropic-chat-adapter.test.ts`, `src/infrastructure/outbound/llm/chat-adapter-factory.test.ts`

## Description

Create the `AnthropicChatAdapter` — a concrete `ChatModelPort` implementation that translates canonical domain types to Anthropic Messages API calls via `@anthropic-ai/sdk@^0.104.1`. Register it in `ChatAdapterFactory` and extend the config schema to accept `'anthropic'` provider entries.

### AnthropicChatAdapter (`CREATE`)

The class `AnthropicChatAdapter` implements `ChatModelPort`. Its constructor receives an `Anthropic` client instance (the top-level export from `@anthropic-ai/sdk`).

#### `complete(request: ChatRequest): Promise<ChatResponse>`

Maps a canonical `ChatRequest` to an Anthropic `client.messages.create()` call:

1. **System message extraction:** Messages with `role === 'system'` are pulled out of the `messages` array and concatenated into a single string (joined with `'\n\n'`). If one or more system messages exist, this string is passed as the top-level `system` parameter to `client.messages.create()`. If there are no system messages, the `system` parameter is omitted.

2. **Message mapping:** The remaining messages (roles `user` and `assistant` only) are mapped to the Anthropic `messages` array. The `content` of each user message becomes a `{ type: 'text', text: string }` content block wrapped in an array: `{ role: m.role, content: [{ type: 'text', text: m.content }] }`. No system-role messages remain in the `messages` array.

3. **Options mapping:**
   - `model` is set to `request.model.model`.
   - `max_tokens` is set from `request.options?.maxTokens`. If undefined, a reasonable default is applied (Anthropic requires `max_tokens`).
   - `temperature` is forwarded from `request.options?.temperature` when present.
   - If `request.options?.responseFormat?.type === 'json_object'`, the Anthropic `output_config` parameter is set to `{ format: { type: 'json_object', schema: null } }` to request structured JSON output.

4. **AbortSignal:** `request.options?.signal` is forwarded as the `signal` property in the SDK's `RequestOptions` (second argument to `create()`).

5. **Response mapping:** The SDK response has `content: ContentBlock[]` and `usage: Usage`. The adapter extracts the `text` property from the **first** `ContentBlock` with `type === 'text'` as the `ChatResponse.content` (empty string if no text block is present). `TokenUsage` is constructed from the SDK's `usage` object:
   - `promptTokens` ← `usage.input_tokens`
   - `completionTokens` ← `usage.output_tokens`
   - `totalTokens` ← `usage.input_tokens + usage.output_tokens`
   - `model` ← `response.model`

#### `stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>`

Maps a canonical `ChatRequest` to the Anthropic SDK's streaming API (`client.messages.stream()`) and yields `ChatStreamChunk` values:

1. **Request mapping:** The same request-parameter mapping as `complete()` applies (system extraction, message mapping, options mapping, signal forwarding), except the `stream` parameter is implicitly set by using `client.messages.stream()` instead of `client.messages.create()`.

2. **Stream event mapping:** The SDK's `MessageStream` emits events. The adapter listens and yields domain chunks in the canonical order defined by `ChatStreamChunk`:
   - **`text` events:** Each text delta yields a `ChatStreamChunk` with `type: 'content_delta'` and `delta` set to the text snapshot string from the event.
   - **`content_stop`:** When text events have ceased (either because a `finalMessage` event is received or because no further text events are forthcoming), yield a `ChatStreamChunk` with `type: 'content_stop'` to signal the end of content production.
   - **`finalMessage` event:** When the stream completes, the final message's `usage` is extracted and yielded as a `ChatStreamChunk` with `type: 'usage'` — the stream terminator — with `usage` mapped to canonical `TokenUsage` (same mapping as `complete()`).

3. **Non-text content blocks:** Events for `thinking`, `inputJson`, `citation`, `signature_delta`, and other non-text delta types are ignored — only `text` events produce `content_delta` chunks. This ensures the domain layer never sees Anthropic-specific content types.

4. **Error handling:** If the SDK stream emits an `error` event or `client.messages.stream()` rejects, the async generator propagates that error to the caller.

5. **AbortSignal:** Forwarded identically to `complete()` — passed via the SDK's `RequestOptions.signal`.

### ChatAdapterFactory (`MODIFY`)

Add a branch in `create(modelRef: ModelRef): ChatModelPort` to handle `modelRef.provider === 'anthropic'`:

1. Import `Anthropic` (default import) from `@anthropic-ai/sdk`.
2. Import `AnthropicChatAdapter` from `'./anthropic-chat-adapter.js'`.
3. When `provider === 'anthropic'`, instantiate `new Anthropic({ baseURL: modelRef.baseURL, apiKey: modelRef.apiKey })` and return `new AnthropicChatAdapter(client)`.
4. All existing behavior (the `'openai'` branch and the unknown-provider throw) remains unchanged.

### JsonFileConfigAdapter (`MODIFY`)

In `src/infrastructure/outbound/config/json-file-config-adapter.ts`, change the `type` field of `providerSchema` from:

```typescript
type: z.enum(['openai']),
```

to:

```typescript
type: z.enum(['openai', 'anthropic']),
```

This is a one-line change. No migration is needed — existing configs with only `'openai'` providers continue to validate. The `ProviderType` union in `src/domain/model/fusion-types.ts` already includes `'anthropic'`, so this change aligns the runtime validation with the type system.

### AnthropicChatAdapter Test (`CREATE`)

Write a `node:test` suite in `src/infrastructure/outbound/llm/anthropic-chat-adapter.test.ts` using hand-written stub objects for the `Anthropic` SDK client — no real API calls, no mocking libraries. Use `node:assert/strict` for assertions.

The stub `Anthropic` client is a plain object with a `messages` property containing:
- `create(params, options?)` — returns a `Promise` resolving to a stubbed Anthropic `Message` shape.
- `stream(params, options?)` — returns a stubbed `MessageStream` (`AsyncIterable`-like with event emitter behavior). The test manually controls what events the stream emits.

### ChatAdapterFactory Test (`MODIFY`)

Add one new test to the existing `chat-adapter-factory.test.ts` file:
- `ChatAdapterFactory.create()` with `provider: 'anthropic'` returns an instance of `AnthropicChatAdapter`.

Also update the existing "unknown provider" test — it currently tests that `'anthropic'` throws `Unknown provider`. After adding the anthropic branch, the unknown-provider throw must be tested with a different string (e.g., `'unknown'` or `'cohere'`).

## Files
- `src/infrastructure/outbound/llm/anthropic-chat-adapter.ts` (CREATE) — `AnthropicChatAdapter` class implementing `ChatModelPort` via `@anthropic-ai/sdk`. Constructor receives `Anthropic` client. `complete()` maps canonical `ChatRequest` → `client.messages.create()`, extracting system messages to top-level `system` parameter, mapping remaining messages to alternating user/assistant, forwarding `max_tokens`/`temperature`/`responseFormat`/`signal` from options, and returning `ChatResponse` with content from the first text block and `TokenUsage` from `response.usage`. `stream()` uses `client.messages.stream()`, yields `ChatStreamChunk` instances (`content_delta` from text events, `content_stop` when text events cease, `usage` from `finalMessage` as the stream terminator), and forwards `AbortSignal`.
- `src/infrastructure/outbound/llm/chat-adapter-factory.ts` (MODIFY) — Add branch: when `modelRef.provider === 'anthropic'`, create `new Anthropic({ baseURL: modelRef.baseURL, apiKey: modelRef.apiKey })` and return `new AnthropicChatAdapter(client)`. Import `Anthropic` from `@anthropic-ai/sdk` and `AnthropicChatAdapter` from `'./anthropic-chat-adapter.js'`.
- `src/infrastructure/outbound/config/json-file-config-adapter.ts` (MODIFY) — Change `providerSchema` type field from `z.enum(['openai'])` to `z.enum(['openai', 'anthropic'])`.
- `src/infrastructure/outbound/llm/anthropic-chat-adapter.test.ts` (CREATE) — `node:test` suite covering `complete()` request/response mapping, `stream()` chunk mapping, SDK error propagation, and `AbortSignal` forwarding. Uses hand-written stubs for the Anthropic SDK client (no real API calls).
- `src/infrastructure/outbound/llm/chat-adapter-factory.test.ts` (MODIFY) — Add test verifying `ChatAdapterFactory.create()` returns `AnthropicChatAdapter` for `provider: 'anthropic'` ModelRef. Update the unknown-provider throw test to use a provider string not in the enum (e.g., `'cohere'`).

## Test Expectations
- **System message extraction (complete):** When `complete()` is called with a `ChatRequest` whose `messages` array includes `{ role: 'system', content: 'You are helpful.' }` followed by a user message, the stub SDK's `messages.create()` is invoked with the `system` parameter set to `'You are helpful.'` and the `messages` array containing only the user message (no system-role entry).
- **Multiple system messages concatenation:** When `complete()` is called with two system messages, the stub SDK's `messages.create()` receives `system` as the two contents joined by `'\n\n'`.
- **No system messages:** When `complete()` is called with only user and assistant messages, the stub SDK's `messages.create()` is invoked without a `system` parameter.
- **User/assistant message mapping:** When `complete()` is called with a user message and an assistant message, the stub SDK's `messages.create()` receives a `messages` array with both entries, each having `role` and `content` as a single-element array containing `{ type: 'text', text: string }`.
- **Options mapping:** When `complete()` is called with `options.maxTokens: 1024`, `options.temperature: 0.7`, and `options.responseFormat: { type: 'json_object' }`, the stub SDK's `messages.create()` is invoked with `max_tokens: 1024`, `temperature: 0.7`, and `output_config: { format: { type: 'json_object', schema: null } }`.
- **Response content extraction:** When the stub SDK's `create()` resolves with `{ content: [{ type: 'text', text: 'Hello world' }], usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-3' }`, the returned `ChatResponse` has `content: 'Hello world'`, `usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }`, and `model: 'claude-3'`.
- **Empty response content:** When the stub SDK's `create()` resolves with `content` array containing no text blocks (e.g., only `{ type: 'tool_use', ... }`), the returned `ChatResponse.content` is an empty string.
- **SDK error propagation (complete):** When the stub SDK's `create()` rejects with an `Error('API error')`, the adapter's `complete()` call rejects with the same error.
- **AbortSignal forwarding (complete):** When `complete()` is called with `options.signal` set to an `AbortSignal` instance, the stub SDK's `create()` receives that same signal in its second `RequestOptions` argument.
- **Stream content delta mapping:** When `stream()` is called and the stub stream emits a `text` event with delta text `'Hello'`, the async iterator yields `{ type: 'content_delta', delta: 'Hello' }`.
- **Stream multiple deltas:** When the stub stream emits three sequential `text` events (`'A'`, `'B'`, `'C'`), the async iterator yields three `content_delta` chunks in order.
- **Stream content stop before usage:** When the stub stream emits a `finalMessage` event after a sequence of `text` events, the async iterator yields `{ type: 'content_stop' }` followed by `{ type: 'usage', usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } }` — content_stop precedes usage in the canonical order.
- **Stream usage is final element:** When all stream events have been processed, the last yielded chunk is the `usage` chunk (from `finalMessage`); no chunks follow it.
- **Non-text content ignored in stream:** When the stub stream emits a `thinking` event with a delta, no `content_delta` chunk is yielded for that event.
- **Stream error propagation:** When the stub SDK's `stream()` rejects with an `Error('Connection failed')`, the async iterator throws that error when iteration begins.
- **AbortSignal forwarding (stream):** When `stream()` is called with `options.signal`, the stub SDK's `stream()` receives that signal in its `RequestOptions`.
- **Factory creates AnthropicChatAdapter:** When `factory.create()` is called with `{ provider: 'anthropic', model: 'claude-3', baseURL: 'https://api.anthropic.com', apiKey: 'sk-test' }`, the returned value is an instance of `AnthropicChatAdapter`.
- **Factory configures Anthropic client:** When `factory.create()` is called with an anthropic `ModelRef` specifying `baseURL: 'https://custom.example.com'` and `apiKey: 'my-key'`, the `AnthropicChatAdapter` instance's internal client is configured with those values.
- **Factory unknown provider:** When `factory.create()` is called with `provider: 'cohere'` (a value not in the enum), the factory throws an `Error` whose message includes `'Unknown provider'` and the provider string.
- **Config schema accepts anthropic:** A JSON config object with `{ providers: [{ type: 'anthropic', role: 'panel', model: 'claude-3', baseURL: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_KEY' }] }` passes `configSchema.safeParse()` validation.
- **Config schema still accepts openai:** A JSON config object using `type: 'openai'` continues to pass validation unchanged.
- **Config schema rejects unknown type:** A JSON config object with `type: 'unknown-provider'` fails validation.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.

## Review Status
- **State:** clean (round 3)
- **Outstanding Concerns:** None.
