# Task 04: Infrastructure outbound adapters

## Metadata
- **Task:** 04
- **Phase:** 1
- **Route:** full
- **Slice:** Passthrough Chat Completion (OpenAI)

## Dependencies
- **Task 01 — Project scaffold and domain model types:** Provides `Message`, `ModelRef`, `FusionError`, `FusionRequest`, `ChatRequest`, `ChatResponse`, `ChatOptions`, `ResponseFormat`, `TokenUsage`, `FailedModelInfo`, `FusionStreamEvent` from `src/domain/model/`. Task 04 imports these to implement port interfaces.
- **Task 02 — Domain ports:** Provides `ChatModelPort`, `ConfigPort`, `LoggerPort`, `ClockPort` interfaces from `src/domain/ports/`. Task 04 implements these interfaces with concrete adapter classes.

## Traceability
- **Acceptance Criteria:** AC-5 (partial — adapter and factory), AC-6 (partial — config adapter)
- **NFRs:** NFR-3, NFR-6
- **Replan Gate Criteria:** Phase 1 Gate 2 (SDK confined to adapters)

## Source Traceability
- **Goals:** AC-5 (partial — OpenAiChatAdapter + ChatAdapterFactory selection), AC-6 (partial — JsonFileConfigAdapter loads fusion.config.json)
- **Plan:** Task 04, Phase 1 — Core Passthrough
- **Design:** Slice 1: Passthrough Chat Completion (OpenAI)
- **Structure:** Slice 1: Passthrough Chat Completion (OpenAI) — `src/infrastructure/outbound/config/json-file-config-adapter.ts`, `src/infrastructure/outbound/logging/console-logger-adapter.ts`, `src/infrastructure/outbound/llm/openai-chat-adapter.ts`, `src/infrastructure/outbound/llm/chat-adapter-factory.ts`

## Description

Implement the four outbound infrastructure adapters that satisfy the domain port interfaces defined in Task 02. Each adapter is a concrete class that lives in `src/infrastructure/outbound/` and imports only from domain ports/types and (where needed) external SDKs. None of these adapters import from `src/application/` or from other infrastructure modules except as noted.

---

### 1. `JsonFileConfigAdapter` (`src/infrastructure/outbound/config/json-file-config-adapter.ts`)

Implements `ConfigPort`. Reads and validates `fusion.config.json` at construction time so every accessor is synchronous and guaranteed to reflect a valid configuration.

**Config file schema (validated with zod):**

The root JSON object contains:
- `providers` (required, non-empty array): each entry has `type` (`"openai"`), `role` (`"panel" | "judge" | "synthesizer"`), `model` (string), `baseURL` (string), `apiKeyEnv` (string — name of an environment variable whose value is the API key).
- `timeoutMs` (optional, positive integer, default `30000`).

**Validation rules:**
- At least one provider must have `role: "synthesizer"` — the constructor throws if none is found.
- `role: "judge"` is optional — zero or one judge providers.
- Multiple panel providers are allowed.
- Every provider must have a valid `type` (`"openai"`), a non-empty `model`, a non-empty `baseURL`, and a non-empty `apiKeyEnv`.
- The environment variable named by `apiKeyEnv` must exist and be non-empty at construction time.

**Port methods:**

- `getPanelModels(): ModelRef[]` — returns every provider with `role: "panel"`. Each is a `ModelRef` with `provider`, `model`, `baseURL`, and the resolved `apiKey` from `process.env`.
- `getJudgeModel(): ModelRef | null` — returns the provider with `role: "judge"`, or `null` if no judge is configured.
- `getSynthesizerModel(): ModelRef` — returns the provider with `role: "synthesizer"`. This method never returns `null`; the constructor enforces that a synthesizer must exist, so the method simply returns it (no throw needed at call time).
- `getTimeoutMs(): number` — returns `timeoutMs` from config (default `30000`).

**Constructor signature:**

```typescript
constructor(configPath: string)
```

Reads the file at `configPath`, parses JSON, validates with zod, resolves environment variables, and stores the validated model lists. Throws with a descriptive message on any validation failure (missing file, malformed JSON, missing synthesizer, missing env var, etc.).

---

### 2. `ConsoleLoggerAdapter` (`src/infrastructure/outbound/logging/console-logger-adapter.ts`)

Implements `LoggerPort`. A minimal structured logger that writes single-line JSON strings to `console.log`. In Phase 1 the adapter is instantiated and wired; richer per-stage timing and token reporting is deferred to later phases but the interface methods must be fully implemented.

**Port methods:**

- `logStageStart(stage: string): void` — emits `console.log(JSON.stringify({ stage, event: "start" }))`.
- `logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void` — emits a JSON line containing `{ stage, event: "end", durationMs }` and, when `usage` is provided, a nested `tokens` object with `{ prompt: usage.promptTokens, completion: usage.completionTokens, total: usage.totalTokens }`. If `usage` is `undefined`, the `tokens` field is omitted.
- `logFailedModels(models: FailedModelInfo[]): void` — for each element in the array, emits a JSON line containing the `FailedModelInfo` fields: `modelId`, `errorCode`, and `errorMessage`. Each `FailedModelInfo` element has those three string fields (matching the domain type `FailedModelInfo`). The adapter serialises them as `{ event: "failed_model", modelId, errorCode, errorMessage }`.
- `logError(stage: string, error: Error): void` — emits a JSON line `{ stage, event: "error", message: error.message }`. The adapter does not attempt to serialise `error.stack` or other properties beyond `.message` in Phase 1.

**Constructor:**

```typescript
constructor()
```

No dependencies in Phase 1. (A `ClockPort` reference may be added in a later phase.)

---

### 3. `OpenAiChatAdapter` (`src/infrastructure/outbound/llm/openai-chat-adapter.ts`)

Implements `ChatModelPort` using the `openai` SDK (the only file in the project that imports `"openai"`). Confines the SDK per NFR-3. Implements `complete()` (non-streaming only in Phase 1).

**Constructor:**

```typescript
constructor(client: OpenAI)
```

Receives a pre-configured `OpenAI` client instance. The caller (DI container) is responsible for constructing the client with the correct `baseURL` and `apiKey` from the `ModelRef`. This keeps the adapter testable — a stub/mock client can be injected.

**`complete(request: ChatRequest): Promise<ChatResponse>`**

Maps the canonical `ChatRequest` to the OpenAI SDK's `ChatCompletionCreateParams` and maps the SDK's `ChatCompletion` response back to the canonical `ChatResponse`.

**Request mapping:**

1. `messages`: Passed through as-is (domain `Message` shape matches `{ role: string, content: string }` expected by the SDK).
2. `model`: Set to `request.model.model`.
3. `options` (when present):
   - `temperature` → `temperature` on SDK params.
   - `maxTokens` → `max_tokens` on SDK params.
   - `responseFormat`:
     - `type: "text"` → no `response_format` on the SDK request (SDK defaults to text).
     - `type: "json_object"` → `response_format: { type: "json_object" }`.
     - `type: "json_schema"` → `response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema: request.options.responseFormat.schema } }`. The domain field `schema` holds the JSON Schema object; it is passed as the `schema` property inside the SDK's `json_schema` parameter. The `name` is hard-coded to `"response"` and `strict` to `true` for Phase 1.

**Response mapping:**

The SDK returns a `ChatCompletion` object (or one of its overload shapes). The adapter extracts:

- `content`: from `choice.message.content` (the first choice; string or null — coalesce null to `""`).
- `usage`: `{ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens }`. If `usage` is absent from the SDK response, default all three counts to `0`.
- `model`: from `response.model`.

Returns `Promise<ChatResponse>`.

**Error handling:**

If the SDK call rejects (network error, API error, timeout, etc.), the adapter re-throws the error as-is. The caller (application layer) handles errors.

---

### 4. `ChatAdapterFactory` (`src/infrastructure/outbound/llm/chat-adapter-factory.ts`)

A factory that returns a `ChatModelPort` implementation for a given `ModelRef`. Only the `"openai"` provider type is supported in Phase 1.

**Constructor:**

```typescript
constructor()
```

No dependencies.

**`create(modelRef: ModelRef): ChatModelPort`**

- When `modelRef.provider === "openai"`: constructs an `OpenAI` client with `{ baseURL: modelRef.baseURL, apiKey: modelRef.apiKey }` (plus any SDK defaults), then returns `new OpenAiChatAdapter(client)`.
- When `modelRef.provider` is any other value (including `"anthropic"`, which is added in Phase 5): throws an `Error` with a message indicating the provider type is unsupported (e.g., `Unknown provider type: 'anthropic'`).

The factory must import `OpenAI` from `"openai"` (not the adapter) since it constructs the SDK client. The adapter itself is the only place the SDK is used for API calls, keeping NFR-3 satisfied — the factory's use of the SDK is limited to client construction.

---

## Files
- `src/infrastructure/outbound/config/json-file-config-adapter.ts` (CREATE) — `JsonFileConfigAdapter` implements `ConfigPort`; reads `fusion.config.json`, validates with zod, exposes typed accessors.
- `src/infrastructure/outbound/logging/console-logger-adapter.ts` (CREATE) — `ConsoleLoggerAdapter` implements `LoggerPort` with `console.log`; minimal structured output.
- `src/infrastructure/outbound/llm/openai-chat-adapter.ts` (CREATE) — `OpenAiChatAdapter` implements `ChatModelPort` via `openai` SDK; maps `ChatRequest` → SDK params, SDK response → `ChatResponse`.
- `src/infrastructure/outbound/llm/chat-adapter-factory.ts` (CREATE) — `ChatAdapterFactory`: selects `OpenAiChatAdapter` when `provider.type === "openai"`; throws for unknown types.

## Test Expectations
- **Config loads valid file:** When `JsonFileConfigAdapter` is constructed with a path to a valid `fusion.config.json` containing one `"panel"` provider and one `"synthesizer"` provider, `getPanelModels()` returns a non-empty array where each element has `provider`, `model`, `baseURL`, and a resolved `apiKey` string. `getSynthesizerModel()` returns a `ModelRef` (not null). `getTimeoutMs()` returns the configured value or `30000` if absent.
- **Config missing synthesizer throws:** When `fusion.config.json` has no provider with `role: "synthesizer"`, the `JsonFileConfigAdapter` constructor throws an error. `getSynthesizerModel()` is never called on an instance that would return null — the constructor prevents that state.
- **Config judge optional:** When `fusion.config.json` has no provider with `role: "judge"`, `getJudgeModel()` returns `null` without throwing.
- **Config missing env var throws:** When `apiKeyEnv` references an environment variable that does not exist or is empty, the `JsonFileConfigAdapter` constructor throws.
- **Config invalid JSON throws:** When the file at `configPath` contains malformed JSON, the constructor throws.
- **Config invalid schema throws:** When the file is valid JSON but fails zod validation (e.g., missing `providers`, a provider with empty `model`, `type` not `"openai"`), the constructor throws.
- **Logger stage start:** Calling `logStageStart("panel")` on `ConsoleLoggerAdapter` causes `console.log` to be called with a JSON string whose parsed object contains `{ stage: "panel", event: "start" }`.
- **Logger stage end with usage:** Calling `logStageEnd("panel", 150, { promptTokens: 100, completionTokens: 50, totalTokens: 150 })` causes `console.log` to be called with a JSON string whose parsed object contains `{ stage: "panel", event: "end", durationMs: 150, tokens: { prompt: 100, completion: 50, total: 150 } }`.
- **Logger stage end without usage:** Calling `logStageEnd("panel", 150)` (no usage argument) omits the `tokens` field from the logged object.
- **Logger failed models:** Calling `logFailedModels([{ modelId: "gpt-4o", errorCode: "TIMEOUT", errorMessage: "Request timed out after 30s" }])` causes `console.log` to be called with a JSON string whose parsed object contains `{ event: "failed_model", modelId: "gpt-4o", errorCode: "TIMEOUT", errorMessage: "Request timed out after 30s" }`.
- **Logger error:** Calling `logError("passthrough", new Error("connection refused"))` causes `console.log` to be called with a JSON string whose parsed object contains `{ stage: "passthrough", event: "error", message: "connection refused" }`.
- **OpenAI adapter complete maps messages:** When `OpenAiChatAdapter.complete()` receives a `ChatRequest` with `messages: [{ role: "user", content: "hello" }]` and `model.model: "gpt-4o"`, the underlying OpenAI SDK client is called with `messages` and `model` matching those values. The returned `ChatResponse.content` equals the content string from the first choice of the SDK response.
- **OpenAI adapter extracts usage:** When the OpenAI SDK response includes `usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }`, the returned `ChatResponse.usage` has `promptTokens: 10`, `completionTokens: 20`, `totalTokens: 30`.
- **OpenAI adapter handles missing usage:** When the SDK response has no `usage` field, the returned `ChatResponse.usage` has all three token counts as `0`.
- **OpenAI adapter response format json_object:** When `ChatRequest.options.responseFormat` is `{ type: "json_object" }`, the SDK is called with `response_format: { type: "json_object" }`.
- **OpenAI adapter response format json_schema:** When `ChatRequest.options.responseFormat` is `{ type: "json_schema", schema: { type: "object", properties: { answer: { type: "string" } } } }`, the SDK is called with `response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema: { type: "object", properties: { answer: { type: "string" } } } } }`. The domain field `schema` maps to the OpenAI SDK parameter `json_schema.schema`.
- **OpenAI adapter response format text:** When no `responseFormat` is set, or `responseFormat.type` is `"text"`, no `response_format` parameter is sent to the SDK.
- **OpenAI adapter passes options:** When `ChatRequest.options` includes `temperature: 0.7` and `maxTokens: 256`, the SDK is called with `temperature: 0.7` and `max_tokens: 256`.
- **OpenAI adapter propagates SDK errors:** When the underlying OpenAI SDK call rejects (network failure, API error), `complete()` rejects with that same error.
- **ChatAdapterFactory creates OpenAI adapter:** Calling `ChatAdapterFactory.create()` with `modelRef.provider === "openai"` returns an instance of `OpenAiChatAdapter` whose `complete()` method, when called, makes an HTTP request through the `openai` SDK to the configured `baseURL`.
- **ChatAdapterFactory throws on unknown provider:** Calling `ChatAdapterFactory.create()` with `modelRef.provider === "anthropic"` (or any value other than `"openai"`) throws an `Error` whose message indicates the provider type is unsupported.
