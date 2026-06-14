# Task 05: Infrastructure inbound HTTP, DI, and bootstrap

## Metadata
- **Task:** 05
- **Phase:** 1
- **Route:** full
- **Slice:** Passthrough Chat Completion (OpenAI)

## Dependencies
- **Task 03** provides the `FusionService` inbound port and `RunFusionUseCase` implementation. The inbound routes defined in this task call `FusionService.runFusion(request): AsyncIterable<FusionStreamEvent>`. The `RunFusionUseCase` expects to receive a synthesizer model from `ConfigPort.getSynthesizerModel()`, so the composition root in `container.ts` must ensure the config provides one. The use case yields two `FusionStreamEvent` variants (`content_delta` and `done` with `usage`), which the `fusionStreamToOpenAiResponse` translator must collect into an OpenAI-compatible `ChatCompletion` JSON response.
- **Task 04** provides the concrete outbound adapter implementations: `JsonFileConfigAdapter` (implementing `ConfigPort` — must enforce that `getSynthesizerModel()` returns `ModelRef`, not `ModelRef | null`, throwing at construction time if no synthesizer is configured), `ChatAdapterFactory` (returning an `OpenAiChatAdapter` for `provider.type === 'openai'`), and `ConsoleLoggerAdapter` (implementing `LoggerPort`). The DI container in this task instantiates and wires these adapters.

## Traceability
- **Acceptance Criteria:** AC-2 (dependency rule verified), AC-5 (partial — endpoint working), AC-6 (partial — `/v1/models` stub)
- **NFRs:** NFR-1 (dependency rule: domain and application zero SDK imports), NFR-2 (Hono confined to `src/infrastructure/inbound/http/`)
- **Replan Gate Criteria:** Phase 1 Gate 1 (valid `ChatCompletion` JSON response), Phase 1 Gate 2 (dependency rule verification completed)

## Source Traceability
- **Goals:** AC-2 (dependency rule established), AC-5 (real client receives valid ChatCompletion response through `/v1/chat/completions`), AC-6 (`/v1/models` returns JSON array with at least one model entry)
- **Plan:** Task 05, Phase 1 — Core Passthrough
- **Design:** Slice 1 — Passthrough Chat Completion (OpenAI)
- **Structure:** Slice 1 — Passthrough Chat Completion (OpenAI); files `src/infrastructure/inbound/http/server.ts`, `src/infrastructure/inbound/http/openai/route.ts`, `src/infrastructure/inbound/http/openai/translator.ts`, `src/infrastructure/inbound/http/models-route.ts`, `src/infrastructure/di/container.ts`, `src/main.ts`, `fusion.config.json`

## Description

Wire the entire hexagonal skeleton together so the system is runnable end-to-end. Create the Hono HTTP server with two inbound routes, the OpenAI request/response translator, the manual DI composition root, the bootstrap entry point, and the `fusion.config.json` configuration file. This task delivers the first working endpoint: `POST /v1/chat/completions` returns a valid OpenAI `ChatCompletion` JSON response by passing through a single configured model, and `GET /v1/models` returns a JSON array listing available models.

### Architecture overview

The request flow: HTTP client → `server.ts` (Hono app) → `openai/route.ts` → `openai/translator.ts` (OpenAI body → `FusionRequest`) → `FusionService.runFusion()` → `RunFusionUseCase` → `ChatModelPort.complete()` → `OpenAiChatAdapter` → upstream LLM → response flows back through the same chain in reverse. The `/v1/models` route reads `ConfigPort` directly with no fusion pipeline involvement.

### 1. `fusion.config.json` (project root)

A JSON file defining the provider configuration for passthrough mode. Schema:

```json
{
  "providers": [
    {
      "type": "openai",
      "role": "synthesizer",
      "model": "gpt-4o",
      "baseURL": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  ],
  "timeoutMs": 30000
}
```

- `providers` (required, non-empty array): each entry has `type` (`"openai"` in Phase 1), `role` (`"synthesizer"` for the single passthrough model — the `RunFusionUseCase` calls `ConfigPort.getSynthesizerModel()` so at least one synthesizer must exist), `model` (non-empty string), `baseURL` (non-empty string, the API base URL), `apiKeyEnv` (non-empty string, name of an environment variable holding the API key).
- `timeoutMs` (optional, positive integer, default `30000`).

For passthrough mode, a single provider with `role: "synthesizer"` is sufficient. The `JsonFileConfigAdapter` must enforce at construction time that at least one synthesizer is configured, per the `ConfigPort` contract that `getSynthesizerModel()` returns `ModelRef` (never `null`).

### 2. `server.ts` (`src/infrastructure/inbound/http/server.ts`)

The Hono application factory. Creates a `Hono` instance, mounts the OpenAI route at `POST /v1/chat/completions` and the models route at `GET /v1/models`, and returns the app.

**Exact signature:**

```typescript
import { Hono } from 'hono';
import type { FusionService } from '../../../application/ports/fusion-service.js';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import { createOpenAiRoute } from './openai/route.js';
import { createModelsRoute } from './models-route.js';

export function createServer(fusionService: FusionService, configPort: ConfigPort): Hono;
```

**Implementation:** Inside `createServer`:
1. `const app = new Hono();`
2. Mount the OpenAI route: `app.post('/v1/chat/completions', createOpenAiRoute(fusionService));` (where `createOpenAiRoute` returns a `Hono` instance configured with the POST handler, or directly returns the handler function — either pattern is acceptable as long as `POST /v1/chat/completions` routes to the handler).
3. Mount the models route: `app.get('/v1/models', createModelsRoute(configPort));`
4. `return app;`

The `server.ts` file must import `Hono` from `"hono"`. This is the only file outside `openai/route.ts` and `models-route.ts` that uses Hono, satisfying NFR-2 (Hono confined to `src/infrastructure/inbound/http/`).

### 3. OpenAI route (`src/infrastructure/inbound/http/openai/route.ts`)

The `POST /v1/chat/completions` route handler. Parses the OpenAI-format JSON request body, translates it to a `FusionRequest`, calls `FusionService.runFusion()`, collects stream events into a buffered `ChatCompletion` response (non-streaming only in Phase 1), and returns the result as JSON.

**Exact signature:**

```typescript
import { Hono } from 'hono';
import type { FusionService } from '../../../../application/ports/fusion-service.js';
import { openAiRequestToFusion, fusionStreamToOpenAiResponse } from './translator.js';

export function createOpenAiRoute(fusionService: FusionService): Hono;
```

**Implementation:** Inside `createOpenAiRoute`, create a `Hono` instance and register a `POST` handler that:
1. Parses the request body with `c.req.json<Record<string, unknown>>()`. If JSON parsing fails (malformed body), return `c.json({ error: { message: 'Invalid JSON body' } }, 400)`.
2. Extracts the model from the body before translation: `const model = typeof body.model === 'string' ? body.model : '';`
3. Calls `openAiRequestToFusion(body)` to produce a `FusionRequest`.
4. Calls `fusionService.runFusion(fusionRequest)` to get an `AsyncIterable<FusionStreamEvent>`.
5. Calls `fusionStreamToOpenAiResponse(events, model)` to collect stream events into a fully formed OpenAI `ChatCompletion` response object.
6. Returns `c.json(response)`.
7. If `runFusion()` or `fusionStreamToOpenAiResponse()` throws (e.g., upstream LLM failure via `FusionError`), catches the error and returns `c.json({ error: { message: err instanceof Error ? err.message : String(err) } }, 500)`.

### 4. OpenAI translator (`src/infrastructure/inbound/http/openai/translator.ts`)

Two pure functions that convert between OpenAI API shapes and the canonical domain types.

**Exact signatures:**

```typescript
import type { FusionRequest } from '../../../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import type { TokenUsage } from '../../../../domain/model/chat-types.js';

export function openAiRequestToFusion(body: Record<string, unknown>): FusionRequest;
export function fusionStreamToOpenAiResponse(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): Promise<Record<string, unknown>>;
```

#### `openAiRequestToFusion(body)`

Maps an OpenAI chat completion request body to the canonical `FusionRequest`:

1. **`messages`**: Extract `body.messages` (must be an array; default to `[]` if absent or not an array). Map each element to `{ role: String(m.role ?? 'user') as 'system' | 'user' | 'assistant', content: String(m.content ?? '') }`.
2. **`stream`**: If `body.stream` is a boolean, set `request.stream = body.stream`. Otherwise leave `undefined`.
3. **`systemPrompt`**: If `body.system` is a string (some OpenAI clients send a top-level `system` field), set `request.systemPrompt = body.system`. Otherwise leave `undefined`.
4. **`temperature`**: If `body.temperature` is a number, set `request.temperature = body.temperature`.
5. **`maxTokens`**: If `body.max_tokens` is a number, set `request.maxTokens = body.max_tokens`.

Returns `FusionRequest` with only the fields that have values. The `FusionRequest` interface allows `undefined` for optional fields, so the function can simply assign the extracted values directly.

#### `fusionStreamToOpenAiResponse(events, model)`

Iterates the `AsyncIterable<FusionStreamEvent>` produced by `FusionService.runFusion()`, accumulates content and usage, and returns a fully formed OpenAI `ChatCompletion` response object.

**Iteration logic:**

1. Initialize: `let content = ''; let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };`
2. For each event:
   - `content_delta`: append `event.delta` to `content`.
   - `content_stop`: no accumulation needed (marker event).
   - `done`: capture `event.usage` into `usage` (overwrite, using defaults of `0` for undefined fields: `usage = { promptTokens: event.usage?.promptTokens ?? 0, completionTokens: event.usage?.completionTokens ?? 0, totalTokens: event.usage?.totalTokens ?? 0 }`).
   - `progress`: skip (informational only in later phases; no action needed).
   - `error`: throw a new `FusionError(event.code, event.message, event.details)` to propagate the error to the route handler.
3. After the loop, construct the response:

```typescript
{
  id: `chatcmpl-${crypto.randomUUID()}`,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: model || '',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
  },
}
```

The `model` field in the response comes from the `model` parameter (the original model name from the request body). The `id` is a UUID prefixed with `chatcmpl-` following OpenAI convention. The `created` field is a Unix timestamp in seconds. There is exactly one `choice` with `finish_reason: 'stop'`.

### 5. Models route (`src/infrastructure/inbound/http/models-route.ts`)

The `GET /v1/models` stub returning an OpenAI-compatible model list.

**Exact signature:**

```typescript
import { Hono } from 'hono';
import type { ConfigPort } from '../../../domain/ports/config-port.js';

export function createModelsRoute(configPort: ConfigPort): Hono;
```

**Implementation:** Inside `createModelsRoute`, create a `Hono` instance and register a `GET` handler that:
1. Collects model entries from `ConfigPort`:
   - For each panel model from `configPort.getPanelModels()`: `{ id: panel.model, object: 'model' }`.
   - For the judge model (if `configPort.getJudgeModel()` returns non-null): `{ id: judge.model, object: 'model' }`.
   - For the synthesizer model (always present): `{ id: configPort.getSynthesizerModel().model, object: 'model' }`.
2. Returns `c.json({ object: 'list', data: entries })`.

The response is an OpenAI-compatible model list with `object: 'list'` and a `data` array of `{ id, object }` entries. There must be at least one entry (the synthesizer model is mandatory).

### 6. DI container (`src/infrastructure/di/container.ts`)

The manual composition root. This is the single place in the codebase where concrete adapter instances are created and wired to port interfaces. Every other module receives dependencies via constructor injection.

**Exact signature:**

```typescript
import type { Hono } from 'hono';
import type { ConfigPort } from '../../domain/ports/config-port.js';
import type { FusionService } from '../../application/ports/fusion-service.js';

export function createApp(): { app: Hono; configPort: ConfigPort; fusionService: FusionService };
```

(Or an equivalent signature that returns the fully wired application.)

**Implementation (wiring order):**

1. **Resolve config path**: Read `process.env.FUSION_CONFIG_PATH` with a fallback to `'fusion.config.json'`.
2. **Create ConfigPort**: `const configPort: ConfigPort = new JsonFileConfigAdapter(configPath);` — this reads, validates, and loads the configuration. It will throw if `fusion.config.json` is missing, malformed, or has no synthesizer provider.
3. **Create LoggerPort**: `const loggerPort: LoggerPort = new ConsoleLoggerAdapter();` — produces structured JSON log lines via `console.log`.
4. **Create ClockPort**: `const clockPort: ClockPort = { now: () => Date.now() };` — inline implementation wrapping the system clock.
5. **Resolve synthesizer model**: `const synthesizerModel: ModelRef = configPort.getSynthesizerModel();` — guaranteed to return a valid `ModelRef` (adapter throws at construction if none configured).
6. **Create ChatModelPort via factory**: `const factory = new ChatAdapterFactory();` then `const chatModelPort: ChatModelPort = factory.create(synthesizerModel);` — for `provider.type === 'openai'`, this returns an `OpenAiChatAdapter`.
7. **Create FusionService**: `const fusionService: FusionService = new RunFusionUseCase(chatModelPort, configPort, loggerPort, clockPort);`
8. **Create Hono server**: `const app = createServer(fusionService, configPort);`
9. **Return**: `{ app, configPort, fusionService }`.

The container must import only from `src/application/` and `src/domain/` for type annotations (ports) and from `src/infrastructure/` for concrete adapter construction. It must not import from any SDK except indirectly through the adapters it constructs. The `Hono` type import (for the return type) is acceptable — it is a type-level import from `'hono'`, not a runtime dependency in the domain/application layers.

**Important constraints:**
- The `JsonFileConfigAdapter` constructor must enforce that at least one synthesizer exists (throwing if not), so `configPort.getSynthesizerModel()` always returns `ModelRef` and the container does not need a separate null-check.
- The `ChatAdapterFactory` must throw with a descriptive message if `modelRef.provider` is not `'openai'` (e.g., `'anthropic'` is unsupported until Phase 5).
- The container does not log anything itself — all logging is handled by adapters and the use case through `LoggerPort`.

### 7. Bootstrap (`src/main.ts`)

The entry point. Imports the container, creates the app, and starts the HTTP server.

```typescript
import { serve } from '@hono/node-server';
import { createApp } from './infrastructure/di/container.js';

const port = Number(process.env.PORT) || 3000;

const { app } = createApp();

console.log(JSON.stringify({ event: 'starting', port }));

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server listening on http://localhost:${port}`);
```

- Reads the `PORT` environment variable (defaults to `3000`).
- Calls `createApp()` which instantiates all adapters, wires the use case, and creates the Hono app.
- Logs a structured start event (matching the pattern from `ConsoleLoggerAdapter`).
- Starts the `@hono/node-server` listener with `serve({ fetch: app.fetch, port })`.
- Logs a human-readable "listening" message to stdout.

The `main.ts` file must import `serve` from `@hono/node-server`. This is the only file outside `server.ts` and the route files that imports the server package. The `main.ts` must not import Hono directly — `app.fetch` is the standard interface between Hono and `@hono/node-server`.

### Dependency rule verification (NFR-1, NFR-2, Phase 1 Gate 2)

Before considering this task complete, verify:

1. `src/domain/` contains zero imports from any SDK (`openai`, `@anthropic-ai/sdk`, `hono`, `zod`) — verified by grep.
2. `src/domain/` contains zero imports from `src/application/` or `src/infrastructure/` — verified by grep.
3. `src/application/` contains zero imports from `src/infrastructure/` or any SDK — verified by grep.
4. `hono` and `@hono/node-server` imports exist only in `src/infrastructure/inbound/http/` and `src/main.ts`.
5. `openai` SDK imports exist only in `src/infrastructure/outbound/llm/` files (the adapter and factory). The `openai` import may also appear in test files (`*.test.ts`); these are exempt.

## Files
- `fusion.config.json` (CREATE) — Single-provider config with `type: "openai"`, `role: "synthesizer"`, `model`, `baseURL`, `apiKeyEnv`, and optional `timeoutMs`. The role is `"synthesizer"` for passthrough mode so the `RunFusionUseCase` can resolve it via `ConfigPort.getSynthesizerModel()`.
- `src/infrastructure/inbound/http/server.ts` (CREATE) — Hono app factory: `createServer(fusionService, configPort)` creates a `Hono` instance, mounts `POST /v1/chat/completions` and `GET /v1/models`, returns the app.
- `src/infrastructure/inbound/http/openai/route.ts` (CREATE) — `createOpenAiRoute(fusionService): Hono` — POST handler that parses OpenAI body, translates to `FusionRequest`, calls `runFusion()`, collects events into `ChatCompletion` JSON, returns it. Handles JSON parse errors (400) and upstream failures (500).
- `src/infrastructure/inbound/http/openai/translator.ts` (CREATE) — `openAiRequestToFusion(body): FusionRequest` maps OpenAI request fields to canonical `FusionRequest`. `fusionStreamToOpenAiResponse(events, model): Promise<Record<string, unknown>>` iterates `FusionStreamEvent` async iterable and produces an OpenAI `ChatCompletion` response object with `id`, `object`, `created`, `model`, `choices[].message.content`, and `usage`.
- `src/infrastructure/inbound/http/models-route.ts` (CREATE) — `createModelsRoute(configPort): Hono` — GET handler that returns `{ object: 'list', data: [...] }` with model entries from `ConfigPort` (panel, judge if configured, synthesizer).
- `src/infrastructure/di/container.ts` (CREATE) — Manual composition root: `createApp()` instantiates `JsonFileConfigAdapter` → `LoggerPort` → `ClockPort` → `ChatAdapterFactory` → `ChatModelPort` → `RunFusionUseCase` → `FusionService` → `createServer()`. Returns `{ app, configPort, fusionService }`.
- `src/main.ts` (CREATE) — Bootstrap: reads `PORT` (default `3000`), calls `createApp()`, starts `@hono/node-server` listener with `serve({ fetch: app.fetch, port })`.

## Test Expectations

### End-to-end / gate criteria

- **Phase 1 Gate 1 — valid ChatCompletion JSON response:** When the server is running and a real OpenAI-compatible client (e.g., `curl`) sends `POST /v1/chat/completions` with a valid JSON body containing `messages: [{ role: 'user', content: 'Hello' }]` and `model: 'gpt-4o'`, the response status is `200` and the body is JSON with all of the following fields: `id` (string starting with `chatcmpl-`), `object: 'chat.completion'`, `created` (number), `model` (string matching the request model), `choices` (array with at least one element having `index: 0`, `message.role: 'assistant'`, `message.content` (string), `finish_reason: 'stop'`), `usage` (object with `prompt_tokens`, `completion_tokens`, `total_tokens` as numbers).

- **Phase 1 Gate 2 — dependency rule:** Running the following grep commands from the project root returns zero matches:
  - `grep -r "from 'openai'" src/domain/` (empty)
  - `grep -r "from '@anthropic-ai/sdk'" src/domain/` (empty)
  - `grep -r "from 'hono'" src/domain/` (empty)
  - `grep -r "from 'zod'" src/domain/` (empty)
  - `grep -r "from.*application" src/domain/` (empty)
  - `grep -r "from.*infrastructure" src/domain/` (empty)
  - `grep -r "from 'openai'" src/application/` (empty)
  - `grep -r "from 'hono'" src/application/` (empty)
  - `grep -r "from.*infrastructure" src/application/` (empty)

### Route and translator

- **POST /v1/chat/completions returns 400 on invalid JSON:** Sending a request with a body that is not valid JSON (e.g., raw text `not json`) returns HTTP 400 with `{ error: { message: 'Invalid JSON body' } }`.

- **POST /v1/chat/completions returns 500 on upstream failure:** When the underlying `ChatModelPort.complete()` rejects (e.g., invalid API key, network error, upstream LLM returns 4xx/5xx), the response status is 500 and the body contains `{ error: { message: '<error message>' } }`.

- **openAiRequestToFusion extracts messages correctly:** Given `body = { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o', temperature: 0.5, max_tokens: 100 }`, the returned `FusionRequest` has `messages: [{ role: 'user', content: 'hi' }]`, `temperature: 0.5`, `maxTokens: 100`, and `stream` is `undefined` (not set).

- **openAiRequestToFusion handles missing messages gracefully:** Given `body = { model: 'gpt-4o' }` (no `messages` field), the returned `FusionRequest.messages` is an empty array `[]`.

- **openAiRequestToFusion extracts stream flag:** Given `body = { messages: [...], stream: true }`, the returned `FusionRequest.stream` is `true`. Given `stream: false` or absent, `stream` is `undefined`.

- **openAiRequestToFusion extracts system prompt:** Given `body = { messages: [...], system: 'Be helpful' }`, the returned `FusionRequest.systemPrompt` is `'Be helpful'`.

- **fusionStreamToOpenAiResponse collects content from events:** Given an async iterable yielding `[{ type: 'content_delta', delta: 'Hello' }, { type: 'content_delta', delta: ' world' }, { type: 'done', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } }]` and `model = 'gpt-4o'`, the returned Promise resolves to an object where `choices[0].message.content` equals `'Hello world'`, `usage.prompt_tokens` equals `1`, `usage.completion_tokens` equals `2`, `usage.total_tokens` equals `3`, and `model` equals `'gpt-4o'`.

- **fusionStreamToOpenAiResponse propagates error events:** Given an async iterable yielding `[{ type: 'error', code: 'UPSTREAM_FAILURE', message: 'Connection refused', details: {} }]`, the returned Promise rejects with a `FusionError` whose `code` is `'UPSTREAM_FAILURE'` and `message` is `'Connection refused'`.

- **fusionStreamToOpenAiResponse skips progress and content_stop events:** Given an async iterable yielding `[{ type: 'progress', stage: 'synthesis', message: 'starting' }, { type: 'content_delta', delta: 'Hi' }, { type: 'content_stop' }, { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }]`, the function completes successfully and does not throw on the `progress` or `content_stop` events. The final content is `'Hi'`.

- **fusionStreamToOpenAiResponse defaults usage to zero:** Given an async iterable yielding `[{ type: 'content_delta', delta: 'x' }, { type: 'done' }]` (done has no `usage` field), the returned response has `usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }`.

### Server and models route

- **GET /v1/models returns model list:** When `configPort.getSynthesizerModel()` returns `{ model: 'gpt-4o', ... }` and `configPort.getPanelModels()` returns `[]`, the response is JSON with `object: 'list'` and `data` array containing at least `[{ id: 'gpt-4o', object: 'model' }]`.

- **GET /v1/models includes panel and judge when configured:** When `ConfigPort` reports one panel model (`'llama3'`), one judge model (`'claude'`), and one synthesizer (`'gpt-4o'`), the `data` array contains three entries: `{ id: 'llama3', object: 'model' }`, `{ id: 'claude', object: 'model' }`, `{ id: 'gpt-4o', object: 'model' }`. Order within the array is not specified.

### DI container

- **createApp returns a Hono app:** Calling `createApp()` returns an object with an `app` property that is an instance of `Hono` (can be started with `@hono/node-server`'s `serve()`).

- **createApp throws on missing config:** When `fusion.config.json` does not exist at the resolved path, `createApp()` throws an error during `JsonFileConfigAdapter` construction (descriptive message about missing file).

- **createApp throws on missing synthesizer:** When `fusion.config.json` has no provider with `role: "synthesizer"`, `createApp()` throws an error during `JsonFileConfigAdapter` construction.

- **createApp throws on missing env var:** When `fusion.config.json` references `apiKeyEnv: "OPENAI_API_KEY"` but `process.env.OPENAI_API_KEY` is not set (or empty), `createApp()` throws an error from `JsonFileConfigAdapter` construction.

### Bootstrap

- **main.ts starts server on configured port:** When `process.env.PORT` is `'4000'`, the server listens on port `4000`. When `process.env.PORT` is not set, the server listens on port `3000`.

- **TypeScript compilation:** `npx tsc --noEmit` exits with code 0 and no errors across all project files.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
