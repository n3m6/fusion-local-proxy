# Task 08: Ensemble orchestration and config

## Metadata
- **Task:** 08
- **Phase:** 2
- **Route:** full
- **Slice:** Panel Fan-out + Synthesis, Judge Analysis

## Dependencies
- **07** — Provides the three application ensemble services: `PanelRunner` (`src/application/usecases/panel-runner.ts`) with `run(request, panelModels)` returning `{ responses: PanelResponse[]; failedModels: FailedModelInfo[] }` and throwing `FusionError('all_panels_failed')` on total failure; `JudgeStep` (`src/application/usecases/judge-step.ts`) with `analyze(panelResponses)` returning `Promise<Analysis | null>` and logging errors without throwing; `SynthesizeStep` (`src/application/usecases/synthesize-step.ts`) with `synthesize(request, panelResponses, analysis?)` returning `Promise<string>` via `ChatModelPort.complete()`. Also transitively depends on Task 06 which provides the domain types and services consumed by these classes: `PanelResponse`, `PanelResult` from `src/domain/model/panel-types.js`, `Analysis` and `safeParseAnalysis` from `src/domain/services/analysis-schema.js`, `buildSynthesisPrompt` from `src/domain/services/prompt-builders.js`, and `buildJudgePrompt` from `src/domain/services/judge-prompt-builder.js`.

## Traceability
- **Acceptance Criteria:** AC-7, AC-8, AC-9
- **NFRs:** NFR-1, NFR-5
- **Replan Gate Criteria:** Phase 2 Gate 1 (response references panel and judge content), Phase 2 Gate 2 (judge-unreachable graceful degradation verified)

## Source Traceability
- **Goals:** AC-7, AC-8, AC-9
- **Plan:** Task 08, Phase 2 — Ensemble Pipeline
- **Design:** Slice 2 — Panel Fan-out + Non-streamed Synthesis; Slice 3 — Judge Analysis with Graceful Degradation
- **Structure:** Slice 2 — Panel Fan-out + Non-streamed Synthesis; Slice 3 — Judge Analysis with Graceful Degradation; files `src/application/usecases/run-fusion-use-case.ts`, `fusion.config.json`

## Description

Replace the passthrough logic in `RunFusionUseCase` (originally created in Task 03) with full ensemble orchestration that runs the three-stage pipeline: panel fan-out → judge analysis (with graceful degradation) → synthesis. The `FusionService` inbound port remains unchanged; only the use case implementation and config file are modified.

### `RunFusionUseCase` (`src/application/usecases/run-fusion-use-case.ts`) — MODIFY

The class continues to implement `FusionService`, but its `runFusion()` method now orchestrates the three ensemble services instead of calling `ChatModelPort.complete()` directly. The `FusionService` interface at `src/application/ports/fusion-service.ts` is unchanged — it still declares `runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent>`.

#### Constructor

```ts
constructor(
  panelRunner: PanelRunner,
  judgeStep: JudgeStep | null,
  synthesizeStep: SynthesizeStep,
  configPort: ConfigPort,
  loggerPort: LoggerPort,
  clockPort: ClockPort
)
```

- **`panelRunner`**: Required. The `PanelRunner` instance from Task 07, already constructed with its own `ChatModelPort`, `LoggerPort`, and `ClockPort`.
- **`judgeStep`**: Nullable. The `JudgeStep` instance from Task 07 when `ConfigPort.getJudgeModel()` returns a `ModelRef`; `null` when no judge model is configured. The DI container makes this decision at wiring time. A null `judgeStep` means the judge phase is skipped entirely.
- **`synthesizeStep`**: Required. The `SynthesizeStep` instance from Task 07, already constructed with its own `ChatModelPort` and synthesizer `ModelRef`.
- **`configPort`**: Required. Used at runtime to call `getPanelModels()` (the panel model list is resolved each call rather than at construction time so it stays fresh).
- **`loggerPort`**: Required. Used to log per-stage lifecycle and judge failure details.
- **`clockPort`**: Required. Used to measure wall-clock duration for each stage.

The class imports only from `src/domain/` and `src/application/` — zero imports from `src/infrastructure/` or any npm SDK (NFR-1). The three injected services (`PanelRunner`, `JudgeStep`, `SynthesizeStep`) are themselves application-layer classes with zero infrastructure imports (guaranteed by Task 07).

#### `runFusion(request: FusionRequest): AsyncIterable<FusionStreamEvent>`

Implemented as an `async function*` generator with the following phases:

---

**Phase 1 — Panel fan-out**

1. **Resolve panel models**: call `this.configPort.getPanelModels()`. This returns `ModelRef[]`. If the array is empty, throw `new FusionError('no_panel_models', 'At least one panel model must be configured')`.

2. **Yield panel-start progress event**:
   ```ts
   yield { type: 'progress' as const, stage: 'panel', message: `Fanning out to ${panelModels.length} panel model(s)` };
   ```

3. **Log panel stage start and capture start time**:
   ```ts
   this.loggerPort.logStageStart('panel');
   const panelStartTime = this.clockPort.now();
   ```

4. **Run the panel**: call `await this.panelRunner.run(request, panelModels)`. This returns `{ responses: PanelResponse[]; failedModels: FailedModelInfo[] }`. If `PanelRunner` detects that every panel model failed, it throws `FusionError('all_panels_failed')` — the use case does not catch this; it propagates naturally out of the generator and terminates the stream.

5. **Log panel stage end and compute duration**:
   ```ts
   const panelDurationMs = this.clockPort.now() - panelStartTime;
   this.loggerPort.logStageEnd('panel', panelDurationMs);
   ```

6. **Log any partial failures**: if `failedModels.length > 0`, call `this.loggerPort.logFailedModels(failedModels)`.

7. **Yield panel-complete progress event**:
   ```ts
   yield {
     type: 'progress' as const,
     stage: 'panel',
     message: `Panel complete — ${responses.length} responded, ${failedModels.length} failed`,
   };
   ```

---

**Phase 2 — Judge analysis (with graceful degradation)**

8. **Check judge availability**: if `this.judgeStep` is `null`, skip to Phase 3 with `analysis` set to `undefined`. If `responses` from the panel is empty (should not happen unless every model succeeded but returned empty strings), also skip — analysis needs panel content to be meaningful.

9. **Yield judge-start progress event**:
   ```ts
   yield { type: 'progress' as const, stage: 'judge', message: 'Analyzing panel responses' };
   ```

10. **Log judge stage start and capture start time**:
    ```ts
    this.loggerPort.logStageStart('judge');
    const judgeStartTime = this.clockPort.now();
    ```

11. **Run judge analysis with graceful degradation**:

    The `JudgeStep.analyze()` method from Task 07 internally handles `ChatModelPort` failures and `safeParseAnalysis` failures, returning `Analysis | null` without throwing. However, to guard against unexpected runtime errors in the judge step itself (e.g., a bug, memory issue), wrap in try/catch:

    ```ts
    let analysis: Analysis | undefined = undefined;
    try {
      analysis = (await this.judgeStep.analyze(responses)) ?? undefined;
    } catch (error) {
      this.loggerPort.logError('judge', error instanceof Error ? error : new Error(String(error)));
    }
    ```

    `Analysis | null` is converted to `Analysis | undefined` — this is the value passed to `SynthesizeStep`.

12. **Compute duration and log**:
    ```ts
    const judgeDurationMs = this.clockPort.now() - judgeStartTime;
    this.loggerPort.logStageEnd('judge', judgeDurationMs);
    ```

13. **Yield judge-complete progress event**. If analysis is available, yield a success message. If not, yield a degradation message:

    ```ts
    if (analysis) {
      yield { type: 'progress' as const, stage: 'judge', message: 'Judge analysis complete' };
    } else {
      yield { type: 'progress' as const, stage: 'judge', message: 'Judge skipped — continuing with panel responses only' };
    }
    ```

---

**Phase 3 — Synthesis**

14. **Yield synthesis-start progress event**:
    ```ts
    yield { type: 'progress' as const, stage: 'synthesis', message: 'Synthesizing response' };
    ```

15. **Log synthesis stage start and capture start time**:
    ```ts
    this.loggerPort.logStageStart('synthesis');
    const synthesisStartTime = this.clockPort.now();
    ```

16. **Run synthesis**: call `await this.synthesizeStep.synthesize(request, responses, analysis)`. This returns `Promise<string>` — the synthesized content as a single string (non-streamed in Phase 2; streaming comes in Phase 3).

17. **Compute duration and log**:
    ```ts
    const synthesisDurationMs = this.clockPort.now() - synthesisStartTime;
    this.loggerPort.logStageEnd('synthesis', synthesisDurationMs);
    ```

18. **Yield content event**: yield a single `content_delta` event carrying the full synthesized text:
    ```ts
    yield { type: 'content_delta' as const, delta: synthesisContent };
    ```

19. **Yield done event**: yield a `done` event with `failedModels` from the panel phase so callers can surface partial failures:
    ```ts
    yield { type: 'done' as const, failedModels };
    ```
    The `usage` field on the `done` event is omitted (`undefined`) in this phase because `SynthesizeStep.synthesize()` returns only a `string` — the synthesis usage is not surfaced through the application layer until streaming is added in Phase 3.

---

#### Error propagation

- `FusionError('all_panels_failed')` thrown by `PanelRunner.run()` propagates through the async generator naturally — no catch block in the panel phase.
- Unexpected errors in `SynthesizeStep.synthesize()` also propagate naturally.
- Only the judge phase has a try/catch because its failure must never abort the pipeline (NFR-5).

#### Import restrictions (NFR-1)

The file must only import from `src/domain/` and `src/application/` paths using `*.js` extensions. Specifically:

- `FusionService` from `../ports/fusion-service.js`
- `PanelRunner` from `./panel-runner.js`
- `JudgeStep` from `./judge-step.js`
- `SynthesizeStep` from `./synthesize-step.js`
- `ConfigPort` from `../../domain/ports/config-port.js`
- `LoggerPort` from `../../domain/ports/logger-port.js`
- `ClockPort` from `../../domain/ports/clock-port.js`
- `FusionRequest` from `../../domain/model/fusion-types.js`
- `FusionError` from `../../domain/model/fusion-types.js`
- `FusionStreamEvent` from `../../domain/model/stream-types.js`
- `FailedModelInfo` from `../../domain/model/stream-types.js`
- `PanelResponse` from `../../domain/model/panel-types.js`
- `Analysis` from `../../domain/services/analysis-schema.js`

No imports from `src/infrastructure/`, `openai`, `@anthropic-ai/sdk`, `hono`, `@hono/node-server`, or any npm package beyond TypeScript/Node built-ins.

### `fusion.config.json` (MODIFY)

Expand the existing single-provider config to include entries for all three ensemble roles. The file already has the `providers` array and `timeoutMs` field from Slice 1. This task adds multiple panel entries, one judge entry, and one synthesizer entry.

#### Schema

Each object in the `providers` array has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"openai" \| "anthropic"` | Provider type, used by `ChatAdapterFactory` to select the correct adapter. |
| `role` | `"panel" \| "judge" \| "synthesizer"` | Role the provider serves in the ensemble pipeline. |
| `model` | `string` | Model identifier (e.g., `"gpt-4o"`, `"claude-3-5-sonnet-20241022"`, `"llama3.2"`). |
| `baseURL` | `string` | Base URL for the provider's API endpoint. |
| `apiKeyEnv` | `string` | Environment variable name that holds the API key. |

#### Required entries

The following entries must exist after modification:

1. **At least two panel providers** — `role: "panel"`. These are the models fanned-out to in parallel. At least one entry should use a local provider (e.g., `baseURL: "http://localhost:11434/v1"` for Ollama) and at least one a remote provider, so the config exercises the multi-model fan-out path. Example panel entries:

   ```json
   { "type": "openai", "role": "panel", "model": "gpt-4o", "baseURL": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" },
   { "type": "openai", "role": "panel", "model": "llama3.2", "baseURL": "http://localhost:11434/v1", "apiKeyEnv": "LOCAL_API_KEY" },
   { "type": "openai", "role": "panel", "model": "gpt-4o-mini", "baseURL": "https://openrouter.ai/api/v1", "apiKeyEnv": "OPENROUTER_API_KEY" }
   ```

2. **One judge provider** — `role: "judge"`. This model is called with JSON structured-output via `response_format: { type: "json_object" }` (or the Anthropic equivalent `output_config.format`) to produce the `Analysis`. Example:

   ```json
   { "type": "openai", "role": "judge", "model": "gpt-4o", "baseURL": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" }
   ```

3. **One synthesizer provider** — `role: "synthesizer"`. This model produces the final response by synthesizing panel outputs and (when available) judge analysis. Example:

   ```json
   { "type": "openai", "role": "synthesizer", "model": "gpt-4o", "baseURL": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" }
   ```

The `timeoutMs` field (already present, `30000`) remains unchanged.

#### `ConfigPort` contract (unchanged, for context)

The `ConfigPort` methods (`getPanelModels()`, `getJudgeModel()`, `getSynthesizerModel()`, `getTimeoutMs()`) are already implemented by `JsonFileConfigAdapter` which filters the `providers` array by `role`. The application layer never reads `fusion.config.json` directly — it only uses `ConfigPort` (NFR-6).

- `getPanelModels()` returns all provider entries with `role === "panel"`.
- `getJudgeModel()` returns the first provider entry with `role === "judge"`, or `null` if none configured.
- `getSynthesizerModel()` returns the first provider entry with `role === "synthesizer"`. This is required — if none configured, the adapter should throw at construction time.

## Files
- `src/application/usecases/run-fusion-use-case.ts` (MODIFY) — Replace the passthrough `async function*` implementation with the three-phase ensemble orchestration: resolve panel models from `ConfigPort`, call `PanelRunner.run()` and catch `all_panels_failed` (propagates naturally), yield `progress` events at each phase boundary, call `JudgeStep.analyze()` with try/catch for graceful degradation (null judge or failure → `analysis = undefined`, log via `LoggerPort.logError()`), call `SynthesizeStep.synthesize(request, responses, analysis)` to get the final string, yield `content_delta` with the full text then `done` with `failedModels` from the panel phase. Constructor changes: remove direct `ChatModelPort` dependency, add `PanelRunner`, `JudgeStep | null`, and `SynthesizeStep`.
- `fusion.config.json` (MODIFY) — Expand the `providers` array to include at least two `role: "panel"` entries (mixing local and remote backends), one `role: "judge"` entry, and one `role: "synthesizer"` entry. Each entry retains the existing fields: `type`, `role`, `model`, `baseURL`, `apiKeyEnv`. The `timeoutMs` field remains `30000`.

## Test Expectations
- **Zero infrastructure imports**: Running `grep -r "from 'openai'" src/application/usecases/run-fusion-use-case.ts` and `grep -r "from.*infrastructure" src/application/usecases/run-fusion-use-case.ts` returns no matches. The file imports only from `src/domain/` and sibling `src/application/usecases/` paths.
- **Constructor injection**: `RunFusionUseCase` accepts six arguments: `PanelRunner`, `JudgeStep | null`, `SynthesizeStep`, `ConfigPort`, `LoggerPort`, and `ClockPort`. The `ChatModelPort` is no longer directly injected — it is encapsulated inside the three service instances.
- **Panel phase with successful panel run**: When `configPort.getPanelModels()` returns two `ModelRef`s, `panelRunner.run()` resolves to `{ responses: [panelResponse1, panelResponse2], failedModels: [] }`, and all ports are stubbed, iterating the returned async iterable yields `progress` events for `stage: 'panel'` (both start and complete), calls `loggerPort.logStageStart('panel')` and `loggerPort.logStageEnd('panel', ...)` exactly once each, does NOT call `loggerPort.logFailedModels()`, and the `done` event has `failedModels: []`.
- **Panel phase with partial failures**: When `panelRunner.run()` resolves with one response and one `failedModel` entry, the returned stream yields a `progress` event indicating how many responded vs. failed, calls `loggerPort.logFailedModels()` with the failed models array, and the final `done` event includes `failedModels` matching the `FailedModelInfo` entries.
- **Panel total failure**: When `panelRunner.run()` throws `new FusionError('all_panels_failed', 'All panel models failed')`, iterating the async iterable rejects with that same error. No `content_delta` or `done` event is yielded. This error propagates without being caught by the use case.
- **No panel models configured**: When `configPort.getPanelModels()` returns an empty array, iterating the async iterable rejects with a `FusionError('no_panel_models', ...)`.
- **Judge phase — judge model configured and succeeds**: When `judgeStep` is non-null and `judgeStep.analyze()` resolves to a valid `Analysis` object (with `consensus`, `contradictions`, `uniqueInsights`, `blindSpots`), the stream yields a `progress` event with `stage: 'judge'` and `message: 'Analyzing panel responses'` before the call, and a `progress` event with `message: 'Judge analysis complete'` after the call. `loggerPort.logStageStart('judge')` and `loggerPort.logStageEnd('judge', ...)` are each called exactly once. The `Analysis` object is passed as the third argument to `synthesizeStep.synthesize()`.
- **Judge phase — judge model configured but returns null**: When `judgeStep.analyze()` resolves to `null` (schema validation failure handled internally by `JudgeStep`), the stream yields a `progress` event with `message: 'Judge skipped — continuing with panel responses only'`. `loggerPort.logError()` is NOT called by the use case (logging is handled inside `JudgeStep`). `synthesizeStep.synthesize()` is called with `analysis` as `undefined`.
- **Judge phase — judge model configured but throws unexpectedly**: When `judgeStep.analyze()` throws an `Error('unexpected')`, the use case catches it, calls `loggerPort.logError('judge', error)`, yields the judge-skipped progress message, and proceeds to synthesis with `analysis` as `undefined`. The pipeline is NOT aborted — synthesis still runs.
- **Judge phase — no judge model configured**: When `judgeStep` is `null`, the use case skips the judge phase entirely: no judge `progress` events are yielded, no judge `logStageStart`/`logStageEnd` calls are made, and `synthesizeStep.synthesize()` is called with `analysis` as `undefined`.
- **Synthesis phase**: After panel (and optionally judge) phases complete, the stream yields a `progress` event with `stage: 'synthesis'` and `message: 'Synthesizing response'`, then yields exactly one `content_delta` event whose `delta` equals the string returned by `synthesizeStep.synthesize()`, then yields a `done` event with `failedModels` from the panel phase. `loggerPort.logStageStart('synthesis')` and `loggerPort.logStageEnd('synthesis', ...)` are each called exactly once.
- **Event ordering**: For a fully successful run (panel succeeds, judge succeeds, synthesis succeeds), iterating the stream yields events in this order: `progress(stage: 'panel', 'Fanning out...')` → `progress(stage: 'panel', 'Panel complete...')` → `progress(stage: 'judge', 'Analyzing...')` → `progress(stage: 'judge', 'Judge analysis complete')` → `progress(stage: 'synthesis', 'Synthesizing...')` → `content_delta` → `done`. No event is yielded out of sequence.
- **Config file schema**: After modification, `fusion.config.json` is valid JSON. The `providers` array contains at least four entries: two or more with `role: "panel"`, exactly one with `role: "judge"`, and exactly one with `role: "synthesizer"`. The `timeoutMs` field is present and equals `30000`. Running the existing `JsonFileConfigAdapter` against this file with its zod validation succeeds — `getPanelModels()` returns at least two models, `getJudgeModel()` returns a non-null `ModelRef`, and `getSynthesizerModel()` returns a non-null `ModelRef`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
