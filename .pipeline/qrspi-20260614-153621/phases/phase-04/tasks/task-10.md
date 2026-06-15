# Task 10: Anthropic inbound route, translator, SSE encoder, server mount, and tests

## Metadata
- **Task:** 10
- **Phase:** 4
- **Route:** full
- **Slice:** Slice 5 (Anthropic Inbound)

## Dependencies
- **09 — AnthropicChatAdapter, factory:** The outbound Anthropic adapter (`AnthropicChatAdapter` implementing `ChatModelPort`) must already exist so the `ChatAdapterFactory` has its `'anthropic'` branch and the `JsonFileConfigAdapter` provider schema accepts `'anthropic'`. This task does not directly import those modules — it only depends on `FusionService` and domain types — but the outbound side must be complete for the system to be end-to-end runnable once this route is mounted.

## Traceability
- **Acceptance Criteria:** AC-11 (AnthropicChatAdapter + /v1/messages route, 6-event SSE sequence in documented order with both `event:` and `data:` SSE fields)
- **NFRs:** NFR-1 (dependency rule: infrastructure → application → domain), NFR-2 (Hono confined to `src/infrastructure/inbound/http/`), NFR-3 (no Anthropic-specific types leak to domain or application layers)
- **Replan Gate Criteria:** Phase 4 Gate 1 (6-event SSE sequence emitted in order: `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`, with both `event:` and `data:` fields), Phase 4 Gate 2 (no type leakage — Anthropic SSE event types and shapes are confined to `src/infrastructure/inbound/http/anthropic/`)

## Source Traceability
- **Goals:** AC-11 — `/v1/messages` route translates Anthropic-format requests to canonical, calls `FusionService`, and maps stream events to full 6-event Anthropic SSE sequence
- **Plan:** Task 10, Phase 4 — Anthropic API Compatibility
- **Design:** Slice 5 (Anthropic Inbound) — Inbound HTTP adapter: Anthropic route + request translator + response translator + SSE encoder, reusing the same `FusionService` inbound port unchanged
- **Structure:** Slice 5 — `src/infrastructure/inbound/http/anthropic/route.ts`, `src/infrastructure/inbound/http/anthropic/translator.ts`, `src/infrastructure/inbound/http/anthropic/sse-encoder.ts`, `src/infrastructure/inbound/http/server.ts` (MODIFY), `src/infrastructure/inbound/http/anthropic/translator.test.ts`, `src/infrastructure/inbound/http/anthropic/route.integration.test.ts`

## Description

Create the full Anthropic-compatible inbound HTTP stack: a request translator that maps Anthropic-format `/v1/messages` request bodies to the canonical `FusionRequest`, an SSE encoder that converts `FusionStreamEvent` iterables into Anthropic SSE event strings with all 6 required event types in the documented wire sequence, and a Hono route handler that wires them together using `FusionService` and Hono's `streamSSE()`. Mount the new route in `server.ts`. Write unit tests for the translator and an integration test for the route.

All Anthropic-specific types, event shapes, and SSE field names are confined to `src/infrastructure/inbound/http/anthropic/`. The domain and application layers are never imported from or modified. The existing `FusionService` inbound port is reused without change.

### Request Translator (`anthropicRequestToFusion`)

Located in `src/infrastructure/inbound/http/anthropic/translator.ts`. Exported function:

```
anthropicRequestToFusion(body: Record<string, unknown>): FusionRequest
```

The Anthropic `/v1/messages` request has these notable differences from an OpenAI-style request:

- `system` is a top-level field (a string or an array of text content blocks), not a message with `role: "system"`. Map it to `FusionRequest.systemPrompt`. If `system` is an array of content blocks, concatenate the `text` fields of blocks whose `type === 'text'`. If `system` is a non-string non-array, treat it as absent.
- `messages` entries have roles `"user"` and `"assistant"` only (no `"system"` role). Each entry's `content` can be a plain string or an array of content blocks. When `content` is an array, extract text by concatenating `.text` from blocks where `type === 'text'` (skip images, tool_use, tool_result, and other non-text blocks). Map each message to the canonical `{ role, content: string }` shape.
- `max_tokens` is a required field in Anthropic (but we accept missing gracefully). Map to `FusionRequest.maxTokens`.
- `model` maps directly to `FusionRequest.model`.
- `stream` (boolean) maps to `FusionRequest.stream`.
- `temperature` maps to `FusionRequest.temperature` and `FusionRequest.options.temperature`.
- Additional Anthropic-only fields (`top_p`, `top_k`, `stop_sequences`, `metadata`) should be preserved in `FusionRequest.options` but may be ignored by downstream code.

The function must handle edge cases gracefully: missing `messages` array (treat as empty), non-array `messages`, messages with missing `content` or `role` (default role to `"user"`, default content to `""`), and missing `model`.

### SSE Encoder (`encodeAnthropicSSE`)

Located in `src/infrastructure/inbound/http/anthropic/sse-encoder.ts`. Exported function:

```
encodeAnthropicSSE(events: AsyncIterable<FusionStreamEvent>, model: string): AsyncIterable<string>
```

This is the low-level formatter. It consumes `FusionStreamEvent` items and yields pre-formatted SSE strings (complete with `event:` and `data:` lines and double-newline termination). The function tracks stream state to emit the 6 Anthropic event types in the correct documented sequence.

**Event sequence and mapping rules:**

1. **`message_start`** — Emitted at stream start, before any content events. The `data:` payload is a JSON object with `type: "message_start"` and a `message` object containing:
   - `id`: a generated message ID (e.g., `msg_` prefix + random UUID segment)
   - `type`: `"message"`
   - `role`: `"assistant"`
   - `content`: `[]` (empty array; content arrives via content_block events)
   - `model`: the `model` parameter passed to the encoder
   - `stop_reason`: `null`
   - `stop_sequence`: `null`
   - `usage`: `{ input_tokens: 0, output_tokens: 0 }`

2. **`content_block_start`** — Emitted immediately after `message_start`, before the first content delta. The `data:` payload has `type: "content_block_start"`, `index: 0`, and a `content_block` object with `type: "text"` and `text: ""`.

3. **`content_block_delta`** — Emitted for each `content_delta` `FusionStreamEvent`. The `data:` payload has `type: "content_block_delta"`, `index: 0`, and a `delta` object with `type: "text_delta"` and `text` set to the delta string.

4. **`content_block_stop`** — Emitted when a `content_stop` `FusionStreamEvent` is received. The `data:` payload has `type: "content_block_stop"` and `index: 0`.

5. **`message_delta`** — Emitted when the `done` `FusionStreamEvent` is received. The `data:` payload has `type: "message_delta"`, a `delta` object with `stop_reason: "end_turn"` and `stop_sequence: null`, and a `usage` object with `output_tokens` set to `event.usage.completionTokens` (or 0 if absent).

6. **`message_stop`** — Emitted immediately after `message_delta`, as the terminal event. The `data:` payload is simply `{ "type": "message_stop" }`.

**Keep-alive:** For `progress` `FusionStreamEvent` items, emit `": heartbeat\n\n"` (an SSE comment, which does not trigger client-side event handlers but keeps the TCP connection alive).

**Error handling:** When an `error` `FusionStreamEvent` is received, stop emitting further content events and do not emit `message_delta` or `message_stop`. Let the error propagate so the route handler can respond with an error status. Do not emit an Anthropic `error` event type; the route handler will manage error responses.

Each SSE string must follow this exact format for event-type messages:
```
event: <event_type>
data: <json_payload>

```
The blank line after `data:` is required (double newline terminates the SSE message). The `json_payload` must be valid JSON on a single line (no internal newlines).

### Stream Translator (`fusionStreamToAnthropicSSE`)

Located in `src/infrastructure/inbound/http/anthropic/translator.ts`. Exported function:

```
fusionStreamToAnthropicSSE(events: AsyncIterable<FusionStreamEvent>, model: string): AsyncIterable<string>
```

This is the public entry point for the route handler. It delegates to `encodeAnthropicSSE` for all formatting. Its responsibility is to handle any stream-level concerns (e.g., ensuring `message_start` is always emitted before content, catching stream errors and wrapping them appropriately). In this implementation, it can be a simple delegating wrapper:

```typescript
export async function* fusionStreamToAnthropicSSE(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): AsyncIterable<string> {
  yield* encodeAnthropicSSE(events, model);
}
```

### Route Handler (`createAnthropicRoute`)

Located in `src/infrastructure/inbound/http/anthropic/route.ts`. Exported function:

```
createAnthropicRoute(fusionService: FusionService): (c: Context) => Promise<Response>
```

Returns a Hono request handler for `POST /v1/messages`. The handler must:

1. **Parse the request body** as JSON. If parsing fails, return a 400 response with `{ error: { type: "invalid_request_error", message: "..." } }`.
2. **Extract the model string** from the parsed body for use in SSE events.
3. **Translate the Anthropic request** by calling `anthropicRequestToFusion(body)`.
4. **Call the ensemble pipeline**: `fusionService.runFusion(fusionRequest)` to obtain an `AsyncIterable<FusionStreamEvent>`.
5. **Encode as Anthropic SSE**: `fusionStreamToAnthropicSSE(events, model)` to obtain an `AsyncIterable<string>`.
6. **Stream the response** using Hono's `streamSSE()` helper (imported from `'hono/streaming'`). For each SSE string from the encoder, write it to the stream via `stream.write(sseString)`.
7. **Handle errors**: If `runFusion()` throws synchronously, or the stream yields an `error` `FusionStreamEvent`, or the encoder encounters an error, catch the exception and return an appropriate error response (e.g., 500 with Anthropic-formatted error JSON: `{ error: { type: "api_error", message: "..." } }`). If the error is a `FusionError`, use its `code` and `message` in the error response.

Use imports:
- `import { streamSSE } from 'hono/streaming';`
- `import type { Context } from 'hono';`
- `import type { FusionService } from '../../../../application/ports/fusion-service.js';`
- `import { FusionError } from '../../../../domain/model/fusion-types.js';`
- `import { anthropicRequestToFusion, fusionStreamToAnthropicSSE } from './translator.js';`

### Server Mount

Modify `src/infrastructure/inbound/http/server.ts`:

1. Add the import: `import { createAnthropicRoute } from './anthropic/route.js';`
2. Inside `createServer()`, add the route mounting: `app.post('/v1/messages', createAnthropicRoute(fusionService));`

The `createServer()` function signature does not change. The new route is mounted alongside the existing `/v1/chat/completions` and `/v1/models` routes.

## Files
- `src/infrastructure/inbound/http/anthropic/translator.ts` (CREATE) — Exports `anthropicRequestToFusion` (maps Anthropic-format request body with `system`, `messages` content blocks, `max_tokens`, `model` to canonical `FusionRequest`) and `fusionStreamToAnthropicSSE` (wraps `encodeAnthropicSSE`; public entry point for SSE encoding).
- `src/infrastructure/inbound/http/anthropic/sse-encoder.ts` (CREATE) — Exports `encodeAnthropicSSE`. Low-level SSE formatter that consumes `FusionStreamEvent` items and yields complete SSE strings for all 6 Anthropic event types in the documented sequence, plus keep-alive comments. Tracks stream state internally. message_start includes model, generated message id, and zeroed usage stub; message_delta includes stop_reason and cumulative output_tokens; message_stop terminates the stream.
- `src/infrastructure/inbound/http/anthropic/route.ts` (CREATE) — Exports `createAnthropicRoute`. Hono request handler for `POST /v1/messages`: parses Anthropic-format JSON body, translates via `anthropicRequestToFusion`, calls `fusionService.runFusion()`, encodes via `fusionStreamToAnthropicSSE()`, and streams the response using Hono's `streamSSE()` helper. Handles JSON parse errors (400), `FusionError` instances (500 with code/message), and generic errors (500).
- `src/infrastructure/inbound/http/server.ts` (MODIFY) — Import `createAnthropicRoute` from `./anthropic/route.js`. Inside `createServer()`, add `app.post('/v1/messages', createAnthropicRoute(fusionService))`. No other changes to the function signature or existing routes.
- `src/infrastructure/inbound/http/anthropic/translator.test.ts` (CREATE) — `node:test` unit suite covering: Anthropic → Fusion request translation (system as string, system as content block array, messages with string content, messages with text content blocks, messages with mixed text and non-text blocks, missing messages, missing model, stream flag, max_tokens, temperature); stream event → Anthropic SSE mapping (verify all 6 event types appear in correct sequence: message_start → content_block_start → content_block_delta* → content_block_stop → message_delta → message_stop; verify each event carries both `event:` and `data:` SSE fields; verify keep-alive `: heartbeat` comments are emitted for progress events; verify message_start payload has model, id, and zeroed usage; verify message_delta payload has stop_reason and output_tokens; verify message_stop terminates); error event handling (error event does not produce message_delta or message_stop, error propagates).
- `src/infrastructure/inbound/http/anthropic/route.integration.test.ts` (CREATE) — `node:test` integration suite using a stubbed `FusionService` and a Hono app instance with `POST /v1/messages` mounted via `createAnthropicRoute`. Tests: valid Anthropic request returns 200 with `text/event-stream` content type and SSE body containing all 6 event types in sequence; keep-alive comments appear for progress events; invalid JSON body returns 400 with Anthropic-formatted error; `FusionError` thrown by `runFusion()` returns 500 with error code and message; stream that yields an error event returns 500; request with `system` as content block array produces correct SSE; messages with text content blocks are correctly extracted.

## Test Expectations
- **Anthropic request with string content messages**: When `POST /v1/messages` is called with a body containing `{ model: "claude-3-opus-20240229", max_tokens: 1024, messages: [{ role: "user", content: "Hello" }] }`, the translator produces a `FusionRequest` with `model: "claude-3-opus-20240229"`, `maxTokens: 1024`, and `messages: [{ role: "user", content: "Hello" }]`.
- **System field as string**: When the request body has `system: "You are a helpful assistant."`, the translator maps it to `FusionRequest.systemPrompt: "You are a helpful assistant."`.
- **System field as content block array**: When the request body has `system: [{ type: "text", text: "Be helpful." }, { type: "text", text: " Be concise." }]`, the translator concatenates the text fields and maps to `FusionRequest.systemPrompt: "Be helpful. Be concise."`. Non-text blocks in the system array are ignored.
- **Messages with text content blocks**: When a message entry has `content: [{ type: "text", text: "Part 1" }, { type: "text", text: " Part 2" }]`, the translator concatenates text blocks and maps to `content: "Part 1 Part 2"`. Non-text blocks (image, tool_use, tool_result) are skipped.
- **Missing messages array**: When the request body has no `messages` field or a non-array `messages`, the translator produces a `FusionRequest` with an empty `messages` array.
- **Stream flag**: When the request body has `stream: true`, the translator sets `FusionRequest.stream: true`. When absent, `stream` is `undefined`.
- **Full 6-event SSE sequence**: When a stubbed `FusionService` yields `[progress(...), content_delta("Hello"), content_delta(" world"), content_stop, done(usage, model)]`, the SSE encoder emits exactly (in order): `: heartbeat\n\n`, `event: message_start\ndata: {...}\n\n`, `event: content_block_start\ndata: {...}\n\n`, `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n`, `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n`, `event: content_block_stop\ndata: {...}\n\n`, `event: message_delta\ndata: {...}\n\n`, `event: message_stop\ndata: {"type":"message_stop"}\n\n`.
- **Each SSE event has both fields**: When the encoder emits a content_block_delta event, the emitted string contains an `event: content_block_delta` line followed by a `data: ` line with valid JSON. No event is emitted with only one of the two fields.
- **message_start payload contains model and generated id**: When the encoder initializes, the message_start `data:` JSON has a `message.model` field matching the model argument, a `message.id` field starting with `msg_`, `message.usage` with `input_tokens: 0` and `output_tokens: 0`, and `message.role: "assistant"`.
- **message_delta includes stop_reason and usage**: When the `done` FusionStreamEvent carries `usage: { promptTokens: 10, completionTokens: 25, totalTokens: 35 }`, the message_delta `data:` JSON has `delta.stop_reason: "end_turn"` and `usage.output_tokens: 25`.
- **message_stop terminates**: After a `done` event, the encoder emits `message_delta` immediately followed by `message_stop`, and no further events are emitted.
- **Progress events produce keep-alive**: When the stream yields a `progress` FusionStreamEvent with `stage: "panel"` and `message: "Calling panel models..."`, the encoder emits `: heartbeat\n\n` (an SSE comment).
- **Error event stops content**: When the stream yields `[content_delta("partial"), error("MODEL_DOWN", "Model unavailable")]`, the encoder emits `message_start`, `content_block_start`, `content_block_delta("partial")`, and then stops — no `content_block_stop`, `message_delta`, or `message_stop` are emitted. The error propagates to the caller.
- **Route returns 200 SSE for valid request**: When a Hono app with `POST /v1/messages` receives a valid Anthropic-format JSON body (with `model`, `max_tokens`, `messages`), and the `FusionService` yields a normal stream, the response has status 200, `content-type: text/event-stream`, and the response body contains all 6 event types in the correct sequence.
- **Route returns 400 for invalid JSON**: When the request body is not parseable JSON, the route returns 400 with `{ error: { type: "invalid_request_error", message: "..." } }`.
- **Route returns 500 on FusionError**: When `fusionService.runFusion()` throws a `FusionError` with code `"all_panels_failed"` and message `"All panel models failed"`, the route returns 500 with `{ error: { type: "api_error", message: "All panel models failed" } }`.
- **Route returns 500 on stream error event**: When the stream yields an `error` FusionStreamEvent (code `"MODEL_DOWN"`, message `"Upstream model unavailable"`), the route returns 500 with an Anthropic-formatted error response containing the message.
- **Server mounts the route**: After modifying `server.ts`, calling `createServer(fusionService, configPort)` returns a Hono app that responds to `POST /v1/messages` (routes are mounted, not necessarily tested end-to-end in this test suite).

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.

## Replan Review Status
- **State:** clean (round 1)
- **Outstanding Concerns:** None.
