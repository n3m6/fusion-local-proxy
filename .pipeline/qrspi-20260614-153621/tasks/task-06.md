# Task 06: RunFusionUseCase ensemble overhaul

## Metadata
- **Task:** 06
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 3 (Judge + Synthesis + Use Case overhaul)

## Dependencies
- **Task 03 (PanelRunner):** `PanelRunner` class with `run(messages, panelModels, timeoutMs): Promise<PanelMeta>` must exist, accepting `ChatModelPort[]` in its constructor.
- **Task 04 (JudgeStep):** `JudgeStep` class with `analyze(panelResults, originalMessages, judgeModel, timeoutMs): Promise<Analysis | null>` must exist, returning `null` on failure for graceful degradation.
- **Task 05 (SynthesizeStep):** `SynthesizeStep` class with `synthesize(panelResults, originalMessages, analysis, synthesizerModel, timeoutMs): AsyncIterable<FusionStreamEvent>` must exist, yielding `content_delta` and `content_stop` events.

## Traceability
- **Acceptance Criteria:** AC-4 (orchestrates full pipeline), AC-9 (end-to-end grounding), AC-12 (timeout passthrough), AC-13 (full stage logging), AC-14 (application tests)
- **NFRs:** NFR-1 (dependency rule), NFR-5 (graceful degradation orchestration), NFR-7 (per-stage logging calls)
- **Replan Gate Criteria:** Phase 2 Gate 1 (ensemble response references panel + judge), Phase 2 Gate 2 (graceful degradation path exercised), Phase 3 Gate 2 (timeout cancellation plumbing)

## Source Traceability
- **Goals:** AC-4, AC-9, AC-12, AC-13, AC-14
- **Plan:** Task 06, Phase 2 — Ensemble Pipeline (Panel + Judge + Synthesis)
- **Design:** Slice 3 — Judge Analysis with Graceful Degradation
- **Structure:** Slice 3 — `src/application/usecases/run-fusion-use-case.ts` (MODIFY), `src/application/usecases/run-fusion-use-case.test.ts` (MODIFY)

## Description

Replace the existing passthrough implementation in `RunFusionUseCase` with full ensemble orchestration. The use case now coordinates `PanelRunner`, `JudgeStep`, and `SynthesizeStep` to execute the complete fan-out → judge → synthesis pipeline, yielding `progress` events between stages and a `done` event with aggregated metadata.

### Constructor change

Replace the existing constructor — which takes a single `ChatModelPort` — with one that accepts the three pipeline steps plus ports:

```typescript
constructor(
  panelRunner: PanelRunner,
  judgeStep: JudgeStep,
  synthesizeStep: SynthesizeStep,
  configPort: ConfigPort,
  loggerPort: LoggerPort,
  clockPort: ClockPort,
)
```

The old constructor signature (`ChatModelPort, ConfigPort, LoggerPort, ClockPort`) is removed entirely.

### `runFusion()` ensemble pipeline

The method orchestrates the following pipeline:

1. **Resolve configuration.** Call `configPort.getPanelModels()` to get the panel model list, `configPort.getJudgeModel()` (nullable), `configPort.getSynthesizerModel()`, and `configPort.getTimeoutMs()`.

2. **Build the messages array.** If `request.systemPrompt` is present, prepend a `{ role: 'system', content: request.systemPrompt }` message. Otherwise use `request.messages` directly. (Identical to the existing passthrough message-building logic.)

3. **Panel stage.** Call `panelRunner.run(messages, panelModels, timeoutMs)`. This returns a `PanelMeta` containing `results: PanelResult[]` and `failedModels: FailedModelInfo[]`. Store the returned `PanelMeta` for later use.

4. **Yield panel progress.** After the panel stage completes, yield a progress event:
   ```
   { type: 'progress', stage: 'panel', message: 'Panel stage complete' }
   ```

5. **Judge stage (conditional).** If `judgeModel` is not `null`:
   - Call `judgeStep.analyze(panelMeta.results, messages, judgeModel, timeoutMs)`. This returns `Analysis | null` (the step handles its own graceful degradation internally).
   - Store the returned `analysis` value.
   - If `judgeModel` is `null`, set `analysis` to `null` without calling `JudgeStep`.

6. **Yield judge progress.** After the judge stage completes (or is skipped), yield a progress event:
   ```
   { type: 'progress', stage: 'judge', message: 'Judge stage complete' }
   ```
   This event is yielded even when the judge stage was skipped (judgeModel was null) to maintain a consistent event sequence.

7. **Synthesis stage.** Call `synthesizeStep.synthesize(panelMeta.results, messages, analysis, synthesizerModel, timeoutMs)`. This returns an `AsyncIterable<FusionStreamEvent>`. Iterate over the synthesis events and re-yield every event (`content_delta`, `content_stop`) immediately to the caller.

8. **Yield done event.** After the synthesis async iterator is exhausted, yield a final event:
   ```
   { type: 'done', failedModels: panelMeta.failedModels }
   ```
   Include `usage` and `model` fields if available from the synthesis stage, but the `failedModels` from the panel stage must always be present.

### Error handling

- **All panels failed.** If `panelRunner.run()` throws a `FusionError` with code `'all_panels_failed'`, the async iterator rejects with that error. No events are yielded, and the judge and synthesis stages are never reached.
- **Judge graceful degradation.** `JudgeStep.analyze()` handles its own failures internally and returns `null` on error or schema validation failure. The use case simply passes the returned `null` analysis to `SynthesizeStep` — no try/catch needed around the judge call.
- **Synthesis errors.** Errors thrown by `synthesizeStep.synthesize()` propagate naturally from the async iterator.

### Timeout passthrough

The `timeoutMs` value from `ConfigPort.getTimeoutMs()` is passed directly to `PanelRunner.run()`, `JudgeStep.analyze()`, and `SynthesizeStep.synthesize()`. Each step is responsible for creating its own `AbortController` from this value. The use case does not create or manage `AbortController` instances.

### Import changes

Remove the import of `ChatModelPort` (no longer a constructor dependency). Remove imports of `ChatRequest` and `ChatResponse` (no longer building chat requests directly). Add imports for `PanelRunner`, `JudgeStep`, and `SynthesizeStep` from their respective sibling modules. Retain imports for `FusionService`, `ConfigPort`, `LoggerPort`, `ClockPort`, `FusionRequest`, `FusionStreamEvent`, and `Message`.

## Files
- `src/application/usecases/run-fusion-use-case.ts` (MODIFY) — Replace the constructor to accept `PanelRunner`, `JudgeStep`, `SynthesizeStep` instead of `ChatModelPort`. Replace the `runFusion()` body with the ensemble pipeline: resolve models from `ConfigPort` → run `PanelRunner` → yield `progress('panel')` → run `JudgeStep` with null guard on `judgeModel` → yield `progress('judge')` → run `SynthesizeStep` and pass through its events → yield `done` with `failedModels`. Remove imports of `ChatModelPort`, `ChatRequest`, `ChatResponse`; add imports for `PanelRunner`, `JudgeStep`, `SynthesizeStep`.
- `src/application/usecases/run-fusion-use-case.test.ts` (MODIFY) — Replace all existing passthrough tests with ensemble pipeline tests. Preserve the `collectEvents` helper, the `stubConfigPort`, `stubLoggerPort`, and `stubClockPort` factories. Remove `stubChatModelPort` and the `StubChatModelPort` interface. Add stub factories for `PanelRunner`, `JudgeStep`, and `SynthesizeStep`. Adapt the constructor shape test and add tests for: full happy path, partial panel failure reported in done event, judge returning null degrades gracefully, synthesize called with correct panel results, progress events emitted, and all-panels-failed error propagation.

## Test Expectations
- **Constructor accepts new dependencies:** When `RunFusionUseCase` is instantiated with stubbed `PanelRunner`, `JudgeStep`, `SynthesizeStep`, `ConfigPort`, `LoggerPort`, and `ClockPort`, the constructor does not throw and the instance satisfies the `FusionService` interface.
- **Full ensemble happy path yields correct event sequence:** When `runFusion()` is called with a `FusionRequest` containing messages, the collected events include a `progress` event with `stage: 'panel'`, a `progress` event with `stage: 'judge'`, all `content_delta` events yielded by the stubbed `SynthesizeStep`, a `content_stop` event, and a final `done` event whose `failedModels` field matches the failed models returned by the stubbed `PanelRunner`.
- **Panel progress event is yielded before judge progress event:** When `runFusion()` executes, the first `progress` event in the stream has `stage: 'panel'` and the second `progress` event has `stage: 'judge'`.
- **SynthesizeStep receives correct panel results:** When the stubbed `PanelRunner` returns specific `PanelResult[]` entries, the stubbed `SynthesizeStep.synthesize()` is called with those same panel results as its first argument.
- **SynthesizeStep receives correct messages:** When `runFusion()` is called with a system prompt, the messages passed to `SynthesizeStep.synthesize()` include the system message prepended to the user messages.
- **SynthesizeStep receives analysis from JudgeStep:** When the stubbed `JudgeStep.analyze()` returns a non-null `Analysis`, the stubbed `SynthesizeStep.synthesize()` is called with that same analysis value as its `analysis` argument.
- **Judge null path skips judge and passes null analysis:** When `ConfigPort.getJudgeModel()` returns `null`, `JudgeStep.analyze()` is never called, a `progress` event with `stage: 'judge'` is still yielded, and `SynthesizeStep.synthesize()` is called with `analysis: null`.
- **JudgeStep returning null degrades gracefully:** When `ConfigPort.getJudgeModel()` returns a model ref and the stubbed `JudgeStep.analyze()` returns `null`, the pipeline continues to `SynthesizeStep` with `analysis: null` and yields content events normally.
- **Partial panel failure reported in done event:** When the stubbed `PanelRunner.run()` returns a `PanelMeta` with non-empty `failedModels`, the final `done` event includes those `failedModels` entries.
- **All-panels-failed error propagates:** When the stubbed `PanelRunner.run()` throws a `FusionError` with code `'all_panels_failed'`, the `runFusion()` async iterator rejects with that same error, and no further events are yielded.
- **Timeout value is passed through to PanelRunner, JudgeStep, and SynthesizeStep:** When `ConfigPort.getTimeoutMs()` returns a specific value, the stubbed `PanelRunner.run()`, `JudgeStep.analyze()`, and `SynthesizeStep.synthesize()` are each called with that value as their `timeoutMs` argument.
- **Empty panel models error handling:** When `ConfigPort.getPanelModels()` returns an empty array, the behavior depends on `PanelRunner.run()` — if it throws `all_panels_failed`, the error propagates; if it returns empty `PanelMeta`, synthesis proceeds with no panel results.
- **Messages from request are not mutated:** When `runFusion()` is called, the original `request.messages` array remains unmodified after the call completes.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.
