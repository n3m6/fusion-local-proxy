# Task 05: SynthesizeStep (non-streamed synthesis)

## Metadata
- **Task:** 05
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 3 (Synthesis)

## Dependencies
- **Task 02 (synthesis-prompt):** Provides `buildSynthesisSystemPrompt()` and `buildSynthesisUserPrompt()` from `src/domain/services/synthesis-prompt.ts`, plus the `Analysis` type from `src/domain/services/analysis-schema.js`.
- **Task 03 (PanelResult type):** Provides the `PanelResult` interface from `src/domain/model/fusion-types.js`.

## Traceability
- **Acceptance Criteria:** AC-9 (partial — synthesis content references panel and analysis elements), AC-14 (partial — application-layer unit test with stubbed ports)
- **NFRs:** NFR-1 (dependency rule — zero infrastructure imports), NFR-5 (accepts null analysis for graceful degradation)
- **Replan Gate Criteria:** Phase 2 Gate 1 (synthesis references panel and analysis), Phase 2 Gate 2 (works without analysis)

## Source Traceability
- **Goals:** AC-9 — SynthesizeStep produces a final response whose content references at least one element from the analysis (when the judge succeeded) and at least one element from the panel outputs, and does not introduce factual claims absent from both sources. AC-14 — application-layer unit test with stubbed ports.
- **Plan:** Task 05, Phase 2 — Ensemble Pipeline (Panel + Judge + Synthesis)
- **Design:** Slice 3 (Judge Analysis with Graceful Degradation) — adds a structured synthesis step between judge and the use-case orchestrator, accepting optional Analysis and falling back to raw panel responses when analysis is unavailable.
- **Structure:** Slice 3 — `src/application/usecases/synthesize-step.ts` (CREATE), `src/application/usecases/synthesize-step.test.ts` (CREATE)

## Description

Create the `SynthesizeStep` application service. This use case produces a final non-streamed synthesis response by calling `ChatModelPort.complete()`. It incorporates panel results and optional judge analysis into the synthesis prompt via the domain-level prompt builders from Task 02. When the analysis is `null` (judge unavailable or failed), it falls back to using only raw panel results.

The non-streamed nature means the entire synthesis text is gathered via a single `complete()` call and then emitted as a single `content_delta` event followed by `content_stop` and `done`. Task 08 will later upgrade this class to use `stream()` for token-by-token streaming.

### Class: `SynthesizeStep`

**Constructor** accepts three ports:

- `chatPort: ChatModelPort` — the outbound port for the synthesizer LLM call.
- `loggerPort: LoggerPort` — for per-stage logging.
- `clockPort: ClockPort` — for wall-clock timing.

**Method: `synthesize()`**

```
async *synthesize(
  panelResults: PanelResult[],
  originalMessages: Message[],
  analysis: Analysis | null,
  synthesizerModel: ModelRef,
  timeoutMs: number,
): AsyncIterable<FusionStreamEvent>
```

### Implementation Steps

1. **Build the synthesis prompts** using domain service functions imported from `src/domain/services/synthesis-prompt.js`:
   - `buildSynthesisSystemPrompt()` returns the system-level instruction string.
   - `buildSynthesisUserPrompt(panelResults, originalMessages, analysis)` returns the user-level prompt string incorporating panel outputs and (when non-null) analysis fields.

2. **Construct the `ChatRequest`:**
   - `messages`: An array of two `Message` objects — a system message (`{ role: 'system', content: systemPrompt }`) followed by a user message (`{ role: 'user', content: userPrompt }`).
   - `model`: The `synthesizerModel` parameter, passed through directly.
   - `options`: An object containing:
     - `signal`: An `AbortSignal` from an `AbortController` that is aborted after `timeoutMs` milliseconds. Create the `AbortController` at the start of `synthesize()`. If `timeoutMs` is finite and positive, call `setTimeout(() => controller.abort(), timeoutMs)`. The controller must be aborted (via `controller.abort()`) in a `finally` block to clean up the timer regardless of success or failure — the timer reference should be cleared on successful completion to avoid leaking.

3. **Log stage start** via `loggerPort.logStageStart('synthesis')` and capture the start timestamp via `clockPort.now()`.

4. **Call `chatPort.complete(chatRequest)`** to get a `ChatResponse`.

5. **Compute duration** (`clockPort.now() - startTime`) and call `loggerPort.logStageEnd('synthesis', durationMs, response.usage)`.

6. **Yield events in order:**
   - `{ type: 'content_delta', delta: response.content }` — the full synthesized text.
   - `{ type: 'content_stop' }` — signals end of content.
   - `{ type: 'done', usage: response.usage, model: synthesizerModel.model }` — completion with token usage and the model identifier.

7. **Error handling:** If `chatPort.complete()` rejects, do not catch the error — let it propagate naturally. The `finally` block must still clean up the `AbortController`. The `logStageEnd` is not called on failure (the caller or orchestrator is responsible for error logging).

### Graceful Degradation Path (null analysis)

When `analysis` is `null`, the method must still produce a complete synthesis. The `buildSynthesisUserPrompt()` function (from Task 02) accepts `Analysis | null` and is expected to produce a prompt grounded solely in panel results when analysis is unavailable. The `SynthesizeStep` itself does not need special branching for this — it always passes `analysis` through to the prompt builder and proceeds identically regardless of its value.

## Files

- `src/application/usecases/synthesize-step.ts` (CREATE) — `SynthesizeStep` class implementing the non-streamed synthesis logic described above. Imports only from `src/domain/` (ports, model types, service prompt builders) and uses zero imports from `src/infrastructure/`.
- `src/application/usecases/synthesize-step.test.ts` (CREATE) — `node:test` suite with `node:assert/strict` covering the behaviors listed in Test Expectations. Uses hand-written stub objects for `ChatModelPort`, `LoggerPort`, and `ClockPort` (following the existing stub patterns in `run-fusion-use-case.test.ts`). No mocking libraries.

## Test Expectations

- **Happy path with analysis:** When `synthesize()` is called with a valid `Analysis` object, the `ChatModelPort` stub receives a `ChatRequest` whose messages include a system prompt (from `buildSynthesisSystemPrompt`) and a user prompt (from `buildSynthesisUserPrompt` with the analysis). The returned async iterable yields exactly three events in order: `content_delta` (with the stub response content), `content_stop`, and `done` (with the stub response usage and model).

- **Happy path with null analysis (fallback):** When `synthesize()` is called with `analysis: null`, the `ChatModelPort` stub still receives a valid `ChatRequest`. The returned async iterable yields the same three-event sequence (`content_delta` → `content_stop` → `done`). The method does not throw or short-circuit.

- **Content grounding (analysis present):** When the `ChatModelPort` stub returns a response whose content embeds analysis field values (e.g., `"consensus: ..."`), the yielded `content_delta.delta` string contains that analysis-referencing text. This verifies that the prompt builder is called and its output is fed to the model.

- **Content grounding (null analysis):** When the `ChatModelPort` stub returns a response whose content embeds panel result values (e.g., `"model X said: ..."`), the yielded `content_delta.delta` string contains panel-referencing text. This verifies the fallback path produces grounded output.

- **Correct event sequence:** Regardless of analysis presence, the async iterable always yields events in the exact order: `content_delta` (exactly one), `content_stop` (exactly one), `done` (exactly one). No other events are yielded.

- **Logger calls:** `logStageStart('synthesis')` is called exactly once before the `complete()` call. `logStageEnd('synthesis', durationMs, usage)` is called exactly once after the `complete()` call succeeds, with `durationMs` equal to the difference between two `clockPort.now()` returns. The `usage` argument matches the `ChatResponse.usage` from the stub.

- **Clock usage:** `clockPort.now()` is called exactly twice in the success path — once at stage start and once after the `complete()` call returns.

- **Error propagation:** When the `ChatModelPort` stub's `complete()` rejects with an error (e.g., `new Error('model unavailable')`), the `synthesize()` async iterator rejects with the same error before yielding any events. The `AbortController` is cleaned up (no timer leak). `logStageEnd` is not called on the failure path.

- **Timeout signal:** When `synthesize()` is called with a finite positive `timeoutMs`, the `ChatRequest.options.signal` passed to `chatPort.complete()` is an `AbortSignal` instance. The `AbortController` is aborted after the timeout elapses (stub the timer or verify the signal is present on the request).

- **Zero imports from infrastructure:** The `synthesize-step.ts` file contains no imports from `src/infrastructure/` — verified by grep or typecheck.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.
