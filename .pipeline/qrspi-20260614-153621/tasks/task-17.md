# Task 17: Application-layer unit tests

## Metadata
- **Task:** 17
- **Phase:** 5
- **Route:** full
- **Slice:** Observability, Tests, and Documentation

## Dependencies
- **16** — Provides `vitest.config.ts` at the project root (globals: true, include: `['src/**/*.spec.ts']`, environment: node) so the spec files written by this task are discoverable and executable. Also establishes the vitest stub pattern: `vi.fn()` with `.mockResolvedValue()` / `.mockRejectedValue()` for async port stubs, and `import { describe, it, expect, vi, beforeEach } from 'vitest'` convention. The domain-layer tests from Task 16 have validated the domain model types (`FusionError`, `Analysis`, `PanelResponse`, `FailedModelInfo`, `FusionRequest`, `FusionStreamEvent`, `ModelRef`, `ChatRequest`, `ChatResponse`, `TokenUsage`, `Message`, `ChatStreamEvent`) that application tests import for stub construction.

## Traceability
- **Acceptance Criteria:** AC-14 (application tests with stubbed ports)
- **NFRs:** NFR-1
- **Replan Gate Criteria:** Phase 5 Gate 2 (application test coverage with ≥80% branch coverage target)

## Source Traceability
- **Goals:** AC-14 — Application-layer unit tests exercise RunFusionUseCase, PanelRunner, JudgeStep, and SynthesizeStep with stubbed ChatModelPort and ConfigPort
- **Plan:** Task 17, Phase 5 — Polish
- **Design:** Slice 6 — Observability, Tests, and Documentation; test table at row "Slice 6" specifies: application tests for RunFusionUseCase (stubbed ports orchestrates full pipeline), PanelRunner edge cases (0 models, all fail, all succeed), JudgeStep handles both complete() resolve and reject, SynthesizeStep prompt includes panel and analysis content
- **Structure:** Slice 6 — Observability, Tests, and Documentation; files `src/application/usecases/__tests__/panel-runner.spec.ts`, `src/application/usecases/__tests__/judge-step.spec.ts`, `src/application/usecases/__tests__/synthesize-step.spec.ts`, `src/application/usecases/__tests__/run-fusion-use-case.spec.ts`

## Description

Write four application-layer unit test files in `src/application/usecases/__tests__/` using vitest with stubbed port interfaces. All tests instantiate the real application classes (`PanelRunner`, `JudgeStep`, `SynthesizeStep`, `RunFusionUseCase`) with stubbed dependencies — no infrastructure or SDK code is loaded. Stubs are plain objects whose methods are `vi.fn()` configured with `.mockResolvedValue()` or `.mockRejectedValue()`. Tests verify behavior from the perspective of a caller: what is returned, what is thrown, what side effects (logger calls) occur.

Each test file must import only from the class under test (`src/application/usecases/`) and the domain types (`src/domain/model/`, `src/domain/ports/`, `src/domain/services/`). Zero imports from `src/infrastructure/` or any npm package beyond `vitest` and `typescript`.

All test files use ESM import paths with `.js` extensions for source-code imports (e.g., `import { PanelRunner } from '../panel-runner.js'`). Vitest is imported bare: `import { describe, it, expect, vi, beforeEach } from 'vitest'`.

---

### 1. `src/application/usecases/__tests__/panel-runner.spec.ts` (CREATE)

Tests `PanelRunner` (`src/application/usecases/panel-runner.ts`) in isolation by injecting stubbed `ChatModelPort`, `LoggerPort`, and `ClockPort`.

**Setup pattern**: In `beforeEach`, create stub objects:

- `chatModelPort`: `{ complete: vi.fn() }` — configure per-test via `.mockResolvedValue()` or `.mockRejectedValue()`.
- `loggerPort`: `{ logStageStart: vi.fn(), logStageEnd: vi.fn(), logFailedModels: vi.fn(), logError: vi.fn() }`.
- `clockPort`: `{ now: vi.fn() }` — returns sequential millisecond values to test latency measurement.

Instantiate `new PanelRunner(chatModelPort, loggerPort, clockPort)`. Build a minimal `FusionRequest`: `{ messages: [{ role: 'user', content: 'hello' }] }`. Build sample `ModelRef` objects (at least two, with distinct `model` strings) as the `panelModels` argument.

**Test cases**:

1. **All panel models fulfill**: When `chatModelPort.complete()` resolves for every panel model (each returning a `ChatResponse` with distinct `content` and valid `usage`), and `PanelRunner.run(request, panelModels)` is awaited, the returned object has `responses` array of length equal to the model count, each entry is a `PanelResponse` with `model`, `content`, `usage`, and `latencyMs` (all defined). The `failedModels` array is empty.

2. **Partial failure — one reject, two fulfill**: When three panel models are configured and `chatModelPort.complete()` resolves for the first and third but rejects with `new Error('timeout')` for the second, the returned object has `responses` array of length 2 and `failedModels` array of length 1. The failed entry has `modelId` matching the second model's `model` string, `errorCode` of `'Error'`, and `errorMessage` of `'timeout'`.

3. **All panel models fail — throws FusionError**: When every `chatModelPort.complete()` call rejects, the promise returned by `run()` rejects with a `FusionError`. The error is an instance of `Error`, has `name === 'FusionError'`, `code === 'all_panels_failed'`, `message === 'Every panel model failed'`, and `details.failedModels` is an array with one `FailedModelInfo` entry per model (all containing `modelId`, `errorCode`, and `errorMessage` strings).

4. **Empty panelModels — throws immediately**: When `panelModels` is an empty array `[]`, the method throws `new FusionError('all_panels_failed', 'No panel models configured')` synchronously (before any `complete()` call). Verify that `chatModelPort.complete` is never called.

5. **Per-model latency measurement**: When the stubbed `ClockPort.now()` returns `100`, then `250` for the first model's `complete()` window, the returned `PanelResponse` for that model has `latencyMs === 150`. Verify by using `vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(250)` on `clockPort.now`.

6. **Stage lifecycle logging on full success**: When all models fulfill, `loggerPort.logStageStart('panel')` is called exactly once before any `complete()` call, and `loggerPort.logStageEnd('panel', <durationMs>, <aggregateUsage>)` is called exactly once after all `complete()` calls settle. The `durationMs` equals the difference between the two outermost `clockPort.now()` readings. `logFailedModels` is never called on full success.

7. **Stage lifecycle logging on total failure**: When all models reject, `loggerPort.logStageStart('panel')` is still called exactly once, but `logStageEnd` is never called (the method throws before reaching that step). `logFailedModels` is called once with the full array of `FailedModelInfo` entries before the `FusionError` is thrown.

8. **Failed models logging on partial failure**: When at least one model rejects and at least one fulfills, `loggerPort.logFailedModels()` is called exactly once with a non-empty array of `FailedModelInfo` objects. The call occurs before `logStageEnd`.

9. **Aggregate token usage**: When two models fulfill with usages `{ promptTokens: 10, completionTokens: 5, totalTokens: 15 }` and `{ promptTokens: 5, completionTokens: 3, totalTokens: 8 }`, the `TokenUsage` passed to `logStageEnd` has `promptTokens: 15`, `completionTokens: 8`, `totalTokens: 23`. Responses with `undefined` usage contribute 0 to each sum.

10. **Parallel execution**: All `complete()` calls are initiated before any settles — `vi.fn()` call assertions confirm `chatModelPort.complete` was called once per panel model, and all calls were made before awaiting results.

---

### 2. `src/application/usecases/__tests__/judge-step.spec.ts` (CREATE)

Tests `JudgeStep` (`src/application/usecases/judge-step.ts`) in isolation by injecting stubbed `ChatModelPort`, a judge `ModelRef`, and `LoggerPort`.

**Setup pattern**: In `beforeEach`:

- `chatModelPort`: `{ complete: vi.fn() }`.
- `loggerPort`: `{ logStageStart: vi.fn(), logStageEnd: vi.fn(), logFailedModels: vi.fn(), logError: vi.fn() }`.
- `judgeModel`: A `ModelRef` with `{ provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' }`.
- Instantiate `new JudgeStep(chatModelPort, judgeModel, loggerPort)`.
- Build sample `PanelResponse[]` (at least two entries) with distinct `model`, `content`, `usage`, and `latencyMs`.

**Test cases**:

1. **Valid JSON response parses to Analysis**: When `chatModelPort.complete()` resolves with a `ChatResponse` whose `content` is a valid JSON string matching the `Analysis` schema (including all required fields: `consensus`, `contradictions`, `uniqueInsights`, `blindSpots`), `analyze(panelResponses)` resolves to an `Analysis` object. The object has `consensus` as a string, `contradictions` as an array, `uniqueInsights` as an array, and `blindSpots` as an array of strings. `loggerPort.logError` is never called.

2. **Invalid JSON response returns null and logs error**: When `chatModelPort.complete()` resolves with `content: 'not valid json'`, `analyze()` resolves to `null`. `loggerPort.logError('judge', <Error>)` is called exactly once with an `Error` whose message contains `'Schema validation failed'` (the `safeParseAnalysis` failure message). The method does not throw.

3. **Schema mismatch — missing required field**: When `chatModelPort.complete()` resolves with valid JSON `'{"contradictions": [], "uniqueInsights": [], "blindSpots": []}'` (missing the required `consensus` field), `analyze()` resolves to `null`. `loggerPort.logError('judge', <Error>)` is called exactly once with an error whose message includes the schema validation error text. The method does not throw.

4. **complete() rejects — returns null and logs error**: When `chatModelPort.complete()` rejects with `new Error('judge unreachable')`, `analyze()` resolves to `null`. `loggerPort.logError('judge', <Error>)` is called exactly once with the rejection error. The method does not throw.

5. **Non-Error rejection reason**: When `chatModelPort.complete()` rejects with a plain string `'timeout'`, `analyze()` resolves to `null` and `loggerPort.logError('judge', <Error>)` is called with an `Error` whose message is `'timeout'`.

6. **Never throws**: Regardless of the failure mode (invalid JSON, schema mismatch, complete() rejection, any unexpected runtime condition), `analyze()` always resolves and never rejects. The resolution value is always `Analysis | null`.

7. **Prompt construction and request shape**: The `ChatRequest` passed to `chatModelPort.complete()` has `messages` with exactly two entries: a system message (with content from `buildJudgePrompt().systemPrompt`) and a user message (with content from `buildJudgePrompt().userPrompt`). The `options.responseFormat` is `{ type: 'json_object' }`. The `model` field equals the injected `judgeModel`.

8. **Accepts empty panel responses array**: When `panelResponses` is an empty array `[]`, `analyze()` still calls `buildJudgePrompt([])` and `complete()`. If the judge returns valid Analysis JSON (even if content is vacuous), the result is an `Analysis` object. This validates there is no crash or early return for empty inputs.

---

### 3. `src/application/usecases/__tests__/synthesize-step.spec.ts` (CREATE)

Tests `SynthesizeStep` (`src/application/usecases/synthesize-step.ts`) in isolation by injecting stubbed `ChatModelPort` and a synthesizer `ModelRef`.

**Setup pattern**: In `beforeEach`:

- `chatModelPort`: `{ complete: vi.fn(), stream: vi.fn() }` — `stream()` is the streaming method used by the final implementation. Return an `AsyncIterable<ChatStreamEvent>` by using an `async function*` generator.
- `synthesizerModel`: A `ModelRef` with provider/model/baseURL/apiKey.
- Instantiate `new SynthesizeStep(chatModelPort, synthesizerModel)`.
- Build a minimal `FusionRequest`: `{ messages: [{ role: 'user', content: 'hello' }] }`.
- Build sample `PanelResponse[]` (at least two entries).
- Build a sample `Analysis` object (with `consensus`, `contradictions`, `uniqueInsights`, `blindSpots`).

**Test cases**:

1. **Stream yields tokens — accumulate content**: When `chatModelPort.stream()` is implemented as an async generator that yields `{ type: 'token', text: 'The' }`, then `{ type: 'token', text: ' answer' }`, then `{ type: 'done', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } }`, calling `synthesize(request, panelResponses)` and collecting all yielded `ChatStreamEvent` values produces events including the token texts `'The'` and `' answer'` (or the method's return value includes those strings).

2. **Content references panel outputs**: Verify that `buildSynthesisPrompt` is called with the exact `panelResponses` array passed to `synthesize()`. The returned/synthesized content comes from the model's stream output; the test verifies the prompt was built from the provided panel responses by checking that the `ChatRequest` passed to `stream()` contains a user message whose string includes content from each `PanelResponse.content` entry.

3. **With Analysis available, prompt includes analysis fields**: When `synthesize(request, panelResponses, analysis)` is called with a non-undefined `Analysis` object, the `ChatRequest` passed to `chatModelPort.stream()` has a user message whose string includes text from the Analysis fields (`consensus`, at least one contradiction description, at least one insight). This verifies that `buildSynthesisPrompt(panelResponses, analysis)` is called with the analysis argument rather than the two-argument overload.

4. **Without Analysis, prompt excludes analysis fields**: When `synthesize(request, panelResponses)` is called with only two arguments (or `analysis` explicitly `undefined`), `buildSynthesisPrompt` is called without the analysis argument. The user message content in the `ChatRequest` does not contain Analysis-specific field names like `'consensus'` or `'uniqueInsights'`.

5. **System prompt prepended when present**: When `request.systemPrompt` is `'Be concise'`, the `ChatRequest.messages` array passed to `stream()` starts with `{ role: 'system', content: 'Be concise' }` followed by the user message containing the synthesis prompt.

6. **No system prompt when absent**: When `request.systemPrompt` is `undefined` or an empty string, the `ChatRequest.messages` array contains only the user message with the synthesis prompt.

7. **Empty stream content handled gracefully**: When `chatModelPort.stream()` yields only `{ type: 'done' }` with no token events, `synthesize()` completes without throwing and returns either an empty accumulated content or no token events.

8. **Error propagation from stream()**: When `chatModelPort.stream()` throws an error (e.g., the async generator throws `new Error('upstream failure')` during iteration), `synthesize()` propagates that error — the promise returned by `synthesize()` rejects with the same error. No try/catch suppresses it inside SynthesizeStep.

9. **Temperature and maxTokens passed through**: When `request.temperature` is `0.7` and `request.maxTokens` is `500`, the `ChatRequest.options` passed to `stream()` includes `temperature: 0.7` and `maxTokens: 500`. When neither is set, `options` either omits those fields or is omitted entirely.

---

### 4. `src/application/usecases/__tests__/run-fusion-use-case.spec.ts` (CREATE)

Tests `RunFusionUseCase` (`src/application/usecases/run-fusion-use-case.ts`) as the orchestrated ensemble pipeline by injecting stubbed `PanelRunner`, `JudgeStep | null`, `SynthesizeStep`, `ConfigPort`, `LoggerPort`, and `ClockPort`.

**Setup pattern**: In `beforeEach`:

- `panelRunner`: Stub with `{ run: vi.fn() }` — `run(request, panelModels)` returns `{ responses, failedModels }`.
- `judgeStep`: Stub with `{ analyze: vi.fn() }` — `analyze(panelResponses)` returns `Analysis | null`.
- `synthesizeStep`: Stub with `{ synthesize: vi.fn() }` — `synthesize(request, panelResponses, analysis?)` returns the final content string (or an `AsyncIterable<ChatStreamEvent>`). Use `mockResolvedValue('synthesized response text')` for non-streaming or `mockImplementation(() => asyncGenerator)` for streaming.
- `configPort`: Stub with `{ getPanelModels: vi.fn(), getJudgeModel: vi.fn(), getSynthesizerModel: vi.fn(), getTimeoutMs: vi.fn() }`. Configure `getPanelModels()` to return a `ModelRef[]`, `getJudgeModel()` to return a `ModelRef` or `null`.
- `loggerPort`: `{ logStageStart: vi.fn(), logStageEnd: vi.fn(), logFailedModels: vi.fn(), logError: vi.fn() }`.
- `clockPort`: `{ now: vi.fn() }` — returning sequential values.
- Build a minimal `FusionRequest`: `{ messages: [{ role: 'user', content: 'test' }] }`.
- Helper function to collect all events from the async iterable: `async function collectEvents(iterable: AsyncIterable<FusionStreamEvent>): Promise<FusionStreamEvent[]>`.

Instantiate `new RunFusionUseCase(panelRunner, judgeStep, synthesizeStep, configPort, loggerPort, clockPort)`.

**Test cases**:

1. **Full pipeline — panel succeeds, judge succeeds**: When `configPort.getPanelModels()` returns two `ModelRef`s, `panelRunner.run()` resolves to `{ responses: [panelResp1, panelResp2], failedModels: [] }`, `judgeStep.analyze()` resolves to a valid `Analysis` object, and `synthesizeStep.synthesize()` resolves to `'final content'`, iterating `runFusion(request)` yields events in order:
   - `{ type: 'progress', stage: 'panel', message: 'Fanning out to 2 panel model(s)' }`
   - `{ type: 'progress', stage: 'panel', message: 'Panel complete — 2 responded, 0 failed' }`
   - `{ type: 'progress', stage: 'judge', message: 'Analyzing panel responses' }`
    - `{ type: 'progress', stage: 'judge', message: 'Judge analysis complete' }`
    - `{ type: 'content_delta', delta: 'final content' }`
    - `{ type: 'done', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, failedModels: [] }`
   
   `loggerPort.logStageStart` is called three times with `'panel'`, `'judge'`, `'synthesis'` in that order. `logStageEnd` is called three times with corresponding stages. `logFailedModels` is never called.

2. **Panel partial failure — failedModels propagated**: When `panelRunner.run()` resolves with one response and one `FailedModelInfo` entry, the stream yields a progress event indicating `'1 responded, 1 failed'`. The final `done` event has `failedModels` matching the `FailedModelInfo` array from `panelRunner`. `loggerPort.logFailedModels()` is called with that array.

3. **Panel total failure — FusionError propagated**: When `panelRunner.run()` rejects with `new FusionError('all_panels_failed', 'Every panel model failed', { failedModels: [...] })`, iterating the async iterable rejects with that same `FusionError`. No `content_delta` or `done` event is yielded. The error is not caught by the use case and propagates outward.

4. **No panel models configured — throws FusionError**: When `configPort.getPanelModels()` returns an empty array `[]`, iterating the async iterable rejects with `new FusionError('no_panel_models', 'At least one panel model must be configured')`. `panelRunner.run()` is never called.

5. **Judge returns null — degradation message yielded**: When `judgeStep.analyze()` resolves to `null`, the stream yields a progress event with `message: 'Judge skipped — continuing with panel responses only'` instead of `'Judge analysis complete'`. `synthesizeStep.synthesize()` is called with `analysis` as `undefined`. The pipeline is not aborted.

6. **Judge throws unexpectedly — caught and degraded**: When `judgeStep.analyze()` throws `new Error('unexpected error')`, the use case catches the error, calls `loggerPort.logError('judge', <Error>)` exactly once, yields the judge-skipped progress message, and proceeds to synthesis with `analysis` as `undefined`. The pipeline is not aborted.

7. **No judge model configured — null judgeStep**: When `judgeStep` is `null` (passed to constructor as `null`), the use case skips the judge phase entirely: no judge `progress` events are yielded, no judge `logStageStart`/`logStageEnd` calls are made, `judgeStep.analyze()` is never called, and `synthesizeStep.synthesize()` receives `analysis` as `undefined`.

8. **Synthesis error propagation**: When `synthesizeStep.synthesize()` rejects with an `Error('synthesis failed')`, iterating the async iterable rejects with that error. The error propagates without being caught by the use case (no try/catch around the synthesis step).

9. **Logging lifecycle covers all three stages**: On a successful full run, `loggerPort.logStageStart` and `loggerPort.logStageEnd` are each called exactly three times (panel, judge, synthesis). The duration passed to `logStageEnd` for each stage equals the difference between the two `clockPort.now()` calls that wrap that stage. On panel total failure, only `logStageStart('panel')` is called; no `logStageEnd` calls follow. On judge skip (null judgeStep), only panel and synthesis stages are logged.

10. **done event structure**: The final `done` event has `type: 'done'`, a `failedModels` array (empty when no failures), and optionally a `usage` field when the synthesis step provides usage information.

## Files
- `src/application/usecases/__tests__/panel-runner.spec.ts` (CREATE) — Unit tests for `PanelRunner` with stubbed `ChatModelPort`, `LoggerPort`, and `ClockPort`. Covers: all models fulfill, partial rejection (1 reject + 2 fulfill), all reject throws `FusionError('all_panels_failed')`, empty panelModels throws immediately, per-model latency measurement via `ClockPort`, stage lifecycle logging (`logStageStart`/`logStageEnd`/`logFailedModels`), aggregate token usage summation, and parallel execution ordering.
- `src/application/usecases/__tests__/judge-step.spec.ts` (CREATE) — Unit tests for `JudgeStep` with stubbed `ChatModelPort`, judge `ModelRef`, and `LoggerPort`. Covers: valid JSON parses to `Analysis`, invalid JSON returns `null` and calls `logError`, schema mismatch (missing required field) returns `null` and logs error, `complete()` rejection returns `null` and logs error, non-Error rejection handling, never-throws invariant, correct `ChatRequest` construction with `responseFormat: { type: 'json_object' }`, and empty panel responses input.
- `src/application/usecases/__tests__/synthesize-step.spec.ts` (CREATE) — Unit tests for `SynthesizeStep` with stubbed `ChatModelPort` (including `stream()`) and synthesizer `ModelRef`. Covers: stream token accumulation, panel content references in the synthesis prompt, Analysis fields included in prompt when available, no Analysis when undefined, system prompt prepend behavior, empty stream content handling, temperature/maxTokens passthrough, and error propagation from `stream()`.
- `src/application/usecases/__tests__/run-fusion-use-case.spec.ts` (CREATE) — Unit tests for orchestrated `RunFusionUseCase` with fully stubbed dependencies (`PanelRunner`, `JudgeStep | null`, `SynthesizeStep`, `ConfigPort`, `LoggerPort`, `ClockPort`). Covers: full pipeline event ordering (panel start → panel complete → judge start → judge complete → content_delta(s) → done), panel partial failures with `failedModels` in done event, panel total failure propagation, no panel models error, judge returning null yields degradation message, judge throwing unexpectedly is caught and pipeline continues, null judgeStep skips judge phase entirely, synthesis error propagation, stage lifecycle logging across all phases, and done event structure with usage and failedModels.

## Test Expectations
- **PanelRunner — all fulfill**: When `ChatModelPort.complete()` resolves for every panel model, `PanelRunner.run()` resolves to an object with `responses` array containing one `PanelResponse` per model (each with `model`, `content`, `usage`, `latencyMs`) and `failedModels` is an empty array.
- **PanelRunner — partial failure**: When one of three `complete()` calls rejects with `Error('timeout')`, the returned object has `responses` array of length 2, `failedModels` array of length 1 containing `{ modelId, errorCode: 'Error', errorMessage: 'timeout' }`, and `loggerPort.logFailedModels()` is called with that array.
- **PanelRunner — total failure**: When every `complete()` call rejects, `run()` rejects with a `FusionError` instance whose `code` is `'all_panels_failed'`, `message` is `'Every panel model failed'`, and `details.failedModels` is an array with one `FailedModelInfo` per model. `loggerPort.logStageEnd` is never called on total failure.
- **PanelRunner — empty panelModels**: When `panelModels` is `[]`, `run()` throws `new FusionError('all_panels_failed', 'No panel models configured')` without calling `complete()` at all.
- **PanelRunner — latency measurement**: When `ClockPort.now()` returns `100` then `250` around a `complete()` call, the corresponding `PanelResponse.latencyMs` is `150`.
- **PanelRunner — aggregate usage**: When two models fulfill with usages `{ promptTokens: 10, completionTokens: 5, totalTokens: 15 }` and `{ promptTokens: 5, completionTokens: 3, totalTokens: 8 }`, the `TokenUsage` passed to `logStageEnd` has `promptTokens: 15`, `completionTokens: 8`, `totalTokens: 23`.
- **JudgeStep — valid JSON**: When `complete()` resolves with valid Analysis JSON, `analyze()` resolves to an `Analysis` object with `consensus`, `contradictions`, `uniqueInsights`, and `blindSpots` fields. `loggerPort.logError` is not called.
- **JudgeStep — invalid JSON**: When `complete()` resolves with `content: 'not json'`, `analyze()` resolves to `null` and `loggerPort.logError('judge', <Error>)` is called exactly once with an `Error` whose message contains `'Schema validation failed'`.
- **JudgeStep — schema mismatch**: When `complete()` resolves with valid JSON missing the `consensus` field, `analyze()` resolves to `null` and `loggerPort.logError('judge', <Error>)` is called exactly once.
- **JudgeStep — complete() rejection**: When `complete()` rejects with `Error('unreachable')`, `analyze()` resolves to `null` and `loggerPort.logError('judge', <Error>)` is called exactly once with the rejection error. The method does not throw.
- **JudgeStep — never throws**: For any failure mode (invalid JSON, schema mismatch, complete() rejection, non-Error rejection), `analyze()` always resolves — never rejects. The resolution is always `Analysis | null`.
- **SynthesizeStep — stream tokens**: When `stream()` yields token events `{ type: 'token', text: 'The' }` and `{ type: 'token', text: ' answer' }`, the accumulated/returned content from `synthesize()` includes both strings.
- **SynthesizeStep — panel content in prompt**: When `synthesize(request, panelResponses)` is called, the `ChatRequest` passed to `stream()` contains a user message whose text includes content from each `PanelResponse.content` entry in the array.
- **SynthesizeStep — analysis in prompt**: When `synthesize(request, panelResponses, analysis)` is called with a non-undefined Analysis, the `ChatRequest` user message text includes text from the Analysis's `consensus` field and references contradiction/insight content.
- **SynthesizeStep — system prompt prepend**: When `request.systemPrompt` is `'Be concise'`, the `ChatRequest.messages` array starts with `{ role: 'system', content: 'Be concise' }`. When `systemPrompt` is `undefined` or empty, no system message is prepended.
- **SynthesizeStep — error propagation**: When `stream()` throws `Error('upstream failure')`, `synthesize()` rejects with that same error — no try/catch inside `SynthesizeStep` suppresses it.
- **RunFusionUseCase — full pipeline event order**: For a fully successful run (panel succeeds, judge succeeds, synthesis succeeds), iterating the async iterable yields events in this exact order: `progress(stage:'panel', 'Fanning out...')` → `progress(stage:'panel', 'Panel complete...')` → `progress(stage:'judge', 'Analyzing...')` → `progress(stage:'judge', 'Judge analysis complete')` → `content_delta` (one per token from synthesis stream) → `done`.
- **RunFusionUseCase — partial panel failures in done**: When `panelRunner.run()` resolves with `failedModels` containing one entry, the final `done` event's `failedModels` array contains that same entry, and a progress event reports `'1 responded, 1 failed'`.
- **RunFusionUseCase — panel total failure propagation**: When `panelRunner.run()` rejects with `FusionError('all_panels_failed', ...)`, iterating the async iterable rejects with that same error — no `content_delta` or `done` is yielded.
- **RunFusionUseCase — no panel models**: When `configPort.getPanelModels()` returns `[]`, iterating the async iterable rejects with `FusionError('no_panel_models', ...)` before `panelRunner.run()` is called.
- **RunFusionUseCase — judge returns null**: When `judgeStep.analyze()` resolves to `null`, the judge-complete progress event message is `'Judge skipped — continuing with panel responses only'`, and `synthesizeStep.synthesize()` receives `analysis` as `undefined`.
- **RunFusionUseCase — judge throws**: When `judgeStep.analyze()` throws `Error('unexpected')`, `loggerPort.logError('judge', <Error>)` is called exactly once, the judge-skipped progress event is yielded, and synthesis proceeds with `analysis` as `undefined`. The pipeline is not aborted.
- **RunFusionUseCase — null judgeStep**: When `judgeStep` is `null`, no judge `progress` events are yielded, no `logStageStart('judge')`/`logStageEnd('judge')` are called, `judgeStep.analyze()` is never invoked, and `synthesizeStep.synthesize()` receives `analysis` as `undefined`.
- **RunFusionUseCase — synthesis error propagation**: When `synthesizeStep.synthesize()` rejects, iterating the async iterable rejects with that error — the use case does not catch it.
- **RunFusionUseCase — stage logging**: On a full successful run, `loggerPort.logStageStart` and `loggerPort.logStageEnd` are each called exactly three times for `'panel'`, `'judge'`, and `'synthesis'` in order. On panel total failure, only `logStageStart('panel')` is called and no `logStageEnd` calls follow.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
