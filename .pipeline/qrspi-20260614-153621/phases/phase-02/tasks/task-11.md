# Task 11: DI container ensemble wiring

## Metadata
- **Task:** 11
- **Phase:** 5
- **Route:** full
- **Slice:** Slice 6 (Wiring)

## Dependencies
- **06 (RunFusionUseCase ensemble overhaul):** Provides the revised `RunFusionUseCase` constructor that accepts `PanelRunner`, `JudgeStep`, and `SynthesizeStep` instead of a single `ChatModelPort`. The container must instantiate the new constructor signature.
- **09 (ChatAdapterFactory anthropic branch):** Provides the `ChatAdapterFactory.create()` method that returns `AnthropicChatAdapter` when `modelRef.provider === 'anthropic'`, in addition to the existing `OpenAiChatAdapter` branch. The container relies on the factory to resolve all `ChatModelPort` instances by provider type.
- **10 (Anthropic route in server):** Provides the `createServer()` function with the `/v1/messages` Anthropic route already mounted alongside the existing `/v1/chat/completions` and `/v1/models` routes. The container must pass the new ensemble `FusionService` to `createServer()` so both inbound routes call the full ensemble pipeline.

## Traceability
- **Acceptance Criteria:** AC-13 (structured logging wired through all stages), NFR-7 (observability wired end-to-end)
- **NFRs:** NFR-1 (no upward imports — the container must import only from infrastructure adapters, application, and domain, never from SDKs directly), NFR-3 (SDK confinement through ChatAdapterFactory — the container must never import `openai` or `@anthropic-ai/sdk`)
- **Replan Gate Criteria:** Phase 5 Gate 1 (structured log lines per stage emitted), Phase 5 Gate 2 (npm test passes with full wiring)

## Source Traceability
- **Goals:** AC-13, NFR-7
- **Plan:** Task 11, Phase 5 — Polish (Wiring, Tests, Documentation)
- **Design:** Slice 6 (Observability, Tests, and Documentation)
- **Structure:** Slice 6 — `src/infrastructure/di/container.ts` (MODIFY), `src/infrastructure/di/container.test.ts` (MODIFY)

## Description

Replace the single-`ChatModelPort` passthrough wiring in `container.ts` with full ensemble wiring. The container is the composition root: it creates all infrastructure adapters, instantiates application use-case services, and wires them together following the hexagonal dependency rule. This task retires the passthrough architecture and activates the full ensemble pipeline across both inbound routes.

### What must change in container.ts

The current `createApp()` function creates a single `ChatModelPort` from the synthesizer model and passes it to the old `RunFusionUseCase(chatModelPort, configPort, loggerPort, clockPort)` constructor. Replace this with ensemble wiring:

1. **Create `ChatAdapterFactory` once.** The factory is shared across all panel, judge, and synthesizer port creation. The container must never import `openai` or `@anthropic-ai/sdk` directly — all adapter construction goes through the factory.

2. **Create panel ports and `PanelRunner`.**
   - Call `configPort.getPanelModels()` to get the array of `ModelRef` entries (may be empty, must be handled gracefully).
   - Map each `ModelRef` through `factory.create(modelRef)` to produce a `ChatModelPort[]`.
   - Instantiate `PanelRunner` with the ports array, `loggerPort`, and `clockPort`.
   - `PanelRunner` pairs each port with its corresponding `ModelRef` by array index.

3. **Create judge port and `JudgeStep`.**
   - Call `configPort.getJudgeModel()`. Two paths:
     - **Judge model present:** Create a `ChatModelPort` via `factory.create(judgeModel)` and pass it to `JudgeStep`.
     - **Judge model absent (null):** Create a **no-op `ChatModelPort` stub** that immediately returns. The stub must satisfy the full `ChatModelPort` interface:
       - `complete()`: Resolves immediately with a minimal `ChatResponse` — `{ content: '{}', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'noop' }`. This produces `{}` JSON, which will fail `analysisSchema.safeParse()` inside `JudgeStep`, triggering graceful degradation (analysis omitted, synthesis falls back to raw panel results). The stub must not make any network calls.
       - `stream()`: Returns an empty `AsyncIterable<ChatStreamChunk>` that completes immediately. (Though `JudgeStep` only calls `complete()`, the stub must satisfy the full interface to pass type-checking.)
     - Instantiate `JudgeStep` with the resolved port (real or stub), `loggerPort`, and `clockPort`.

4. **Create synthesizer port and `SynthesizeStep`.**
   - Call `configPort.getSynthesizerModel()` (guaranteed non-null by `JsonFileConfigAdapter` validation).
   - Create a `ChatModelPort` via `factory.create(synthModel)`.
   - Instantiate `SynthesizeStep` with the synthesizer port, `loggerPort`, and `clockPort`.

5. **Instantiate the new `RunFusionUseCase`.** The constructor after Task 06 accepts `(panelRunner, judgeStep, synthesizeStep, configPort, loggerPort, clockPort)`. Do not pass a raw `ChatModelPort` — that belongs to the retired passthrough signature.

6. **Pass the ensemble `FusionService` to `createServer()`.** The `createServer()` function already mounts both `/v1/chat/completions` (OpenAI) and `/v1/messages` (Anthropic) routes. Both routes call `fusionService.runFusion()`, so the ensemble pipeline serves both inbound APIs.

7. **Return the same shape.** The `createApp()` return type `{ app: Hono; configPort: ConfigPort; fusionService: FusionService }` must remain unchanged.

### Import and dependency rules

- The container may import from `src/infrastructure/`, `src/application/`, and `src/domain/`.
- The container must NOT import `openai`, `@anthropic-ai/sdk`, or `hono` (except the `Hono` type for the return type).
- The container must NOT reach into domain internals beyond the port interfaces and model types needed for wiring.

### No-op ChatModelPort stub

Define the stub inline within `container.ts` or in a private helper. It must implement `ChatModelPort` exactly:

```typescript
const noopChatModelPort: ChatModelPort = {
  async complete(_request: ChatRequest): Promise<ChatResponse> {
    return {
      content: '{}',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'noop',
    };
  },
  async *stream(_request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    // empty — no chunks yielded
  },
};
```

The stub's `complete()` resolves synchronously (wrapped in async); it must not block the event loop. The returned `content: '{}'` ensures `JudgeStep` will attempt `JSON.parse('{}')` → `safeParse({})` → validation failure → `analyze()` returns `null` (graceful degradation path). The `stream()` method yields nothing because `JudgeStep` only calls `complete()` — but implementing `stream()` is required for interface compliance.

## Files
- `src/infrastructure/di/container.ts` (MODIFY) — Replace the single-`ChatModelPort` passthrough wiring with full ensemble wiring: create `ChatAdapterFactory` once, map panel models through factory to `PanelRunner`, resolve judge model (or no-op stub) for `JudgeStep`, map synthesizer model for `SynthesizeStep`, instantiate the new `RunFusionUseCase` constructor, and pass the ensemble `FusionService` to `createServer()`.
- `src/infrastructure/di/container.test.ts` (MODIFY) — Add ensemble-specific tests; retain and update existing tests so they continue to pass with the new wiring. Add tests for: config with `anthropic` providers resolves without throwing, ensemble wiring does not throw for all-roles config (panel + judge + synthesizer), ensemble wiring does not throw when judge is absent (graceful degradation path), factory correctly routes `openai` and `anthropic` `ModelRef` instances, config with only panel and synthesizer (no judge) resolves successfully.

## Test Expectations
- **Ensemble wiring does not throw with all roles:** When the config has at least one panel provider, a judge provider, and a synthesizer provider (all with valid env vars), `createApp()` returns an app, configPort, and fusionService without throwing.
- **Ensemble wiring does not throw when judge is absent:** When the config has panel and synthesizer providers only (no `role: 'judge'` entry), `createApp()` returns successfully. The `configPort.getJudgeModel()` returns `null`, the no-op stub is used, and `JudgeStep` is instantiated without error.
- **Anthropic providers resolve without throwing:** When the config includes a provider with `type: 'anthropic'` (in any role: panel, judge, or synthesizer), `createApp()` resolves successfully. The `ChatAdapterFactory` creates the appropriate adapter without leaking Anthropic-specific types.
- **Factory routes openai and anthropic correctly:** The container's `ChatAdapterFactory` creates an `OpenAiChatAdapter` when `modelRef.provider === 'openai'` and an `AnthropicChatAdapter` when `modelRef.provider === 'anthropic'`. Both adapter instances satisfy `ChatModelPort` and are accepted by `PanelRunner`, `JudgeStep`, and `SynthesizeStep` constructors.
- **Panel array paths exercised:** Config with 0 panel models, config with 1 panel model, and config with multiple panel models all resolve without throwing. The `PanelRunner` receives the correctly sized `ChatModelPort[]`.
- **Synthesizer required guard preserved:** The existing test `createApp throws on missing synthesizer` must continue to pass — when no provider has `role: 'synthesizer'`, `JsonFileConfigAdapter` throws before the container proceeds to ensemble wiring.
- **Existing tests continue to pass:** All pre-existing tests in `container.test.ts` (`createApp returns a Hono app that can handle requests`, `createApp returns configPort and fusionService`, `createApp throws on missing config file`, `createApp throws on missing env var`, `createApp uses FUSION_CONFIG_PATH env var to resolve config`) must pass unmodified or be updated only to match the new config shape while exercising the same contract.
- **Config with all three roles validates ensemble wiring shape:** When a config specifies panel, judge, and synthesizer providers, the returned `fusionService` implements `FusionService` (has `runFusion` method), and the `configPort` correctly returns the expected `ModelRef` values for `getPanelModels()`, `getJudgeModel()`, and `getSynthesizerModel()`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.

## Review Status
- **State:** clean (round 3)
- **Outstanding Concerns:** None.
