# Task 14: Anthropic inbound adapter

## Metadata
- **Task:** 14
- **Phase:** 4
- **Route:** full
- **Slice:** Anthropic API Support

## Dependencies
- **Task 13** provides the `AnthropicChatAdapter` (implementing `ChatModelPort` via `@anthropic-ai/sdk`) registered in `ChatAdapterFactory` for `provider.type === 'anthropic'`. The `ChatAdapterFactory` now returns an `AnthropicChatAdapter` for Anthropic providers, meaning the DI container can wire Anthropic outbound calls through the same `ChatModelPort` interface. This task adds the inbound side — the `/v1/messages` route that accepts Anthropic-format requests and translates them to canonical `FusionRequest` before calling `FusionService.runFusion()`. The `FusionService` interface is unchanged; the `RunFusionUseCase` orchestrates panel → judge → synthesis using whichever outbound adapters the config specifies. The `FusionStreamEvent` discriminated union (defined in Task 01, extended in Tasks 06/09) is stable, with five variants (`progress`, `content_delta`, `content_stop`, `done`, `error`) that this task's SSE encoder must map to the 6-event Anthropic SSE sequence.

## Traceability
- **Acceptance Criteria:** AC-11 (partial — inbound `/v1/messages` route and SSE encoder)
- **NFRs:** NFR-1, NFR-2
- **Replan Gate Criteria:** Phase 4 Gate 1 (6-event SSE sequence verified), Phase 4 Gate 2 (no Anthropic types leak to domain/app)

## Source Traceability
- **Goals:** AC-11 — The inbound `/v1/messages` route translates Anthropic-format requests to canonical, calls `FusionService`, and maps stream events to `message_start`/`content_block_delta`/`message_stop` SSE events
- **Plan:** Task 14, Phase 4 — Anthropic API Compatibility
- **Design:** Slice 5: Anthropic API Support
- **Structure:** Slice 5: Anthropic API Support — `src/infrastructure/inbound/http/anthropic/route.ts` (CREATE), `src/infrastructure/inbound/http/anthropic/translator.ts` (CREATE), `src/infrastructure/inbound/http/anthropic/sse-encoder.ts` (CREATE), `src/infrastructure/inbound/http/server.ts` (MODIFY)

## Description

Create the Anthropic inbound HTTP adapter: a new `POST /v1/messages` route that accepts Anthropic-format request bodies, translates them to the canonical `FusionRequest`, calls the same `FusionService.runFusion()` used by the OpenAI route, and encodes the response as Anthropic-compatible SSE events (streaming) or a single Anthropic `Message` JSON response (non-streaming). The existing `server.ts` must be modified to mount the new route alongside the existing OpenAI routes.

No application or domain code is modified. The Anthropic-specific types and SSE event names (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`) exist only in the three new files under `src/infrastructure/inbound/http/anthropic/`.

---

### 1. Anthropic request translator (`src/infrastructure/inbound/http/anthropic/translator.ts`)

Two pure functions that convert between Anthropic API shapes and the canonical domain types.

**Exact signatures:**

```typescript
import type { FusionRequest } from '../../../../domain/model/fusion-types.js';
import type { Message } from '../../../../domain/model/message.js';

export function anthropicRequestToFusion(body: Record<string, unknown>): FusionRequest;
export function anthropicContentToText(content: unknown): string;
```

#### `anthropicContentToText(content: unknown): string`

A helper function that flattens Anthropic's `content` field (which may be a plain string or an array of `ContentBlock` objects) to a canonical plain string. This is used both by `anthropicRequestToFusion` for individual message content and for the top-level `system` parameter when it appears as a content-block array.

1. **String input:** If `content` is a `string`, return it directly.
2. **Array input:** If `content` is an array, filter for elements whose `type` property equals `'text'`, extract their `text` property as a string (defaulting to `''` if missing), and join all text values with no separator (concatenation). This handles the common Anthropic content-block format `[{ type: 'text', text: '...' }, { type: 'text', text: ' ...' }]`.
3. **Other input (null, undefined, number, object without array shape):** Return `''` (empty string). The function must not throw — it must always return a string.

#### `anthropicRequestToFusion(body: Record<string, unknown>): FusionRequest`

Maps an Anthropic `/v1/messages` request body to the canonical `FusionRequest`.

1. **`messages`:** Extract `body.messages` (default to `[]` if absent or not an array). Map each element to a canonical `Message`:
   - `role`: `String(m.role ?? 'user')` cast to `'system' | 'user' | 'assistant'`.
   - `content`: If `typeof m.content === 'string'`, use that string. Otherwise pass `m.content` through `anthropicContentToText()`.
   This mapping handles Anthropic's multi-modal content-block arrays (text blocks, tool results, images) by extracting text via the helper. Non-text content blocks (tool_use, images, thinking) are silently lost — the canonical `Message.content` is always a plain string.

2. **`system` (top-level system prompt):** Anthropic accepts `system` as a string or an array of text content blocks at the top level of the request body (not inside messages).
   - If `typeof body.system === 'string'`, set `systemPrompt = body.system`.
   - If `Array.isArray(body.system)`, flatten via `systemPrompt = anthropicContentToText(body.system)`. If the resulting string is empty, treat it as absent.
   - If `body.system` is any other type or absent, omit `systemPrompt` from the `FusionRequest`.

3. **`stream`:** If `typeof body.stream === 'boolean'`, set `stream = body.stream`. Otherwise leave `undefined`.

4. **`max_tokens`:** If `typeof body.max_tokens === 'number'`, set `maxTokens = body.max_tokens`. Note: `FusionRequest` uses camelCase `maxTokens`.

5. **`temperature`:** If `typeof body.temperature === 'number'`, set `temperature = body.temperature`.

6. **Return:** A `FusionRequest` object with only the fields that have values. Use spread with conditional properties (e.g., `...(systemPrompt !== undefined && { systemPrompt })`) rather than setting `undefined` explicitly. The `model` field from the Anthropic body is NOT mapped to `FusionRequest` — the application layer resolves the model via `ConfigPort`, not from the client request. The route captures the client-provided model name separately for use in the response.

---

### 2. Anthropic SSE encoder (`src/infrastructure/inbound/http/anthropic/sse-encoder.ts`)

A state machine that maps the canonical `FusionStreamEvent` discriminated union to the 6-event Anthropic SSE sequence. The encoder mutates a state object on each call and returns an array of fully-formed SSE frames (strings).

**Exact signatures:**

```typescript
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import type { TokenUsage } from '../../../../domain/model/chat-types.js';

export interface AnthropicStreamState {
  messageId: string;
  model: string;
  contentBlockIndex: number;
  phase: 'init' | 'content' | 'finishing';
}

export function createInitialAnthropicStreamState(messageId: string, model: string): AnthropicStreamState;
export function encodeAnthropicSSE(event: FusionStreamEvent, state: AnthropicStreamState): string[];
export function formatSSEFrame(event: string, data: string): string;
```

#### `AnthropicStreamState`

Tracks the progress of the SSE stream:

- `messageId` (`string`): A unique identifier for the message (UUID v4, set once at creation).
- `model` (`string`): The model name reported to the client in `message_start` and `message_delta`.
- `contentBlockIndex` (`number`): The index of the current content block. Always `0` for this implementation — the proxy always emits a single text content block.
- `phase` (`'init' | 'content' | 'finishing'`): The current phase of the state machine:
  - `'init'`: No `message_start` has been emitted yet. The stream has just started or only `progress` events have been received.
  - `'content'`: A `content_block_start` has been emitted and content deltas are in flight.
  - `'finishing'`: Content delivery has ended (`content_block_stop` emitted) or was skipped; the terminating events (`message_delta`, `message_stop`) are being or have been emitted.

#### `createInitialAnthropicStreamState(messageId, model)`

Returns a fresh `AnthropicStreamState` with `phase: 'init'` and `contentBlockIndex: 0`. The `messageId` and `model` are provided by the route.

#### `encodeAnthropicSSE(event, state): string[]`

Accepts a `FusionStreamEvent` and the mutable `AnthropicStreamState`. Returns an array of strings, where each string is a complete SSE frame in the Anthropic wire format:

```
event: <event_name>
data: <json_payload>

```

Each frame is a single string containing both lines plus a trailing blank line (the SSE message delimiter). The route writes each string directly to the response stream using Hono's `StreamingApi.write()` method (raw output, no further framing applied).

The state object is mutated in place to track phase transitions. The function never throws.

##### State machine rules

**`progress` event (any phase):**
- Returns `[]` (empty array). Progress events are informational and do not map to any Anthropic SSE event. The route is responsible for emitting SSE comments (`: <message>\n\n`) for keep-alive independently of this encoder.

**`content_delta` event, phase `'init'`:**
- Transition: `state.phase` → `'content'`.
- Returns three SSE frames:
  1. `message_start` — payload: `{ type: 'message_start', message: { id: state.messageId, type: 'message', role: 'assistant', model: state.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }`
  2. `content_block_start` — payload: `{ type: 'content_block_start', index: state.contentBlockIndex, content_block: { type: 'text', text: '' } }`
  3. `content_block_delta` — payload: `{ type: 'content_block_delta', index: state.contentBlockIndex, delta: { type: 'text_delta', text: event.delta } }`

**`content_delta` event, phase `'content'`:**
- No phase transition.
- Returns one SSE frame:
  1. `content_block_delta` — payload: `{ type: 'content_block_delta', index: state.contentBlockIndex, delta: { type: 'text_delta', text: event.delta } }`

**`content_delta` event, phase `'finishing'`:**
- Returns `[]`. Content deltas after the content block has been stopped are ignored.

**`content_stop` event, phase `'content'`:**
- Transition: `state.phase` → `'finishing'`.
- Returns one SSE frame:
  1. `content_block_stop` — payload: `{ type: 'content_block_stop', index: state.contentBlockIndex }`

**`content_stop` event, phase `'init'` or `'finishing'`:**
- Returns `[]`. No-op.

**`done` event, phase `'init'` (no content was generated):**
- Transition: `state.phase` → `'finishing'`.
- Returns three SSE frames:
  1. `message_start` — same payload as described above.
  2. `message_delta` — payload: `{ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: event.usage?.completionTokens ?? 0 } }`
  3. `message_stop` — payload: `{ type: 'message_stop' }`

**`done` event, phase `'content'`:**
- Transition: `state.phase` → `'finishing'`.
- Returns three SSE frames:
  1. `content_block_stop` — payload: `{ type: 'content_block_stop', index: state.contentBlockIndex }`
  2. `message_delta` — same payload as above (using `event.usage`).
  3. `message_stop` — payload: `{ type: 'message_stop' }`

**`done` event, phase `'finishing'`:**
- Returns two SSE frames:
  1. `message_delta` — same payload as above.
  2. `message_stop` — payload: `{ type: 'message_stop' }`

**`error` event, any phase:**
- Transition: `state.phase` → `'finishing'`.
- Returns the set of frames needed to close the stream from the current phase:
  - Phase `'init'`: `[message_start_frame, message_stop_frame]` — the client needs at least a message ID.
  - Phase `'content'`: `[content_block_stop_frame, message_stop_frame]`.
  - Phase `'finishing'`: `[message_stop_frame]`.
- The `message_stop` payload for error termination includes the error information: `{ type: 'message_stop', error: { type: 'api_error', message: event.message } }`. The `message_start` and `content_block_stop` payloads use the same shapes as the normal path.

##### SSE frame formatting

Each returned string is a complete SSE message with `event:` and `data:` lines followed by a blank line:

```
event: <type>
data: <JSON>

```

Where:
- `<type>` is the Anthropic event name (e.g., `message_start`, `content_block_delta`).
- `<JSON>` is the stringified JSON payload (single line, no extra newlines inside the JSON).
- The trailing blank line (`\n` after `data:` + another `\n`) terminates the SSE message.

Keep-alive comments are NOT produced by the encoder. The route emits SSE comments (lines starting with `:`) using the Hono `StreamingApi.write(': <message>\n\n')` method directly.

#### `formatSSEFrame(event: string, data: string): string`

A stateless utility that formats a single SSE frame string from an event type name and a JSON-stringified payload. Returns a string in the form:

```
event: <event>
data: <data>

```

Where `<event>` is the event-type string (e.g., `'message_start'`, `'message_stop'`) and `<data>` is a pre-stringified JSON payload. The trailing blank line terminates the SSE message. Used by the route's catch block to manually emit frames when `runFusion()` throws (outside the normal `encodeAnthropicSSE` event loop), ensuring the client receives properly formatted close events even on unexpected failures.

---

### 3. Anthropic route (`src/infrastructure/inbound/http/anthropic/route.ts`)

The `POST /v1/messages` route handler. Parses the Anthropic-format JSON request body, translates it to a `FusionRequest`, calls `FusionService.runFusion()`, and encodes the response.

**Exact signature:**

```typescript
import type { Context } from 'hono';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import { anthropicRequestToFusion } from './translator.js';
import { createInitialAnthropicStreamState, encodeAnthropicSSE, formatSSEFrame } from './sse-encoder.js';
import { streamSSE } from 'hono/streaming';

export function createAnthropicRoute(fusionService: FusionService): (c: Context) => Promise<Response>;
```

**Implementation:**

The `createAnthropicRoute` function returns an async Hono context handler `(c: Context) => Promise<Response>`:

1. **Parse the request body:**
   - Call `const body = await c.req.json<Record<string, unknown>>()` inside a try/catch.
   - If JSON parsing fails (malformed body), return `c.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400)`.

2. **Extract model from the request body before translation:**
   - `const model = typeof body.model === 'string' ? body.model : '';`
   - The model name is not mapped into `FusionRequest` (the application layer resolves models from `ConfigPort`), but it must be captured for use in the response (Anthropic clients expect the model name in `message_start` and the non-streaming response).

3. **Translate to canonical:**
   - `const fusionRequest = anthropicRequestToFusion(body);`
   - Determine streaming mode: `const stream = fusionRequest.stream === true;`

4. **Streaming path (`stream === true`):**
   - Generate a message ID: `const messageId = 'msg_' + crypto.randomUUID();`
   - Use Hono's `streamSSE()` helper:
     ```typescript
     return streamSSE(c, async (stream) => {
       const state = createInitialAnthropicStreamState(messageId, model);
       try {
         const events = fusionService.runFusion(fusionRequest);
         for await (const event of events) {
           // Emit keep-alive comments for progress events
           if (event.type === 'progress') {
             await stream.write(`: ${event.message}\n\n`);
             continue;
           }
           // Encode Anthropic SSE frames
           const frames = encodeAnthropicSSE(event, state);
           for (const frame of frames) {
             await stream.write(frame);
           }
           // Stop iterating after a terminal event
           if (event.type === 'error' || event.type === 'done') {
             break;
           }
         }
       } catch (err) {
         // If runFusion() throws (e.g., upstream failure during non-streamed phases),
         // emit minimal close events
         if (state.phase === 'init') {
           await stream.write(formatSSEFrame('message_start', JSON.stringify({
             type: 'message_start',
             message: { id: messageId, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
           })));
         }
         const errMsg = err instanceof Error ? err.message : String(err);
         await stream.write(formatSSEFrame('message_stop', JSON.stringify({
           type: 'message_stop',
           error: { type: 'api_error', message: errMsg },
         })));
       }
     });
     ```
   - The `stream.write()` calls write raw bytes. Hono's `streamSSE` manages the SSE `Content-Type` header and connection lifecycle.
   - Progress events (`type: 'progress'`) are emitted as SSE comments (`: <message>\n\n`) so the client connection stays alive during panel and judge phases without confusing an Anthropic client with unrecognised event types.
   - After a `done` or `error` event, the loop breaks — no further events are expected.
   - If `runFusion()` itself throws (e.g., an exception during setup rather than yielding an `error` event), the catch block emits a closing `message_stop` with the error details. If the stream was still in `init` phase, it also emits a `message_start` so the client has a message ID.

5. **Non-streaming path (`stream` is not `true`):**
   - Call `fusionService.runFusion(fusionRequest)` to get the async iterable.
   - Iterate all events and accumulate:
     - `content_delta`: Append `event.delta` to a `content` string.
     - `content_stop`: No accumulation.
      - `done`: Capture `event.usage`. Capture `event.failedModels` if present.
     - `progress`: Skip (no-op for non-streaming).
     - `error`: Throw the error to the outer catch block.
   - After iteration, construct the Anthropic `Message` response:
     ```typescript
     const response = {
       id: messageId,
       type: 'message',
       role: 'assistant',
        model: model || '',
       content: [{ type: 'text', text: content }],
       stop_reason: 'end_turn',
       stop_sequence: null,
       usage: {
         input_tokens: usage.promptTokens,
         output_tokens: usage.completionTokens,
       },
     };
     ```
   - Return `c.json(response, 200)`.
   - The `id` is `msg_<uuid>`, matching the Anthropic message ID convention.

6. **Error handling (shared):**
   - Both streaming and non-streaming paths are wrapped in a try/catch for unexpected errors.
   - For non-streaming, if `runFusion()` throws or an `error` event is encountered during iteration, return an Anthropic-format error JSON response:
     ```typescript
     return c.json({
       type: 'error',
       error: {
         type: 'api_error',
         message: err instanceof Error ? err.message : String(err),
       },
     }, 500);
     ```
   - The Anthropic error response shape is `{ type: 'error', error: { type: '...', message: '...' } }`. Use `'invalid_request_error'` for 400-level errors and `'api_error'` for 500-level / upstream errors.

7. **Anthropic-specific headers:**
   - Set `c.header('x-api-key', '...')` only if needed for compatibility. Not required since this is a proxy, not a real Anthropic API. No special Anthropic response headers are required.
   - The `Content-Type` for streaming is set automatically by Hono's `streamSSE` (`text/event-stream`). For non-streaming, `c.json()` sets `application/json`.

---

### 4. Server modification (`src/infrastructure/inbound/http/server.ts`)

Mount the Anthropic route alongside the existing OpenAI routes.

**Current state (before modification):**
```typescript
import { Hono } from 'hono';
import type { FusionService } from '../../../application/ports/fusion-service.js';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import { createOpenAiRoute } from './openai/route.js';
import { createModelsRoute } from './models-route.js';

export function createServer(fusionService: FusionService, configPort: ConfigPort): Hono {
  const app = new Hono();
  app.post('/v1/chat/completions', createOpenAiRoute(fusionService));
  app.get('/v1/models', createModelsRoute(configPort));
  return app;
}
```

**Required changes:**
1. Add the import for the Anthropic route at the top:
   ```typescript
   import { createAnthropicRoute } from './anthropic/route.js';
   ```
2. Mount `POST /v1/messages` in `createServer` before the `return` statement:
   ```typescript
   app.post('/v1/messages', createAnthropicRoute(fusionService));
   ```
3. The existing imports, the `createOpenAiRoute` mount, the `createModelsRoute` mount, and the `return` statement remain unchanged.

The `createServer` function signature does not change. Both the OpenAI and Anthropic routes receive the same `FusionService` instance — neither the server nor the routes need to know which provider will service the request.

---

### Dependency rule enforcement

- `src/infrastructure/inbound/http/anthropic/route.ts` imports from `hono` and `hono/streaming` (for `Context`, `streamSSE`, `StreamingApi`). It imports domain types (`FusionRequest`, `FusionStreamEvent`), application ports (`FusionService`), and sibling modules (`./translator.js`, `./sse-encoder.js`). It must have zero imports from `src/application/usecases/` or from any SDK (`openai`, `@anthropic-ai/sdk`).
- `src/infrastructure/inbound/http/anthropic/translator.ts` imports only from domain model types (`FusionRequest`, `Message`). No Hono, no SDK, no application-layer imports.
- `src/infrastructure/inbound/http/anthropic/sse-encoder.ts` imports only from domain model types (`FusionStreamEvent`, `TokenUsage`). No Hono, no SDK, no application-layer imports.
- `src/infrastructure/inbound/http/server.ts` imports from `hono`, application ports (`FusionService`), domain ports (`ConfigPort`), and the three route modules. No SDK imports.
- No Anthropic SDK types, class names, or event-type strings (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`) appear in any file under `src/domain/` or `src/application/`.

## Files
- `src/infrastructure/inbound/http/anthropic/route.ts` (CREATE) — `createAnthropicRoute(fusionService): (c: Context) => Promise<Response>` — POST /v1/messages handler: parses Anthropic body, translates to `FusionRequest`, captures model name, calls `FusionService.runFusion()`. For streaming: uses Hono `streamSSE()` with the SSE encoder state machine to emit the 6-event Anthropic SSE sequence, emitting keep-alive SSE comments (`: message`) for `progress` events. For non-streaming: iterates events, accumulates content into a single text content block, returns an Anthropic `Message` JSON response with `id`, `type`, `role`, `model`, `content`, `stop_reason`, `stop_sequence`, `usage`. Handles JSON parse errors (400 with Anthropic error shape) and upstream failures (500 with Anthropic error shape).
- `src/infrastructure/inbound/http/anthropic/translator.ts` (CREATE) — `anthropicRequestToFusion(body): FusionRequest` maps Anthropic `MessageCreateParams` to canonical `FusionRequest`: extracts `messages` (flattening content blocks to strings via `anthropicContentToText`), top-level `system` (string or array of text blocks → `systemPrompt`), `stream`, `max_tokens` → `maxTokens`, `temperature`. `anthropicContentToText(content): string` helper flattens Anthropic content (string passthrough, array of text blocks concatenated, other types → `''`).
- `src/infrastructure/inbound/http/anthropic/sse-encoder.ts` (CREATE) — `AnthropicStreamState` interface (`messageId`, `model`, `contentBlockIndex`, `phase: 'init' | 'content' | 'finishing'`), `createInitialAnthropicStreamState()`, `encodeAnthropicSSE(event, state): string[]`, and `formatSSEFrame(event, data): string` — state machine that maps `FusionStreamEvent` variants to the 6-event Anthropic SSE sequence: `message_start` → `content_block_start` → `content_block_delta` (repeating) → `content_block_stop` → `message_delta` → `message_stop`. Returns fully-formatted SSE frames (strings with `event:` and `data:` lines + trailing blank line). Mutates `state` in place. Handles all phase transitions including error termination. `formatSSEFrame` is a stateless utility for constructing individual SSE frames from an event type and JSON payload, used by the route's catch block for error close events.
- `src/infrastructure/inbound/http/server.ts` (MODIFY) — Add `import { createAnthropicRoute } from './anthropic/route.js'` and mount `app.post('/v1/messages', createAnthropicRoute(fusionService))` in `createServer()` alongside the existing `POST /v1/chat/completions` and `GET /v1/models` routes.

## Test Expectations

### Anthropic content-to-text helper

- **String passthrough:** `anthropicContentToText('Hello')` returns `'Hello'`.
- **Array of text blocks:** `anthropicContentToText([{ type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }])` returns `'Hello world'`.
- **Array with mixed block types:** `anthropicContentToText([{ type: 'tool_use', id: '1', name: 'search', input: {} }, { type: 'text', text: 'Result' }])` returns `'Result'` (only text blocks are extracted; non-text blocks are skipped).
- **Array with no text blocks:** `anthropicContentToText([{ type: 'image', source: {} }])` returns `''`.
- **Non-string, non-array input:** `anthropicContentToText(null)` returns `''`. `anthropicContentToText(42)` returns `''`. `anthropicContentToText(undefined)` returns `''`. The function never throws.

### Anthropic request translator

- **Basic message mapping:** Given `body = { model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages: [{ role: 'user', content: 'Hello' }] }`, the returned `FusionRequest` has `messages: [{ role: 'user', content: 'Hello' }]` and `maxTokens: 1024`. The `model` field from the request is NOT present in the `FusionRequest`.
- **Flattened content blocks:** Given `body.messages = [{ role: 'user', content: [{ type: 'text', text: 'Hi' }, { type: 'text', text: ' there' }] }]`, the `FusionRequest.messages[0].content` is `'Hi there'`.
- **Top-level system as string:** Given `body = { ..., system: 'You are helpful.', messages: [{ role: 'user', content: 'Hi' }] }`, the `FusionRequest.systemPrompt` is `'You are helpful.'`. The `system` field is NOT appended to the `messages` array — it uses the dedicated `systemPrompt` field.
- **Top-level system as array:** Given `body.system = [{ type: 'text', text: 'Be concise.' }, { type: 'text', text: ' Use bullets.' }]`, the `FusionRequest.systemPrompt` is `'Be concise. Use bullets.'`.
- **Top-level system absent:** When `body` has no `system` field, or `body.system` is an empty array, or `body.system` is a non-string/non-array value, the `FusionRequest.systemPrompt` is `undefined` (not present in the returned object).
- **Stream flag:** Given `body.stream = true`, `FusionRequest.stream` is `true`. Given `body.stream = false` or absent, `stream` is `undefined`.
- **Temperature:** Given `body.temperature = 0.7`, `FusionRequest.temperature` is `0.7`.
- **Missing messages:** Given `body = { model: 'claude', max_tokens: 100 }` (no `messages` field), `FusionRequest.messages` is an empty array `[]`.

### SSE encoder

- **Progress events are no-ops:** Calling `encodeAnthropicSSE({ type: 'progress', stage: 'panel', message: 'running' }, state)` returns `[]` and does not mutate `state.phase`.
- **First content_delta emits three frames:** With a state in `'init'` phase, calling `encodeAnthropicSSE({ type: 'content_delta', delta: 'Hello' }, state)` returns an array of 3 strings. The first contains `event: message_start\n`, the second contains `event: content_block_start\n`, the third contains `event: content_block_delta\n` and `"text":"Hello"` in the JSON payload. After the call, `state.phase` is `'content'`.
- **Subsequent content_delta emits one frame:** With a state in `'content'` phase, calling `encodeAnthropicSSE({ type: 'content_delta', delta: ' world' }, state)` returns an array of 1 string containing `event: content_block_delta\n` with `"text":" world"`.
- **content_stop transitions to finishing:** With state in `'content'` phase, calling `encodeAnthropicSSE({ type: 'content_stop' }, state)` returns an array of 1 string containing `event: content_block_stop\n`. After the call, `state.phase` is `'finishing'`.
- **done in init phase emits three frames:** With state in `'init'` (no content deltas received), calling `encodeAnthropicSSE({ type: 'done', usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 } }, state)` returns 3 strings: `message_start`, `message_delta` (with `usage.output_tokens: 0`), and `message_stop`. After the call, `state.phase` is `'finishing'`.
- **done in content phase emits three frames:** With state in `'content'` phase, calling `encodeAnthropicSSE({ type: 'done', usage: { promptTokens: 10, completionTokens: 50, totalTokens: 60 } }, state)` returns 3 strings: `content_block_stop`, `message_delta` (with `usage.output_tokens: 50`), and `message_stop`.
- **done in finishing phase emits two frames:** With state already in `'finishing'`, calling `encodeAnthropicSSE({ type: 'done' }, state)` returns 2 strings: `message_delta` and `message_stop`.
- **done without usage:** When the `done` event has no `usage` field, the `message_delta` payload has `usage: { output_tokens: 0 }`.
- **error in init phase emits two frames:** With state in `'init'`, calling `encodeAnthropicSSE({ type: 'error', code: 'TEST', message: 'fail' }, state)` returns strings for `message_start` and `message_stop` (with error info in the `message_stop` payload). After the call, `state.phase` is `'finishing'`.
- **error in content phase emits two frames:** With state in `'content'`, calling the error event returns strings for `content_block_stop` and `message_stop`.
- **error in finishing phase emits one frame:** With state in `'finishing'`, calling the error event returns a string for `message_stop` only.
- **All frames use both event: and data: lines:** Every returned string contains `event: <type>\n` and `data: <json>\n\n`. No frame omits the `event:` field.
- **Frame format is valid SSE:** Feed the concatenated output of all frames for a complete sequence to an SSE parser — it correctly extracts `event` and `data` for each of the 6 event types in the order: `message_start`, `content_block_start`, `content_block_delta` (any number), `content_block_stop`, `message_delta`, `message_stop`.

### Route — streaming

- **POST /v1/messages returns text/event-stream:** When `body.stream` is `true`, the response `Content-Type` is `text/event-stream` (set by Hono's `streamSSE`).
- **Streaming response contains all 6 event types in sequence:** When `runFusion()` yields a normal sequence (`progress` → `content_delta` `'Hello'` → `content_delta` `' world'` → `content_stop` → `done` with usage), the SSE output contains these event types in order: `: panel running` (SSE comment for progress), `message_start`, `content_block_start`, `content_block_delta` (text `'Hello'`), `content_block_delta` (text `' world'`), `content_block_stop`, `message_delta`, `message_stop`. Every Anthropic event has both `event:` and `data:` SSE fields.
- **Streaming with no content (done in init):** When `runFusion()` yields only `[{ type: 'progress', stage: 'panel', message: 'starting' }, { type: 'done', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }]`, the SSE output contains an SSE comment `: starting`, then `message_start`, `message_delta`, `message_stop`. No `content_block_start`, `content_block_delta`, or `content_block_stop` events appear.
- **Streaming error from runFusion throw:** When `runFusion()` throws an `Error('Upstream failure')`, the response contains `message_start` followed by `message_stop` with error info in the data payload. The HTTP status is 200 (can't change after stream starts).
- **Streaming error from async iterable error event:** When `runFusion()` yields `[{ type: 'content_delta', delta: 'partial' }, { type: 'error', code: 'MODEL_DOWN', message: 'Model unavailable' }]`, the SSE stream contains `message_start`, `content_block_start`, `content_block_delta` for `'partial'`, `content_block_stop`, and `message_stop` with error info. The loop stops after the error event — no `done` or `message_delta` follows.
- **Keep-alive comments for progress events:** When `runFusion()` yields `[{ type: 'progress', stage: 'panel', message: 'panel active' }, { type: 'progress', stage: 'judge', message: 'judging' }, { type: 'content_delta', delta: 'Hi' }, ...]`, the SSE output contains SSE comment lines `: panel active` and `: judging` before the first `message_start`. Progress comments use the `: <message>` SSE comment format, not `event:`/`data:` pairs.

### Route — non-streaming

- **POST /v1/messages returns valid Message JSON:** When `body.stream` is `false` or absent, and `runFusion()` yields `[{ type: 'content_delta', delta: 'Hello' }, { type: 'content_delta', delta: ' world' }, { type: 'done', usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 } }]`, the response status is 200, `Content-Type` is `application/json`, and the body is: `{ id: 'msg_<uuid>', type: 'message', role: 'assistant', model: '<model from request>', content: [{ type: 'text', text: 'Hello world' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5, output_tokens: 10 } }`. The `input_tokens` maps from `TokenUsage.promptTokens` and `output_tokens` from `TokenUsage.completionTokens`.
- **Non-streaming with no content:** When `runFusion()` yields only `[{ type: 'done', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }]`, the response has `content: [{ type: 'text', text: '' }]` with an empty text string.
- **Non-streaming error from runFusion throw:** When `runFusion()` throws, the response status is 500 and the body matches the Anthropic error shape: `{ type: 'error', error: { type: 'api_error', message: '<error message>' } }`.
- **Non-streaming error from async iterable error event:** When `runFusion()` yields `[{ type: 'error', code: 'MODEL_DOWN', message: 'Unavailable' }]`, the response status is 500 and the body is `{ type: 'error', error: { type: 'api_error', message: 'Unavailable' } }`.

### Route — general

- **POST /v1/messages returns 400 on invalid JSON:** Sending a request with a body that is not valid JSON returns HTTP 400 with `{ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }`.
- **POST /v1/messages sets model in message_start:** The model name in the `message_start` SSE event and the non-streaming response matches the `model` field from the request body (not the synthesizer model from config).

### Server mounting

- **POST /v1/messages is mounted:** After the server modification, `POST /v1/messages` is routed to the Anthropic route handler. Sending a valid Anthropic-format request body to this endpoint reaches the `createAnthropicRoute` handler (not a 404).
- **Existing routes are preserved:** `POST /v1/chat/completions` and `GET /v1/models` continue to work as before — their behaviour is unchanged.

### Dependency rule

- **No Anthropic types leak to domain or application:** Running `grep -r "message_start\|content_block_start\|content_block_delta\|content_block_stop\|message_delta\|message_stop" src/domain/ src/application/` returns no matches.
- **Hono confined to infrastructure:** `grep -r "from 'hono'" src/domain/ src/application/` returns no matches. The `hono` import string appears only in `src/infrastructure/inbound/http/` files and `src/main.ts`.
- **No Anthropic SDK in domain or application:** `grep -r "from '@anthropic-ai" src/domain/ src/application/` returns no matches.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
