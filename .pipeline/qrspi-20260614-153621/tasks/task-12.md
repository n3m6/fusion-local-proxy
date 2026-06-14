# Task 12: Streaming inbound route and config

## Metadata
- **Task:** 12
- **Phase:** 3
- **Route:** full
- **Slice:** Streaming Synthesis + Timeouts

## Dependencies
- **Task 10** — `RunFusionUseCase` now yields a streaming `AsyncIterable<FusionStreamEvent>` from `runFusion()`. The iterable produces `progress` events during the panel and judge stages, `content_delta` events for each synthesis token, `content_stop` as a marker after synthesis completes, and a final `done` event carrying `TokenUsage` and `failedModels`. On synthesis failure, the iterable yields an `error` event and terminates without a `done` event. The route must iterate this iterable and dispatch each event to the appropriate SSE or JSON encoding path.
- **Task 11** — `OpenAiChatAdapter` implements `ChatModelPort.stream()` using the `openai` SDK's `client.chat.completions.stream()` convenience method with `AbortSignal` wiring from `ChatRequest.options.signal`. The SSE encoder module (`src/infrastructure/inbound/http/openai/sse-encoder.ts`) exports two functions: `encodeOpenAiSSE(event: FusionStreamEvent): string | null` — maps `content_delta` to an OpenAI `chat.completion.chunk` JSON string and `done` to the `[DONE]` sentinel, returning `null` for events that produce no SSE output (e.g., `progress`, `content_stop`); and `encodeKeepAlive(stage: string): string` — returns an SSE comment line string (e.g., `: panel running\n\n`, `: judging\n\n`). This task's route handler and translator consume these exports.

## Traceability
- **Acceptance Criteria:** AC-10, AC-12
- **NFRs:** NFR-1, NFR-2, NFR-4
- **Replan Gate Criteria:** Phase 3 Gate 1 (end-to-end SSE streaming verified), Phase 3 Gate 2 (timeout verified)

## Source Traceability
- **Goals:** AC-10 (streaming SSE endpoint emits keep-alive comments during panel and judge phases, followed by proper OpenAI-format `chat.completion.chunk` events for synthesis tokens, and terminates with `data: [DONE]`), AC-12 (per-call `AbortController` timeout cancels upstream LLM call — consumed via `ConfigPort.getTimeoutMs()` from config)
- **Plan:** Task 12, Phase 3 — Streaming Synthesis
- **Design:** Slice 4 — Streaming Synthesis + Timeouts
- **Structure:** Slice 4 — Streaming Synthesis + Timeouts; files `src/infrastructure/inbound/http/openai/route.ts`, `src/infrastructure/inbound/http/openai/translator.ts`, `fusion.config.json`

## Description

Modify the OpenAI inbound route to support SSE streaming when the client requests `stream: true`. The route detects the streaming flag in the parsed request, branches to a Hono `streamSSE()` handler for streaming or falls back to the existing buffered JSON response for non-streaming calls. Add a `fusionStreamToOpenAiSSE()` function to the OpenAI translator that delegates SSE-format encoding to the sse-encoder module. Ensure `fusion.config.json` carries the `timeoutMs` field consumed by `ConfigPort.getTimeoutMs()` for per-call `AbortController` deadlines.

### Current state (after Task 05)

The `createOpenAiRoute` factory in `route.ts` returns an async handler function that:
1. Parses the JSON body into `Record<string, unknown>`.
2. Calls `openAiRequestToFusion(body)` to produce a `FusionRequest`.
3. Calls `fusionService.runFusion(fusionRequest)` to get an `AsyncIterable<FusionStreamEvent>`.
4. Passes the iterable to `fusionStreamToOpenAiResponse(events)` which buffers all events and returns a single `ChatCompletion` JSON response object.
5. Returns `c.json(response)`.

There is no streaming path — every request is buffered. The `FusionRequest.stream` field is parsed but ignored by the route handler.

### Streaming route (`src/infrastructure/inbound/http/openai/route.ts`)

Modify `createOpenAiRoute` so that when `fusionRequest.stream` is `true`, the handler returns a Hono `streamSSE()` response instead of buffering all events into a single JSON response.

**Imports to add:**

```typescript
import { streamSSE } from 'hono/streaming';
import { encodeKeepAlive } from './sse-encoder.js';
import { fusionStreamToOpenAiSSE } from './translator.js';
```

The `streamSSE` function is a named export from `'hono/streaming'` (part of the `hono` package). The `createOpenAiRoute` function already imports `fusionStreamToOpenAiResponse` from the translator — this import remains for the non-streaming path.

**Handler logic after body parsing and translation:**

After `const fusionRequest = openAiRequestToFusion(body);`, branch on `fusionRequest.stream`:

```typescript
if (fusionRequest.stream) {
  return streamSSE(c, async (stream) => {
    try {
      const events = fusionService.runFusion(fusionRequest);
      for await (const event of events) {
        switch (event.type) {
          case 'progress':
            // Emit keep-alive comment via base StreamingApi.write()
            await stream.write(encodeKeepAlive(event.stage));
            break;

          case 'content_delta':
          case 'done': {
            const sseData = fusionStreamToOpenAiSSE(event);
            if (sseData !== null) {
              await stream.writeSSE({ data: sseData });
            }
            break;
          }

          case 'error': {
            const sseData = fusionStreamToOpenAiSSE(event);
            if (sseData !== null) {
              await stream.writeSSE({ data: sseData });
            }
            // Terminate the stream after an error — no further events
            return;
          }

          case 'content_stop':
            // content_stop is a marker event with no SSE wire output.
            // encodeOpenAiSSE returns null for it, so no action is needed.
            break;
        }
      }
    } catch (err) {
      // If the iterable throws (e.g., generator exception), emit an error
      // SSE event so the client sees a graceful failure rather than a
      // truncated stream.
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        data: JSON.stringify({ error: { message } }),
      });
    }
  });
}
```

**Key behaviors:**

1. **`streamSSE` lifecycle**: `streamSSE(c, callback)` returns a `Response` with `Content-Type: text/event-stream`. The callback receives an `SSEStreamingApi` instance (which extends `StreamingApi`). When the callback resolves or throws, `streamSSE` closes the underlying `TransformStream` cleanly.

2. **Keep-alive comments**: Progress events carry a `stage` field (`'panel'` or `'judge'`) and a `message` field (human-readable string). The `encodeKeepAlive(stage)` function from the sse-encoder formats an SSE comment line — e.g., `: panel running\n\n` or `: judging\n\n`. The route writes this raw string via `stream.write()` (the base `StreamingApi.write()` method, not the SSE-specific `writeSSE()`). SSE comment lines (starting with `:`) are ignored by SSE clients but keep the TCP connection alive during the non-streamed panel and judge phases, satisfying NFR-4.

3. **Data events**: `content_delta` and `done` events are passed to `fusionStreamToOpenAiSSE(event)`, which delegates to `encodeOpenAiSSE` in the sse-encoder. The encoder returns:
   - For `content_delta`: a JSON string like `{"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"...","choices":[{"index":0,"delta":{"content":"<text>"},"finish_reason":null}]}`.
   - For `done`: the string `"[DONE]"` (the OpenAI SSE sentinel).
   
   These strings are emitted via `stream.writeSSE({ data: sseData })`, which produces `data: <json>\n\n` or `data: [DONE]\n\n` on the wire.

4. **Error events**: When a `FusionStreamEvent.error` is yielded, the route emits an SSE data event with error details (via `fusionStreamToOpenAiSSE`) and then returns from the callback, terminating the stream. The client sees an error SSE event followed by stream closure — no `[DONE]` sentinel is emitted.

5. **`content_stop` handling**: The `content_stop` event is a domain marker (signals the synthesis content stream has ended) with no SSE wire representation. `encodeOpenAiSSE` returns `null` for it, so the route has no work to do. The event is safely ignored.

6. **Uncaught errors in the callback**: If the `for await` loop or any `write`/`writeSSE` call throws unexpectedly, the `catch` block emits a generic error SSE event before the stream closes. This prevents the client from hanging on a truncated stream.

7. **Import restriction (NFR-1, NFR-2)**: The route file imports `streamSSE` from `'hono/streaming'`, which is permitted under NFR-2 (Hono confined to `src/infrastructure/inbound/http/`). The file must not import from any SDK (`openai`, `@anthropic-ai/sdk`) or from `src/domain/` or `src/application/` except for type-only imports of port interfaces.

**Non-streaming path preserved:**

When `fusionRequest.stream` is not `true` (i.e., `false`, `undefined`, or absent), the existing buffered behavior from Task 05 runs unchanged:

```typescript
try {
  const events = fusionService.runFusion(fusionRequest);
  const response = await fusionStreamToOpenAiResponse(events);
  return c.json(response);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: { message } }, 500);
}
```

This path collects all `FusionStreamEvent` events into a single `ChatCompletion` JSON response object and returns it with status 200. Errors (including `FusionError` thrown from the translator on `error` events) are caught and returned as 500 with `{ error: { message } }`.

### Streaming translator (`src/infrastructure/inbound/http/openai/translator.ts`)

Add a new export to the existing translator module:

```typescript
import { encodeOpenAiSSE } from './sse-encoder.js';

/**
 * Maps a single FusionStreamEvent to an OpenAI SSE wire-format string.
 * Delegates encoding to the sse-encoder module.
 *
 * Returns null for events that produce no SSE output
 * (e.g., progress, content_stop).
 *
 * @returns An SSE data payload string (JSON for content_delta/error,
 *          "[DONE]" for done), or null if the event should not produce output.
 */
export function fusionStreamToOpenAiSSE(event: FusionStreamEvent): string | null {
  return encodeOpenAiSSE(event);
}
```

**Signature:**

```typescript
export function fusionStreamToOpenAiSSE(event: FusionStreamEvent): string | null;
```

The function is pure and synchronous. It delegates entirely to `encodeOpenAiSSE` from the sse-encoder module created in Task 11. The translator function exists as the public API entry point for the OpenAI adapter — callers outside the `openai/` directory (namely the route handler) should import from the translator rather than reaching into `sse-encoder.ts` directly.

**Return value contract:**

- `content_delta` → A JSON string representing an OpenAI `chat.completion.chunk` object.
- `done` → The string `"[DONE]"`.
- `progress` → `null` (keep-alive is handled separately via `encodeKeepAlive` in the route).
- `content_stop` → `null` (no SSW wire output for this marker).
- `error` → A JSON string with error details (formatted by `encodeOpenAiSSE` in Task 11), or `null` if the encoder chooses to suppress error SSE output. Regardless of the return value, the route handler terminates the stream after an error event.

**Existing exports preserved:**

- `openAiRequestToFusion(body: Record<string, unknown>): FusionRequest` — unchanged.
- `fusionStreamToOpenAiResponse(events: AsyncIterable<FusionStreamEvent>): Promise<Record<string, unknown>>` — unchanged; used only by the non-streaming path.

**Import restriction (NFR-1):** The translator file imports from `src/domain/model/` (type-only), `src/domain/model/stream-types.js` (type-only for `FusionStreamEvent`), and `./sse-encoder.js` (the encoder module). It must not import from `src/application/`, `src/infrastructure/outbound/`, `openai`, `@anthropic-ai/sdk`, `hono`, or any other npm package.

### Configuration (`fusion.config.json`)

Ensure the top-level `timeoutMs` field is present in `fusion.config.json` with a default value of `30000` (30 seconds per LLM call). This field is consumed by `ConfigPort.getTimeoutMs()`, which the outbound adapter uses to create an `AbortController` with the configured deadline.

**Expected field:**

```json
{
  "providers": [ /* existing provider entries */ ],
  "timeoutMs": 30000
}
```

- If the file already contains `timeoutMs`, verify it is a positive integer and leave the value as-is — the user may have configured a custom timeout.
- If the field is absent, add `"timeoutMs": 30000` as a top-level property (sibling to `"providers"`).
- The `JsonFileConfigAdapter` (Task 04) reads this field via its zod schema and exposes it through `ConfigPort.getTimeoutMs()`. No changes to the adapter are needed in this task — it should already support `timeoutMs` since it appears in the original `ConfigPort` interface defined in Slice 1.

## Files
- `src/infrastructure/inbound/http/openai/route.ts` (MODIFY) — Add `streamSSE` import from `'hono/streaming'` and `encodeKeepAlive` import from `'./sse-encoder.js'`. Add `fusionStreamToOpenAiSSE` import from `'./translator.js'`. After body parsing and `openAiRequestToFusion()`, branch on `fusionRequest.stream`: when `true`, return `streamSSE(c, async (stream) => { ... })` that iterates `fusionService.runFusion()` and dispatches `progress` events via `stream.write(encodeKeepAlive(event.stage))`, `content_delta`/`done` events via `stream.writeSSE({ data: fusionStreamToOpenAiSSE(event) })`, and `error` events via `stream.writeSSE({ data: ... })` then return. Catch unexpected errors in the callback and emit a generic error SSE event. The non-streaming path (buffered `fusionStreamToOpenAiResponse` + `c.json`) is preserved unchanged.
- `src/infrastructure/inbound/http/openai/translator.ts` (MODIFY) — Add import of `encodeOpenAiSSE` from `'./sse-encoder.js'`. Add export: `fusionStreamToOpenAiSSE(event: FusionStreamEvent): string | null` — a pure synchronous function that delegates to `encodeOpenAiSSE(event)`. All existing exports (`openAiRequestToFusion`, `fusionStreamToOpenAiResponse`) remain unchanged.
- `fusion.config.json` (MODIFY) — Ensure the top-level `timeoutMs` field is present with the default value `30000`. If the field is already present, verify it and leave the value unchanged. If absent, add `"timeoutMs": 30000` as a sibling to `"providers"`.

## Test Expectations

### Streaming detection

- **Streaming path activated by `stream: true`**: When `POST /v1/chat/completions` receives a body with `stream: true`, the response has `Content-Type: text/event-stream` and the body contains SSE-formatted lines (`data:`, `:`, etc.). The response is not a single JSON object.

- **Non-streaming path preserved**: When the body has no `stream` field, or `stream: false`, the response is `Content-Type: application/json` (or Hono's default JSON content type) and the body is a single `ChatCompletion` JSON object — the same behavior as Task 05.

### Keep-alive comment emission

- **Panel progress emits keep-alive**: When the `FusionService.runFusion()` iterable yields `{ type: 'progress', stage: 'panel', message: 'starting panel run' }`, the SSE stream contains a line matching `: panel` (the exact format is determined by `encodeKeepAlive`). The line appears before any `data:` line carrying `chat.completion.chunk`.

- **Judge progress emits keep-alive**: When the iterable yields `{ type: 'progress', stage: 'judge', message: 'analyzing responses' }`, the SSE stream contains an SSE comment line (matching `: judg`). The line appears after panel keep-alive comments and before any synthesis `content_delta` data event.

- **Multiple progress events produce multiple keep-alive comments**: When the iterable yields three `progress` events (e.g., panel start, panel collecting, judge start), the SSE stream contains three distinct SSE comment lines, each written via `stream.write(encodeKeepAlive(event.stage))`.

### Content delta SSE encoding

- **`content_delta` produces `chat.completion.chunk` SSE event**: When the iterable yields `{ type: 'content_delta', delta: 'Hello' }`, the SSE stream contains a `data:` line whose payload is valid JSON with `"object": "chat.completion.chunk"` and `"choices"[0].delta.content` equal to `"Hello"`. The SSE event is emitted via `stream.writeSSE({ data: <json> })`.

- **Multiple `content_delta` events stream in order**: When the iterable yields `content_delta` with delta `"He"`, then `"llo"`, then `" world"`, the SSE stream contains three `data:` lines in that order, with delta contents `"He"`, `"llo"`, and `" world"` respectively. No events are dropped or reordered.

- **`content_stop` produces no SSE output**: When the iterable yields `{ type: 'content_stop' }`, no `data:` line is emitted for that event. The stream continues to the next event (typically `done`).

### Done event and stream termination

- **`done` event emits `[DONE]` sentinel**: When the iterable yields `{ type: 'done', usage: {...}, failedModels: [...] }`, the SSE stream contains a line `data: [DONE]`. This is the final `data:` line before the stream closes. The `[DONE]` sentinel is emitted via `stream.writeSSE({ data: '[DONE]' })`.

- **Stream closes after `done`**: After the `done` event is processed and `[DONE]` is emitted, the `for await` loop exits normally (the iterable is exhausted), the `streamSSE` callback resolves, and Hono closes the SSE stream cleanly. No additional events are written after `[DONE]`.

- **No `[DONE]` after error**: When the iterable yields an `error` event followed by no `done` event, the stream closes without emitting `data: [DONE]`. Any events preceding the error (e.g., `content_delta`, keep-alive comments) remain visible to the client, but the error event itself produces no SSE output (the sse-encoder returns `null` for errors per Task 11).

### Error handling in streaming mode

- **`error` event produces no SSE output and the stream closes**: When the iterable yields `{ type: 'error', code: 'SYNTHESIS_FAILED', message: 'upstream connection lost' }`, the route handler calls `fusionStreamToOpenAiSSE(event)`, which returns `null` (the sse-encoder returns `null` for errors per Task 11). No `data:` line is written for the error event. The callback then `return`s, terminating the stream without a `[DONE]` sentinel. The client observes a clean stream closure after the last successfully emitted event.

- **Iterable exception caught**: When `fusionService.runFusion()` returns an iterable but iteration throws mid-stream (e.g., `for await` throws `new Error('broken pipe')`), the `catch` block in the `streamSSE` callback emits `data: {"error":{"message":"broken pipe"}}` and the stream closes. The client does not hang on an unterminated stream.

- **JSON parse errors still return 400**: When the request body is not valid JSON (e.g., raw text `not json`), the handler returns `c.json({ error: { message: 'Invalid JSON body' } }, 400)` before the streaming/non-streaming branch. This behavior is unchanged from Task 05.

### Translator delegation

- **`fusionStreamToOpenAiSSE` delegates to encoder**: Calling `fusionStreamToOpenAiSSE({ type: 'content_delta', delta: 'Hi' })` returns the same value as calling `encodeOpenAiSSE({ type: 'content_delta', delta: 'Hi' })` from the sse-encoder module. The function is a direct delegation wrapper.

- **`fusionStreamToOpenAiSSE` returns `null` for progress**: Calling `fusionStreamToOpenAiSSE({ type: 'progress', stage: 'panel', message: '...' })` returns `null`. The route skips `writeSSE` when the return value is `null`.

- **`fusionStreamToOpenAiSSE` is synchronous**: The function does not return a Promise and requires no `await`. It is a pure mapping from `FusionStreamEvent` to `string | null`.

### Config timeout field

- **`timeoutMs` present with value `30000`**: After the task is complete, reading `fusion.config.json` and parsing its JSON yields a top-level `timeoutMs` field with a numeric value. If the file had no such field before the task, the value is `30000`. If it already had a value (e.g., `60000`), that value is preserved unchanged.

- **`ConfigPort.getTimeoutMs()` returns the configured value**: The existing `JsonFileConfigAdapter.getTimeoutMs()` returns the value of `timeoutMs` from `fusion.config.json`. This should already work — the task only ensures the config file carries the field.

### End-to-end streaming (Phase 3 Gate 1)

- **Full streaming cycle**: When `curl -N -X POST http://localhost:3000/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}],"stream":true}'` is issued, the response is an SSE stream where:
  1. The response starts with `Content-Type: text/event-stream`.
  2. SSE comment lines (`:` prefix) appear first, corresponding to panel and judge progress phases.
  3. SSE `data:` lines appear carrying JSON with `"object":"chat.completion.chunk"` and `"choices"[0].delta.content` containing synthesis tokens.
  4. The final `data:` line is `data: [DONE]`.
  5. The connection closes cleanly after `[DONE]`.

### Import restriction (NFR-1, NFR-2, NFR-4)

- **Hono confined to infrastructure**: `streamSSE` is imported from `'hono/streaming'` in `src/infrastructure/inbound/http/openai/route.ts`. No Hono imports exist in `src/domain/` or `src/application/`. Running `grep -r "from 'hono" src/domain/ src/application/` returns no matches.

- **Domain and application layer remain SDK-free**: Running `grep -r "from 'openai'" src/domain/ src/application/` and `grep -r "from.*infrastructure" src/domain/ src/application/` returns no matches.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
