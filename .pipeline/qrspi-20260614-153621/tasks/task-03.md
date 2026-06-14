# Task 03: Application passthrough use case

## Metadata
- **Task:** 03
- **Phase:** 1
- **Route:** full
- **Slice:** Passthrough Chat Completion (OpenAI)

## Dependencies
- **01** — Provides domain model types: `Message` (`src/domain/model/message.ts`), `ChatRequest`, `ChatResponse`, `ChatOptions`, `TokenUsage` (`src/domain/model/chat-types.ts`), `ModelRef`, `ProviderType`, `FusionError`, `FusionRequest` (`src/domain/model/fusion-types.ts`), `FusionStreamEvent`, `FailedModelInfo` (`src/domain/model/stream-types.ts`).
- **02** — Provides domain port interfaces: `ChatModelPort` (`src/domain/ports/chat-model-port.ts`), `ConfigPort` (`src/domain/ports/config-port.ts`), `LoggerPort` (`src/domain/ports/logger-port.ts`), `ClockPort` (`src/domain/ports/clock-port.ts`).

## Traceability
- **Acceptance Criteria:** AC-4
- **NFRs:** NFR-1
- **Replan Gate Criteria:** Phase 1 Gate 2 (zero SDK/framework imports in application)

## Source Traceability
- **Goals:** AC-4
- **Plan:** Task 03, Phase 1 — Core Passthrough
- **Design:** Slice 1 — Passthrough Chat Completion (OpenAI)
- **Structure:** Slice 1 — Passthrough Chat Completion (OpenAI); files `src/application/ports/fusion-service.ts`, `src/application/usecases/run-fusion-use-case.ts`

## Description

Define the `FusionService` inbound port and implement a passthrough `RunFusionUseCase` that calls a single model through `ChatModelPort.complete()` and yields the result as stream events. This is the application layer's only entry point — all inbound HTTP routes will eventually call `FusionService.runFusion()`.

### `FusionService` (`src/application/ports/fusion-service.ts`)

The `FusionService` interface is the single inbound port for the ensemble pipeline. It declares:

```ts
export interface FusionService {
  runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent>;
}
```

Where:
- `FusionRequest` comes from `src/domain/model/fusion-types.ts` and carries `messages`, optional `systemPrompt`, `stream`, `maxTokens`, and `temperature`.
- `AsyncIterable<FusionStreamEvent>` lets the caller iterate events without buffering. `FusionStreamEvent` is the discriminated union from `src/domain/model/stream-types.ts` with variants: `progress`, `content_delta`, `content_stop`, `done`, `error`.

No implementation details belong in this file — it is purely an interface.

### `RunFusionUseCase` (`src/application/usecases/run-fusion-use-case.ts`)

`RunFusionUseCase` is the application-layer orchestrator that implements `FusionService`. In this passthrough phase it maps a `FusionRequest` to a single `ChatModelPort.complete()` call and yields two stream events: one `content_delta` carrying the full response text, and one `done` carrying token usage.

#### Constructor

```ts
constructor(
  chatModelPort: ChatModelPort,
  configPort: ConfigPort,
  loggerPort: LoggerPort,
  clockPort: ClockPort
)
```

The four ports are injected. The class imports only from `src/domain/` — zero imports from `src/infrastructure/` or any npm SDK.

#### `runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent>`

Implemented as an `async function*` generator with the following steps:

1. **Resolve the synthesizer model** — call `this.configPort.getSynthesizerModel()`. This returns a `ModelRef` (with `provider`, `model`, `baseURL`, `apiKey`).

2. **Log stage start and capture start time** — call `this.loggerPort.logStageStart('synthesis')` and `const startTime = this.clockPort.now()`.

3. **Build the `ChatRequest`** (`src/domain/model/chat-types.ts`):

   - `messages`: Start with a shallow copy of `request.messages` (array of `Message`). If `request.systemPrompt` is a non-empty string, prepend a system message: `{ role: 'system', content: request.systemPrompt }`.
   - `model`: The `ModelRef` from step 1.
   - `options`: An object that includes `temperature` if `request.temperature` is defined, and `maxTokens` if `request.maxTokens` is defined. Omit the entire `options` property if neither is set.

   Example `ChatRequest` shape:
   ```ts
   const chatRequest: ChatRequest = {
     messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...request.messages] : [...request.messages],
     model: synthesizerModel,
     options: {
       ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
       ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
     },
   };
   ```

4. **Call the model** — `const response: ChatResponse = await this.chatModelPort.complete(chatRequest)`.

5. **Compute duration and log** — `const durationMs = this.clockPort.now() - startTime` followed by `this.loggerPort.logStageEnd('synthesis', durationMs, response.usage)`.

6. **Yield content event** — yield `{ type: 'content_delta' as const, delta: response.content }`.

7. **Yield done event** — yield `{ type: 'done' as const, usage: response.usage }`. In passthrough mode there are no panel models, so do not include a `failedModels` property (or include an empty array — either is acceptable).

#### Error propagation

If `ChatModelPort.complete()` rejects, the error propagates out of the async generator naturally. The use case does not catch, wrap, or translate errors in this task — callers (the infrastructure layer) handle that.

#### Import restrictions (NFR-1, Phase 1 Gate 2)

Both files must only import from `src/domain/` paths. Specifically:

- `src/application/ports/fusion-service.ts` imports `FusionRequest` from `src/domain/model/fusion-types.js` and `FusionStreamEvent` from `src/domain/model/stream-types.js`.
- `src/application/usecases/run-fusion-use-case.ts` imports `FusionService` from `../ports/fusion-service.js`, `ChatModelPort` from `src/domain/ports/chat-model-port.js`, `ConfigPort` from `src/domain/ports/config-port.js`, `LoggerPort` from `src/domain/ports/logger-port.js`, `ClockPort` from `src/domain/ports/clock-port.js`, `FusionRequest` from `src/domain/model/fusion-types.js`, `FusionStreamEvent` from `src/domain/model/stream-types.js`, `ChatRequest` from `src/domain/model/chat-types.js`, `ChatResponse` from `src/domain/model/chat-types.js`, and `Message` from `src/domain/model/message.js`.

All imports use `*.js` extension (as required by ESM/NodeNext module resolution).

No imports from `src/infrastructure/`, `openai`, `@anthropic-ai/sdk`, `hono`, `@hono/node-server`, or any other npm package beyond what TypeScript and Node provide.

## Files
- `src/application/ports/fusion-service.ts` (CREATE) — `FusionService` interface: single method `runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent>`.
- `src/application/usecases/run-fusion-use-case.ts` (CREATE) — `RunFusionUseCase` class implementing `FusionService`. Passthrough mode: resolves the synthesizer model from `ConfigPort`, builds a `ChatRequest`, calls `ChatModelPort.complete()`, measures latency via `ClockPort`, logs via `LoggerPort`, and yields `content_delta` + `done` stream events.

## Test Expectations
- **Interface shape**: `FusionService` is an exported TypeScript interface with a single method `runFusion` that accepts a `FusionRequest` and returns `AsyncIterable<FusionStreamEvent>`. No default implementation, no additional methods, no side effects.
- **Zero infrastructure imports**: Running `grep -r "from 'openai'" src/application/` and `grep -r "from '@anthropic-ai/sdk'" src/application/` returns no matches. Running `grep -r "from.*infrastructure" src/application/` returns no matches.
- **Constructor injection**: `RunFusionUseCase` can be instantiated with four arguments matching `ChatModelPort`, `ConfigPort`, `LoggerPort`, and `ClockPort` (plain objects satisfying the interfaces are sufficient for compilation).
- **Passthrough happy path**: When `runFusion` is called with a request containing `messages: [{ role: 'user', content: 'hello' }]` and stubbed ports (where `getSynthesizerModel()` returns a `ModelRef`, `complete()` resolves to `{ content: 'hi', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'test' }`, `now()` returns sequential numbers, and logger methods are no-ops), iterating the returned async iterable yields exactly two events in order: `{ type: 'content_delta', delta: 'hi' }` then `{ type: 'done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }`.
- **System prompt prepend**: When `request.systemPrompt` is `'Be helpful'` and `request.messages` contains a user message, the `ChatRequest` passed to `complete()` has `messages` starting with `{ role: 'system', content: 'Be helpful' }` followed by the original user message.
- **Logger calls**: On a successful call, `logStageStart('synthesis')` is called exactly once before `complete()`, and `logStageEnd('synthesis', <durationMs>, <usage>)` is called exactly once after `complete()` returns. The `durationMs` argument equals `clockPort.now()` second call minus first call.
- **Error propagation**: When the stubbed `complete()` rejects with an `Error('upstream failure')`, iterating the async iterable rejects with that same error at the point where `complete()` is called. No `FusionStreamEvent` is yielded.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
