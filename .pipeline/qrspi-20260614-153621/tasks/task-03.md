# Task 03: Panel types and PanelRunner use case

## Metadata
- **Task:** 03
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 2 (Panel Fan-out)

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC-7, AC-14 (partial — application tests for PanelRunner)
- **NFRs:** NFR-1 (dependency rule maintained — zero imports from infrastructure), NFR-5 (graceful degradation — partial failures collected, total failure fatal), NFR-7 (observability — logs failedModels detail)
- **Replan Gate Criteria:** Phase 2 Gate 1 (contributes panel results needed for end-to-end content grounding), Phase 2 Gate 3 (all_panels_failed thrown when every panel model fails)

## Source Traceability
- **Goals:** AC-7, AC-14, NFR-1, NFR-5, NFR-7
- **Plan:** Task 03, Phase 2 — Ensemble Pipeline (Panel + Judge + Synthesis)
- **Design:** Slice 2 — Panel Fan-out + Non-streamed Synthesis
- **Structure:** Slice 2 — `src/domain/model/fusion-types.ts` (MODIFY), `src/application/usecases/panel-runner.ts` (CREATE), `src/application/usecases/panel-runner.test.ts` (CREATE)

## Description

Extend the domain model with `PanelResult` and `PanelMeta` interfaces that capture the outcome of a multi-model fan-out. Create the `PanelRunner` application use case that dispatches parallel calls to N panel models via `Promise.allSettled`, collects both successful results and partial failures, and raises `FusionError('all_panels_failed')` only when every panel model fails.

### Domain type additions (`fusion-types.ts`)

Append two new interfaces to the existing `src/domain/model/fusion-types.ts`:

- **`PanelResult`** — captures the result of a single successful panel model call. Fields:
  - `modelId: string` — the model identifier string (e.g. `"gpt-4o"`)
  - `provider: ProviderType` — `'openai'` or `'anthropic'`
  - `content: string` — the raw text response from the model
  - `usage: { promptTokens: number; completionTokens: number }` — token counts from the `ChatResponse.usage` map (note: only `promptTokens` and `completionTokens`, not `totalTokens`)
  - `latencyMs: number` — wall-clock duration in milliseconds measured between entering the per-model dispatch and receiving the response

- **`PanelMeta`** — aggregate envelope returned by `PanelRunner.run()`. Fields:
  - `results: PanelResult[]` — results from every panel model that completed successfully (may be empty)
  - `failedModels: FailedModelInfo[]` — failure entries for every panel model that rejected or threw, using the existing `FailedModelInfo` type from `src/domain/model/stream-types.ts` (fields: `modelId`, `errorCode`, `errorMessage`)

Also document the `all_panels_failed` error code convention in a JSDoc comment on the `PanelRunner` class or the `FusionError` class: thrown with code `'all_panels_failed'` when `Promise.allSettled` produces zero fulfilled results.

### PanelRunner (`src/application/usecases/panel-runner.ts`)

Create a new class `PanelRunner` that fans out to N panel models in parallel and aggregates results.

**Constructor** receives:
- `chatPorts: ChatModelPort[]` — one port instance per panel model, paired by array index with the `panelModels` argument to `run()`. Each port may target a different backend (different `baseURL`/`apiKey`), so the DI container creates one adapter per panel model.
- `loggerPort: LoggerPort` — for logging per-panel latency and `failedModels` detail
- `clockPort: ClockPort` — for wall-clock timing of each model call

**Method `async run(messages: Message[], panelModels: ModelRef[], timeoutMs: number): Promise<PanelMeta>`**:

1. **Validate inputs:** If `panelModels.length === 0`, return `{ results: [], failedModels: [] }` immediately (empty input is not a failure).
2. **Build per-model tasks:** For each index `i` in `panelModels`:
   - Build a `ChatRequest` with `{ messages, model: panelModels[i], options: { signal: AbortSignal.timeout(timeoutMs), temperature?: undefined?, maxTokens?: undefined? } }`.
   - Use `AbortSignal.timeout(timeoutMs)` so each model call is subject to the caller's deadline.
3. **Measure latency per model:** Record `clockPort.now()` before invoking `chatPorts[i].complete(chatRequest)`, record `clockPort.now()` again after the promise settles, compute delta.
4. **Dispatch via `Promise.allSettled`:** Await the settlement of all calls.
5. **Classify outcomes:**
   - For each fulfilled promise (`status === 'fulfilled'` with `value: ChatResponse`):
     - Push a `PanelResult` into `results` with `modelId: panelModels[i].model`, `provider: panelModels[i].provider`, `content: value.content`, `usage: { promptTokens: value.usage.promptTokens, completionTokens: value.usage.completionTokens }`, and `latencyMs: delta`.
   - For each rejected promise (`status === 'rejected'` with `reason: unknown`):
     - Extract a `FailedModelInfo` with `modelId: panelModels[i].model`, `errorCode` (the `code` if `reason` is a `FusionError`, otherwise the error constructor name or `'UNKNOWN'`), and `errorMessage` truncated to 200 characters.
     - Push the `FailedModelInfo` into `failedModels`.
6. **Log failures:** If `failedModels.length > 0`, call `this.loggerPort.logFailedModels(failedModels)`.
7. **Raise total failure:** If `results.length === 0` (every panel model failed), throw `new FusionError('all_panels_failed', 'All panel models failed', { failedModels })`.
8. **Log per-panel latency:** Call `this.loggerPort.logStageEnd('panel', deltaForEach, usageForEach)` — log once per successful panel model.
9. **Return** `{ results, failedModels }`.

**Important behaviors:**
- The `run()` method pairs `chatPorts[]` with `panelModels[]` strictly by array index. It does not inspect `modelId`/`provider` to match them — the caller (DI container) is responsible for creating aligned arrays.
- The method must not mutate the input `messages` or `panelModels` arrays.
- Each `ChatRequest` must pass the `AbortSignal` via `options.signal`.
- The `all_panels_failed` FusionError must include a `details` field containing the `failedModels` array for upstream logging.

### PanelRunner tests (`src/application/usecases/panel-runner.test.ts`)

Create a colocated test file using `node:test` and `node:assert/strict`. Write hand-written stubs for `ChatModelPort`, `LoggerPort`, and `ClockPort` following the existing codebase conventions (stubs with `_calls` / `_lastRequest` tracking, `stubClockPort(times: number[])` helper, etc.).

Tests must cover:
- **All-success:** 3 panel models, all `complete()` calls resolve. `PanelMeta.results` has 3 entries, `failedModels` is empty, no FusionError thrown. Each `PanelResult` has correct `modelId`, `provider`, `content`, `usage`, and `latencyMs`.
- **Partial-failure:** 3 panel models, 2 resolve, 1 rejects. `PanelMeta.results` has 2 entries, `failedModels` has 1 entry with `modelId`, `errorCode`, and a truncated `errorMessage`. `loggerPort.logFailedModels()` is called once with the `failedModels` array. No FusionError thrown.
- **All-failure (all_panels_failed):** 2 panel models, both reject. A `FusionError` is thrown with `code === 'all_panels_failed'` and `details.failedModels` containing both failure entries. `loggerPort.logFailedModels()` is called.
- **Empty panel models:** `panelModels: []` is passed. Returns `{ results: [], failedModels: [] }`. No calls to `chatPort.complete()`, no FusionError thrown.
- **AbortSignal passthrough:** Verifies that the `ChatRequest` passed to a stubbed `chatPort` includes `options.signal` set to an `AbortSignal` (by checking `signal instanceof AbortSignal` on the captured request).
- **Latency measurement:** Uses `stubClockPort` to assert that each `PanelResult.latencyMs` equals the difference between the clock readings for that model's dispatch.
- **FailedModelInfo extraction from FusionError:** A panel model that rejects with `new FusionError('timeout', 'timed out')` produces a `FailedModelInfo` with `errorCode: 'timeout'`.
- **FailedModelInfo extraction from generic Error:** A panel model that rejects with `new Error('connection refused')` produces a `FailedModelInfo` with `errorCode: 'Error'` and `errorMessage` truncated to ≤200 characters.
- **loggerPort.logStageEnd called per successful model:** Each successful panel call produces one `logStageEnd('panel', ...)` call with the correct duration and usage.

## Files
- `src/domain/model/fusion-types.ts` (MODIFY) — Append `PanelResult` interface (`modelId`, `provider`, `content`, `usage: { promptTokens, completionTokens }`, `latencyMs`) and `PanelMeta` interface (`results: PanelResult[]`, `failedModels: FailedModelInfo[]`). Import `FailedModelInfo` from `stream-types.js`. Document `all_panels_failed` error code convention on the `FusionError` class via JSDoc.
- `src/application/usecases/panel-runner.ts` (CREATE) — `PanelRunner` class with constructor `(chatPorts: ChatModelPort[], loggerPort: LoggerPort, clockPort: ClockPort)` and async method `run(messages: Message[], panelModels: ModelRef[], timeoutMs: number): Promise<PanelMeta>`. Fans out to N panel models via `Promise.allSettled`, builds `PanelMeta` with results and failedModels, throws `FusionError('all_panels_failed')` when results array is empty, logs per-panel latency and failedModels via LoggerPort.
- `src/application/usecases/panel-runner.test.ts` (CREATE) — `node:test` suite with hand-written stubs for `ChatModelPort`, `LoggerPort`, `ClockPort`. Covers: all-success, partial-failure, all-failure (`all_panels_failed` error), empty-panels edge case, AbortSignal passthrough, latency measurement, FailedModelInfo extraction from FusionError and generic Error, and logger calls.

## Test Expectations
- **All-success:** When 3 panel models all resolve, expect `PanelMeta.results` to contain 3 `PanelResult` entries — one per model, each with `modelId`, `provider`, `content`, `usage` (promptTokens + completionTokens), and `latencyMs > 0`. Expect `failedModels` to be an empty array.
- **Partial-failure:** When 2 of 3 panel models resolve and 1 rejects, expect `PanelMeta.results` to have 2 entries and `failedModels` to have 1 entry. Expect `loggerPort.logFailedModels` to be called once with the 1-entry array. Expect no exception thrown.
- **All-failure:** When all panel models reject, expect a `FusionError` to be thrown with `error.code === 'all_panels_failed'` and `error.details.failedModels` containing every failure entry. Expect `loggerPort.logFailedModels` to be called.
- **Empty panels:** When `panelModels` is an empty array, expect `run()` to return `{ results: [], failedModels: [] }` without calling any port method and without throwing.
- **AbortSignal passthrough:** When a stubbed `ChatModelPort` captures the `ChatRequest`, expect `request.options.signal` to be an instance of `AbortSignal`.
- **Latency measurement:** When a stubbed `ClockPort` returns `[100, 250]` for a single model call, expect the resulting `PanelResult.latencyMs` to equal 150.
- **FailedModelInfo from FusionError:** When a panel model rejects with `new FusionError('timeout', 'timed out')`, expect the `FailedModelInfo` to have `errorCode: 'timeout'` and `errorMessage: 'timed out'`.
- **FailedModelInfo from generic Error:** When a panel model rejects with `new Error('abc'.repeat(100))` (a 300-character message), expect `errorMessage` to be truncated to ≤200 characters and `errorCode` to be `'Error'`.
- **Per-model logger call:** When 2 panel models succeed, expect `loggerPort.logStageEnd('panel', ...)` to be called exactly 2 times, each with the correct `stage` name `'panel'`, a positive `durationMs`, and the corresponding `usage` from that model's response.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.
