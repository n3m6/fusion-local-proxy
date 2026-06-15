# Task 13: Infrastructure tests (OpenAI route, SSE encoder, server)

## Metadata
- **Task:** 13
- **Phase:** 5
- **Route:** full
- **Slice:** Slice 6 (Infra Tests)

## Dependencies
- **Task 08 (OpenAI SSE encoder, route SSE):** The `encodeOpenAiSSE()` function in `src/infrastructure/inbound/http/openai/sse-encoder.ts` must exist and produce SSE strings from `FusionStreamEvent` iterables. The OpenAI route (`route.ts`) must detect `stream: true` in the request body and delegate streaming requests through `encodeOpenAiSSE` via Hono `streamSSE()`, while retaining the existing non-streaming JSON path.
- **Task 10 (Anthropic route in server):** The `createServer()` function in `src/infrastructure/inbound/http/server.ts` must mount `POST /v1/messages` via `createAnthropicRoute(fusionService)`. The `src/infrastructure/inbound/http/anthropic/` directory and its modules must exist so the import does not fail.

## Traceability
- **Acceptance Criteria:** AC-10 (SSE encoding tested), AC-11 (Anthropic route tested)
- **NFRs:** NFR-2 (Hono tested in infrastructure)
- **Replan Gate Criteria:** Phase 5 Gate 2 (test coverage on infrastructure)

## Source Traceability
- **Goals:** AC-10, AC-11
- **Plan:** Task 13, Phase 5 — Polish (Wiring, Tests, Documentation)
- **Design:** Slice 6 (Observability, Tests, and Documentation)
- **Structure:** Slice 6 — `src/infrastructure/inbound/http/openai/route.test.ts`, `src/infrastructure/inbound/http/openai/sse-encoder.test.ts`, `src/infrastructure/inbound/http/server.test.ts` (MODIFY)

## Description

Write three test suites using `node:test` and `node:assert/strict`, matching the existing codebase conventions: colocated `*.test.ts` files, hand-written stubs (no mocking libraries), ESM `.js` extension imports, and kebab-case naming. All tests must import and exercise the real modules under test; stubs are only for port interfaces (`FusionService`).

### 1. OpenAI route integration test (`route.test.ts` — CREATE)

Create a colocated integration test for the OpenAI streaming route. Import `createOpenAiRoute` from `./route.js` and construct a minimal Hono app that mounts it:

```ts
const app = new Hono();
app.post('/v1/chat/completions', createOpenAiRoute(stubFusionService));
```

Use the existing stub pattern from `server.test.ts` (hand-written `AsyncIterable<FusionStreamEvent>` helpers) to drive controlled stream sequences. Do not import from `server.test.ts`; duplicate the helpers or inline the stub construction.

The route under test is expected to:
- Detect `stream: true` in the request body (added in Task 08).
- For streaming requests, use Hono `streamSSE()` and delegate SSE encoding to `encodeOpenAiSSE` (from `./sse-encoder.js`), returning `Content-Type: text/event-stream`.
- For non-streaming requests, buffer all events and return a JSON response via `fusionStreamToOpenAiResponse` (from `./translator.js`), returning `Content-Type: application/json` with `object: "chat.completion"`.

Cover these behaviors:
- **Streaming content-type:** a POST with `stream: true` returns status 200 and `Content-Type: text/event-stream`.
- **Streaming SSE body:** the response body text, when read as a string, contains SSE `data:` lines with `chat.completion.chunk` JSON objects and terminates with `data: [DONE]`.
- **Streaming keep-alive comments:** when the `FusionService` stub yields a `progress` event, the streaming response body contains at least one SSE comment line starting with `: ` (keep-alive).
- **Non-streaming JSON response:** a POST without `stream: true` (or with `stream: false`) returns status 200, `Content-Type: application/json`, and a JSON body with `object: "chat.completion"`.
- **FusionService throws during streaming:** when the stub `FusionService` throws an error (e.g., `new FusionError('all_panels_failed', '…')`), the streaming response either returns a non-200 status or propagates the error through the SSE stream.
- **Invalid JSON body:** a POST with malformed JSON returns status 400 with an error object.

### 2. SSE encoder unit test (`sse-encoder.test.ts` — CREATE)

Create a colocated unit test for the `encodeOpenAiSSE` function exported from `./sse-encoder.js`. The function signature is:

```ts
function encodeOpenAiSSE(events: AsyncIterable<FusionStreamEvent>, model: string): AsyncIterable<string>;
```

Build test `AsyncIterable` sequences inline using async generator functions or manual iterator factories (same pattern as the stubs in `server.test.ts`). Collect the output strings into an array to make assertions.

Cover these behaviors:
- **Progress event → keep-alive comment:** when the iterable yields a `progress` event (e.g., `{ type: 'progress', stage: 'panel', message: 'Running panel models' }`), the encoder emits a line starting with `: ` (SSE comment / keep-alive). The comment text should contain the stage name or message.
- **content_delta event → chat.completion.chunk:** when a `content_delta` event is yielded (e.g., `{ type: 'content_delta', delta: 'Hello' }`), the encoder emits a `data:` line. The JSON payload on that line must have `"object": "chat.completion.chunk"` and a `choices[0].delta.content` field containing the delta text.
- **Model name in chunk:** the `data:` line JSON payload for content chunks includes a `"model"` field whose value matches the `model` string argument passed to `encodeOpenAiSSE` (e.g., `"gpt-4o"`).
- **Multiple content_delta events:** when the iterable yields two or more `content_delta` events in sequence, each produces a separate `data:` chunk line in the same order. The delta text in each chunk matches the corresponding event.
- **done event → [DONE] termination:** when the iterable yields a `done` event (e.g., `{ type: 'done', usage: { ... }, model: 'gpt-4o' }`), the encoder emits `data: [DONE]` as the final output. No further lines are produced after `[DONE]`.
- **content_stop event handling:** when the iterable yields `{ type: 'content_stop' }` between content deltas and the done event, the encoder either emits no output for it or emits a stop-related chunk; in either case, the stream must still reach `data: [DONE]` after the `done` event.
- **Empty / single-event edge:** when the iterable yields only a `done` event (no content deltas), the encoder produces `data: [DONE]` and terminates without emitting any chunk lines.

### 3. Server test — Anthropic route mount (`server.test.ts` — MODIFY)

Add one or more tests to the existing `server.test.ts` file. Preserve every existing test verbatim; do not remove, reorder, or change any existing test. Add new tests at the end of the test block.

The `createServer` function (in `./server.js`) is expected to mount `POST /v1/messages` via `createAnthropicRoute(fusionService)` after Task 10. The new test verifies this mount.

Cover these behaviors:
- **Route mounted — valid body:** a POST to `/v1/messages` with a minimal Anthropic-format JSON body (`{ model: "claude-sonnet-4-5", max_tokens: 100, messages: [{ role: "user", content: "Hello" }] }`) returns a status code other than 404 (the route exists and is reachable).
- **Route mounted — empty body:** a POST to `/v1/messages` with no body (or empty body) also returns a non-404 status (the route is mounted at minimum; implementation may return 400/415/422 but not 404).

Use the same `stubFusionService` and `stubConfigPort` helpers already defined in the file to construct the test app.

## Files
- `src/infrastructure/inbound/http/openai/route.test.ts` (CREATE) — `node:test` integration suite for the OpenAI streaming route: Hono app with `stream: true` returns SSE with `text/event-stream`, non-streaming returns JSON, error handling in streaming path, invalid JSON handling.
- `src/infrastructure/inbound/http/openai/sse-encoder.test.ts` (CREATE) — `node:test` unit suite for `encodeOpenAiSSE`: keep-alive comments for `progress` events, `chat.completion.chunk` for `content_delta`, `[DONE]` for `done`, multiple content deltas, model field in chunk JSON, edge cases.
- `src/infrastructure/inbound/http/server.test.ts` (MODIFY) — Add tests at end of file: `POST /v1/messages` route is mounted and returns non-404 status (both with and without a valid Anthropic body). Preserve all existing tests unchanged.

## Test Expectations
- **Streaming content-type:** When a POST request to `/v1/chat/completions` includes `"stream": true`, the response has status 200 and `Content-Type` header containing `text/event-stream`.
- **Streaming SSE body:** When the streaming response body is consumed as text, it contains lines beginning with `data: ` whose JSON payloads have `"object": "chat.completion.chunk"` and the stream terminates with a `data: [DONE]` line.
- **Streaming keep-alive:** When the `FusionService` stub yields a `progress` event before content, the streaming response body contains at least one line beginning with `: ` (an SSE comment).
- **Non-streaming JSON:** When a POST request to `/v1/chat/completions` does not include `"stream": true`, the response has status 200, content type `application/json`, and the JSON body has `"object": "chat.completion"`.
- **Streaming error from FusionService:** When the `FusionService` stub throws a `FusionError` during stream iteration, the response either has a non-200 status or the SSE stream body contains an error indication (non-200 status or `data:` line with error content).
- **Invalid JSON body:** When a POST request to `/v1/chat/completions` sends a body that is not valid JSON, the response has status 400 with a JSON error body.
- **SSE encoder — keep-alive comment:** When `encodeOpenAiSSE` consumes a `progress` event, the output contains a line starting with `: ` whose text references the stage or message from the event.
- **SSE encoder — chunk format:** When `encodeOpenAiSSE` consumes a `content_delta` event, the output contains a `data:` line whose JSON payload includes `"object": "chat.completion.chunk"` and `choices[0].delta.content` matching the delta text.
- **SSE encoder — model in chunk:** When `encodeOpenAiSSE` is called with a model string, the `data:` line JSON for content chunks includes a `"model"` field equal to that model string.
- **SSE encoder — multiple deltas:** When `encodeOpenAiSSE` consumes a sequence of two `content_delta` events, the output contains two distinct `data:` chunk lines in the same order, each with the correct delta text.
- **SSE encoder — done termination:** When `encodeOpenAiSSE` consumes a `done` event, the output ends with `data: [DONE]` and no further lines follow.
- **SSE encoder — content_stop does not block:** When `encodeOpenAiSSE` consumes a `content_stop` event before `done`, the stream still reaches `data: [DONE]` after the `done` event is consumed.
- **SSE encoder — empty content edge:** When `encodeOpenAiSSE` consumes only a `done` event with no content deltas, the output contains only `data: [DONE]` and no `chat.completion.chunk` lines.
- **Anthropic route mounted — valid body:** When a POST request to `/v1/messages` sends a minimal Anthropic-format JSON body, the response status is not 404.
- **Anthropic route mounted — empty body:** When a POST request to `/v1/messages` sends an empty body, the response status is not 404.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.
