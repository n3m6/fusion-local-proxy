# Task 01: Core Passthrough: hexagonal skeleton + OpenAI endpoint

## Metadata
- **Task:** 01
- **Phase:** 1
- **Route:** full
- **Slice:** Passthrough Chat Completion (OpenAI)

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC-1, AC-2, AC-3 (complete signature only), AC-4, AC-5, AC-6
- **NFRs:** NFR-1, NFR-2, NFR-3 (openai SDK only in OpenAiChatAdapter), NFR-6
- **Replan Gate Criteria:** Phase 1 Gate 1 (real client receives valid ChatCompletion JSON via passthrough), Phase 1 Gate 2 (zero SDK/framework imports in domain and application layers)

## Source Traceability
- **Goals:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6
- **Plan:** Task 01, Phase 1 — Core Passthrough
- **Design:** Slice 1 — Passthrough Chat Completion (OpenAI)
- **Structure:** Slice 1 — Passthrough Chat Completion (OpenAI); files: `package.json`, `tsconfig.json`, `.env.example`, `fusion.config.json`, `src/domain/model/message.ts`, `src/domain/model/chat-types.ts`, `src/domain/model/fusion-types.ts`, `src/domain/model/stream-types.ts`, `src/domain/ports/chat-model-port.ts`, `src/domain/ports/config-port.ts`, `src/domain/ports/logger-port.ts`, `src/domain/ports/clock-port.ts`, `src/application/ports/fusion-service.ts`, `src/application/usecases/run-fusion-use-case.ts`, `src/infrastructure/inbound/http/server.ts`, `src/infrastructure/inbound/http/openai/route.ts`, `src/infrastructure/inbound/http/openai/translator.ts`, `src/infrastructure/inbound/http/models-route.ts`, `src/infrastructure/outbound/llm/openai-chat-adapter.ts`, `src/infrastructure/outbound/llm/chat-adapter-factory.ts`, `src/infrastructure/outbound/config/json-file-config-adapter.ts`, `src/infrastructure/outbound/logging/console-logger-adapter.ts`, `src/infrastructure/di/container.ts`, `src/main.ts`

## Description

### Objective

Establish the complete hexagonal (ports-and-adapters) project skeleton and deliver a working OpenAI-compatible `/v1/chat/completions` passthrough endpoint. The system starts up, loads configuration from `fusion.config.json`, receives an OpenAI-format chat completion request, translates it to the canonical domain model, calls a single configured model through `ChatModelPort`, translates the response back, and returns a valid `ChatCompletion` JSON to the client. The `/v1/models` endpoint returns a stub model list. This slice proves the dependency rule, configuration loading, DI wiring, and real outbound LLM integration end-to-end.

### Architecture Overview

The system follows a hexagonal ports-and-adapters architecture with the dependency rule: **`infrastructure → application → domain`**. The domain and application layers contain zero imports from any SDK or framework (`openai`, `@anthropic-ai/sdk`, `hono`, `zod` runtime usage). All I/O and provider SDKs are confined to infrastructure adapters.

- **Domain layer** (`src/domain/`): pure TypeScript types, interfaces for outbound ports (`ChatModelPort`, `ConfigPort`, `LoggerPort`, `ClockPort`), and model types (`Message`, `ChatRequest`, `ChatResponse`, `FusionRequest`, `FusionStreamEvent`, `FusionError`). Zero dependencies on application or infrastructure.
- **Application layer** (`src/application/`): the inbound port `FusionService` defining `runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent>`, and `RunFusionUseCase` implementing it as a passthrough. Zero imports from infrastructure.
- **Infrastructure layer** (`src/infrastructure/`): inbound HTTP adapters (Hono server, OpenAI route, translator, models route), outbound adapters (`OpenAiChatAdapter`, `ChatAdapterFactory`, `JsonFileConfigAdapter`, `ConsoleLoggerAdapter`), DI container, and bootstrap.

### Passthrough Mode

In Slice 1, there is no ensemble pipeline: fan-out, judge, and streaming are deferred to later slices. The system operates in **passthrough mode** — a single incoming chat completion request is forwarded to exactly one configured model, and its response is returned verbatim.

The `fusion.config.json` contains a single provider entry with `role: "panel"`. The use case selects the model by calling `configPort.getPanelModels()[0]`. If the panel array is empty, the use case throws a descriptive error. There is no synthesizer or judge role configured in this slice; `ConfigPort.getSynthesizerModel()` returns `null` and `ConfigPort.getJudgeModel()` returns `null`.

The `RunFusionUseCase.runFusion()` method:
1. Calls `loggerPort.logStageStart('passthrough')`.
2. Obtains the model from `configPort.getPanelModels()[0]` (throws if empty).
3. Constructs a `ChatRequest` from the incoming `FusionRequest` messages, mapping the model ref and any options (temperature, maxTokens).
4. Calls `chatModelPort.complete(chatRequest)` and awaits the `ChatResponse`.
5. Yields a single `FusionStreamEvent` of type `content_delta` carrying the full response content, then yields a `done` event with the token usage.
6. Calls `loggerPort.logStageEnd('passthrough', durationMs, usage)`.

### `fusion.config.json` Shape

```json
{
  "providers": [
    {
      "type": "openai",
      "role": "panel",
      "model": "gpt-4o",
      "baseURL": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  ],
  "timeoutMs": 30000
}
```

- `providers`: array of provider entries. Each entry has `type` (`"openai"`), `role` (`"panel"`), `model` (string), `baseURL` (string), and `apiKeyEnv` (string — name of environment variable holding the API key).
- `timeoutMs`: optional integer, default 30000.

The `JsonFileConfigAdapter` reads this file at construction time, validates it with a zod schema, and exposes the data through the `ConfigPort` interface. The zod validation must reject missing required fields (`type`, `role`, `model`, `baseURL`, `apiKeyEnv`) with clear error messages and accept an empty `providers` array.

### Hono Server and Route Behavior

**`src/infrastructure/inbound/http/server.ts`** exports a `createServer(fusionService: FusionService, configPort: ConfigPort): Hono` function. The returned Hono app mounts:
- `POST /v1/chat/completions` via the OpenAI route.
- `GET /v1/models` via the models route.

The bootstrap in `src/main.ts` calls `createServer()` and starts the `@hono/node-server` listener on a configurable port (default `3000`, read from `PORT` env var with fallback).

**`POST /v1/chat/completions` route** (`src/infrastructure/inbound/http/openai/route.ts`):
1. Parses the incoming JSON body (no zod validation — forward the raw object).
2. Calls `openAiRequestToFusion(body)` to translate to a `FusionRequest`.
3. Calls `fusionService.runFusion(fusionRequest)` to obtain an `AsyncIterable<FusionStreamEvent>`.
4. Passes the async iterable directly to `fusionStreamToOpenAiResponse(events)` and `await`s the resulting `Promise<Record<string, unknown>>`. **Do not** collect events into an intermediate array — pass the async iterable directly.
5. Returns the result as JSON via `c.json()`.

**`GET /v1/models` route** (`src/infrastructure/inbound/http/models-route.ts`):
1. Reads model entries from `configPort.getPanelModels()`, `configPort.getJudgeModel()`, and `configPort.getSynthesizerModel()`.
2. In Slice 1, only `getPanelModels()` returns entries; `getJudgeModel()` and `getSynthesizerModel()` return `null`. The route must handle `null` gracefully (skip null entries).
3. Returns a JSON object with a `data` array where each entry has an `id` (the model string) and `object: "model"`.

### Translator Functions

**`openAiRequestToFusion(body: Record<string, unknown>): FusionRequest`** — extracts `messages`, `model`, `stream`, `system` prompt, `max_tokens`, and `temperature` from the OpenAI-format body and constructs a `FusionRequest`. The `model` field from the OpenAI request is informational at this stage; the actual model called is determined by `fusion.config.json`.

**`fusionStreamToOpenAiResponse(events: AsyncIterable<FusionStreamEvent>): Promise<Record<string, unknown>>`** — consumes the async iterable, collecting `content_delta` deltas into an accumulated content string, capturing `usage` and `failedModels` from the `done` event, and returns a single JSON object matching the OpenAI `ChatCompletion` shape:
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "...",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```
The `id` must be a unique string (generated per call). The `created` field is a Unix timestamp in seconds. The `model` field reflects the actual model name from the `ChatResponse`. If the async iterable yields an `error` event instead of `done`, the function throws a `FusionError` with the error code and message.

### Outbound Adapters

**`OpenAiChatAdapter`** (`src/infrastructure/outbound/llm/openai-chat-adapter.ts`):
- Constructor receives an `OpenAI` client instance (from the `openai` SDK). The client is pre-configured with `baseURL` and `apiKey`.
- `complete(request: ChatRequest): Promise<ChatResponse>`:
  1. Maps `ChatRequest.messages` to the OpenAI SDK message format: `{ role: message.role, content: message.content }`.
  2. Calls `client.chat.completions.create({ model, messages, temperature, max_tokens, ... })`.
  3. Extracts `content` from `choice.message.content` (with null-coalesce to empty string), converts `usage` to the domain `TokenUsage` shape, and returns `{ content, usage, model }`.

**`ChatAdapterFactory`** (`src/infrastructure/outbound/llm/chat-adapter-factory.ts`):
- `create(modelRef: ModelRef): ChatModelPort` — when `modelRef.provider === 'openai'`, constructs an `OpenAI` client with `{ baseURL: modelRef.baseURL, apiKey: modelRef.apiKey }` and returns a new `OpenAiChatAdapter(client)`. Throws for unknown provider types.

**`JsonFileConfigAdapter`** (`src/infrastructure/outbound/config/json-file-config-adapter.ts`):
- Constructor reads and parses `fusion.config.json` from the given path, validates against a zod schema. If the file does not exist, the constructor throws a descriptive error. If the JSON is malformed or fails zod validation, the constructor throws with the zod error details.
- `getPanelModels(): ModelRef[]` — returns panel entries mapped to `ModelRef` objects (reading `apiKey` from `process.env[entry.apiKeyEnv]`; throws if the env var is unset).
- `getJudgeModel(): ModelRef | null` — returns the judge entry as `ModelRef`, or `null` if no `role: "judge"` entry exists.
- `getSynthesizerModel(): ModelRef | null` — returns the synthesizer entry as `ModelRef`, or `null` if no `role: "synthesizer"` entry exists. In Slice 1, this returns `null` because no synthesizer is configured.
- `getTimeoutMs(): number` — returns the configured `timeoutMs` or the default `30000`.

**`ConsoleLoggerAdapter`** (`src/infrastructure/outbound/logging/console-logger-adapter.ts`):
- Implements `LoggerPort` with `console.log`. Each method emits a structured JSON line: `{ stage, event, message, ... }`.
- `logStageStart(stage)` — logs `{ stage, event: 'start' }`.
- `logStageEnd(stage, durationMs, usage?)` — logs `{ stage, event: 'end', durationMs, tokens: usage }`.
- `logFailedModels(models)` — logs `{ event: 'failed_models', models }`.
- `logError(stage, error)` — logs `{ stage, event: 'error', error: error.message }`.

### DI Container and Bootstrap

**`src/infrastructure/di/container.ts`** is the composition root. It performs manual dependency injection:

1. Determines config path (from `FUSION_CONFIG_PATH` env var, default `fusion.config.json`).
2. Instantiates `JsonFileConfigAdapter(configPath)` → `ConfigPort`.
3. Instantiates `ConsoleLoggerAdapter()` → `LoggerPort`.
4. Instantiates a simple `ClockPort` implementation (object with `now: () => Date.now()`).
5. Obtains the passthrough model via `configPort.getPanelModels()[0]` — throws if empty.
6. Instantiates `ChatAdapterFactory` and calls `factory.create(panelModel)` to obtain a `ChatModelPort`.
7. Instantiates `RunFusionUseCase(chatModelPort, configPort, loggerPort, clockPort)` → `FusionService`.
8. Calls `createServer(fusionService, configPort)` to obtain the Hono app.
9. Exports the app (or a `start()` function).

**`src/main.ts`** imports the container, reads `PORT` from env (default `3000`), and calls `serve({ fetch: app.fetch, port })` from `@hono/node-server`. Logs the listening address to console.

### TypeScript and Project Config

- **`package.json`**: `"type": "module"`, `"engines": { "node": ">=20.0.0" }`, scripts: `"dev": "tsx src/main.ts"`, `"start": "node --loader tsx src/main.ts"`. Dependencies: `hono`, `@hono/node-server`, `openai@^6.42.0`, `zod`. DevDependencies: `tsx`, `typescript`, `@types/node`.
- **`tsconfig.json`**: `"strict": true`, `"target": "ES2023"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"esModuleInterop": true`, `"skipLibCheck": true`, `"resolveJsonModule": true`, `"isolatedModules": true`, `"declaration": true`, `"outDir": "dist"`, `"rootDir": "."` — but `include` must cover all source files without conflicts. Use `"include": ["src/**/*.ts"]` and omit `rootDir` or set it to `"."` so that all files under `src/` are included. Do not set `rootDir` to `"src"` alone if `include` references test files outside `src/`; for this slice, `include: ["src/**/*.ts"]` with `rootDir: "."` is safe.
- **`.env.example`**: documents `OPENAI_API_KEY` and any other `apiKeyEnv` variables. Each line is a comment explaining the variable's purpose.

## Files
- `package.json` (CREATE) — Node 20+ ESM project manifest with `hono`, `@hono/node-server`, `openai@^6.42.0`, `zod` dependencies and `tsx` dev script
- `tsconfig.json` (CREATE) — strict TypeScript config, `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `resolveJsonModule: true`, `include: ["src/**/*.ts"]`, `rootDir: "."`
- `.env.example` (CREATE) — template documenting `apiKeyEnv` variable names referenced by `fusion.config.json`
- `fusion.config.json` (CREATE) — single-provider config with `type: "openai"`, `role: "panel"`, `model`, `baseURL`, `apiKeyEnv`, and `timeoutMs: 30000`
- `src/domain/model/message.ts` (CREATE) — `Message` type with `role` (`'system' | 'user' | 'assistant'`) and string `content`
- `src/domain/model/chat-types.ts` (CREATE) — `ChatRequest`, `ChatResponse`, `ChatOptions`, `TokenUsage`, `ResponseFormat` types
- `src/domain/model/fusion-types.ts` (CREATE) — `ModelRef`, `ProviderType`, `FusionError` class (with `code`, `message`, optional `details`), `FusionRequest`
- `src/domain/model/stream-types.ts` (CREATE) — `FusionStreamEvent` discriminated union (`progress`, `content_delta`, `content_stop`, `done`, `error`) and `FailedModelInfo`
- `src/domain/ports/chat-model-port.ts` (CREATE) — `ChatModelPort` interface with `complete(request: ChatRequest): Promise<ChatResponse>`
- `src/domain/ports/config-port.ts` (CREATE) — `ConfigPort` interface: `getPanelModels(): ModelRef[]`, `getJudgeModel(): ModelRef | null`, `getSynthesizerModel(): ModelRef | null`, `getTimeoutMs(): number`
- `src/domain/ports/logger-port.ts` (CREATE) — `LoggerPort` interface: `logStageStart`, `logStageEnd`, `logFailedModels`, `logError`
- `src/domain/ports/clock-port.ts` (CREATE) — `ClockPort` interface: `now(): number`
- `src/application/ports/fusion-service.ts` (CREATE) — `FusionService` inbound port: `runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent>`
- `src/application/usecases/run-fusion-use-case.ts` (CREATE) — `RunFusionUseCase` implementing `FusionService` as passthrough: calls `configPort.getPanelModels()[0]` (throws if empty), calls `ChatModelPort.complete()`, yields single `content_delta` + `done` stream event
- `src/infrastructure/inbound/http/server.ts` (CREATE) — Hono app factory: creates app, mounts OpenAI routes and `/v1/models`, exports `createServer(fusionService, configPort)`
- `src/infrastructure/inbound/http/openai/route.ts` (CREATE) — `POST /v1/chat/completions` route: parses OpenAI body, translates to `FusionRequest`, calls `FusionService.runFusion()`, passes the `AsyncIterable` directly to `fusionStreamToOpenAiResponse()`, returns JSON
- `src/infrastructure/inbound/http/openai/translator.ts` (CREATE) — `openAiRequestToFusion(body: Record<string, unknown>): FusionRequest` and `fusionStreamToOpenAiResponse(events: AsyncIterable<FusionStreamEvent>): Promise<Record<string, unknown>>` (non-streaming only; consumes async iterable, collects content, returns ChatCompletion JSON)
- `src/infrastructure/inbound/http/models-route.ts` (CREATE) — `GET /v1/models` returning JSON with `data` array populated from `ConfigPort` (panel models, judge model if non-null, synthesizer model if non-null)
- `src/infrastructure/outbound/llm/openai-chat-adapter.ts` (CREATE) — `OpenAiChatAdapter` implements `ChatModelPort` via `openai` SDK; maps `ChatRequest` ↔ SDK params, SDK response → `ChatResponse`
- `src/infrastructure/outbound/llm/chat-adapter-factory.ts` (CREATE) — `ChatAdapterFactory`: selects `OpenAiChatAdapter` when `provider.type === 'openai'`; throws for unknown types
- `src/infrastructure/outbound/config/json-file-config-adapter.ts` (CREATE) — `JsonFileConfigAdapter` implements `ConfigPort`: reads `fusion.config.json`, validates with zod, exposes typed accessors; `getSynthesizerModel()` returns `null` when no `role: "synthesizer"` entry exists; `getJudgeModel()` returns `null` when no `role: "judge"` entry exists
- `src/infrastructure/outbound/logging/console-logger-adapter.ts` (CREATE) — `ConsoleLoggerAdapter` implements `LoggerPort` with `console.log`; minimal structured JSON output
- `src/infrastructure/di/container.ts` (CREATE) — manual composition root: instantiates config → logger → clock → factory → adapter (from `getPanelModels()[0]`) → use case → routes → server
- `src/main.ts` (CREATE) — bootstrap: imports container, calls `serve()` from `@hono/node-server`, listens on `PORT` (default 3000)

## Test Expectations
- **Project scaffold**: `npm install` succeeds with no errors. `npx tsc --noEmit` passes with zero errors (strict mode, all files under `src/` compile).
- **Dependency rule (Phase 1 Gate 2)**: `grep -r "from 'openai'" src/domain/` returns empty. `grep -r "from 'openai'" src/application/` returns empty. `grep -r "from '@anthropic-ai/sdk'" src/domain/ src/application/` returns empty. `grep -r "from 'hono'" src/domain/ src/application/` returns empty. `grep -r "from 'zod'" src/domain/ src/application/` returns empty (zod is used only in `src/infrastructure/` for config validation and in `src/domain/services/` for the `Analysis` schema in Slice 3; the domain model types in Slice 1 must not import `zod`).
- **Config loading**: When `fusion.config.json` exists and is valid, `JsonFileConfigAdapter` parses it and `getPanelModels()` returns an array with one entry containing the configured `model`, `baseURL`, and `apiKey` (from env). `getJudgeModel()` returns `null`. `getSynthesizerModel()` returns `null`. `getTimeoutMs()` returns `30000`.
- **Config validation**: When `fusion.config.json` has a missing required field (e.g., `model`), `JsonFileConfigAdapter` constructor throws an error with a message describing the zod validation failure. When `fusion.config.json` does not exist at the given path, the constructor throws with a descriptive file-not-found error.
- **Config env var**: When a configured `apiKeyEnv` variable (e.g., `OPENAI_API_KEY`) is not set in the environment, `JsonFileConfigAdapter.getPanelModels()` throws a descriptive error naming the missing variable. When the env var is set, the `apiKey` field in the returned `ModelRef` is its value.
- **Server startup**: When `OPENAI_API_KEY` is set to a valid key (or a dummy value), running `npx tsx src/main.ts` starts the server and logs the listening address. When `OPENAI_API_KEY` is unset and no dummy value is configured, startup may fail with a clear error about the missing environment variable, or the server may start and the first request fails — the behavior depends on whether the SDK validates the key at client construction time.
- **Passthrough chat completion (Phase 1 Gate 1)**: With a real OpenAI-compatible backend reachable at the configured `baseURL` (e.g., OpenRouter, a local Ollama instance at `http://localhost:11434/v1`, or the live OpenAI API), a `curl` request to `POST http://localhost:3000/v1/chat/completions` with body `{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}` returns HTTP 200 with a JSON body matching the OpenAI `ChatCompletion` shape: `object: "chat.completion"`, `choices[0].message.content` is a non-empty string, `usage` has numeric `prompt_tokens`, `completion_tokens`, `total_tokens`.
- **`/v1/models` endpoint**: `curl http://localhost:3000/v1/models` returns HTTP 200 with `{"object": "list", "data": [{"id": "<model-from-config>", "object": "model"}]}`. The `id` matches the `model` field from `fusion.config.json`. Only the panel model entry appears (judge and synthesizer are `null` in Slice 1).
- **Error passthrough**: When the upstream LLM returns an error (e.g., invalid API key, model not found), the `/v1/chat/completions` route returns an appropriate HTTP error status (not 200) with a JSON error body. The exact status code and shape depend on how `OpenAiChatAdapter` surfaces SDK errors — at minimum, the error is not silently swallowed.
- **Graceful empty panel**: If `fusion.config.json` has an empty `providers` array (no panel models), `configPort.getPanelModels()` returns `[]`. The `RunFusionUseCase` or DI container throws a descriptive error indicating that at least one panel model is required.
