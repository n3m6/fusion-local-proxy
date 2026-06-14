# Task 07: Application ensemble services

## Metadata
- **Task:** 07
- **Phase:** 2
- **Route:** full
- **Slice:** Panel Fan-out + Synthesis, Judge Analysis

## Dependencies
- **Task 06** — Provides the domain types and pure services that this task consumes: `PanelResponse`, `PanelResult` (`src/domain/model/panel-types.ts`), `buildSynthesisPrompt` (`src/domain/services/prompt-builders.ts`), `Analysis`, `Contradiction`, `UniqueInsight`, `safeParseAnalysis` (`src/domain/services/analysis-schema.ts`), `buildJudgePrompt` (`src/domain/services/judge-prompt-builder.ts`). Transitively supplies domain model types (`Message`, `ChatRequest`, `ChatResponse`, `ChatOptions`, `ResponseFormat`, `TokenUsage`, `ModelRef`, `ProviderType`, `FusionError`, `FusionRequest`, `FusionStreamEvent`, `FailedModelInfo`) and port interfaces (`ChatModelPort`, `LoggerPort`, `ClockPort`) from Tasks 01–05.

## Traceability
- **Acceptance Criteria:** AC-7 (partial — PanelRunner logic), AC-8 (partial — JudgeStep logic), AC-9 (partial — SynthesizeStep)
- **NFRs:** NFR-1, NFR-5
- **Replan Gate Criteria:** Phase 2 Gate 1 (services ready for orchestration), Phase 2 Gate 2 (JudgeStep returns null on failure)

## Source Traceability
- **Goals:** AC-7 — PanelRunner dispatches parallel calls via Promise.allSettled, collects failed_models, throws FusionError('all_panels_failed') on total failure; AC-8 — JudgeStep calls ChatModelPort.complete() with JSON response_format, parses via safeParseAnalysis, degrades gracefully by returning null on failure; AC-9 — SynthesizeStep produces a final response from panel outputs and optional analysis
- **Plan:** Task 07, Phase 2 — Ensemble Pipeline
- **Design:** Slice 2 — Panel Fan-out + Non-streamed Synthesis, Slice 3 — Judge Analysis with Graceful Degradation
- **Structure:** Slice 2 — Panel Fan-out + Non-streamed Synthesis (`src/application/usecases/panel-runner.ts`, `src/application/usecases/synthesize-step.ts`); Slice 3 — Judge Analysis with Graceful Degradation (`src/application/usecases/judge-step.ts`)

## Description

Implement the three application services that form the ensemble pipeline: `PanelRunner`, `JudgeStep`, and `SynthesizeStep`. Each is a standalone class in `src/application/usecases/` that depends only on domain ports and domain types — zero imports from `src/infrastructure/` or any SDK package (`openai`, `@anthropic-ai/sdk`, `hono`, `zod`). These services are composed together by `RunFusionUseCase` in Task 08; they do not import or call each other.

---

### 1. `PanelRunner` (`src/application/usecases/panel-runner.ts`)

Dispatches `ChatModelPort.complete()` calls to every configured panel model in parallel via `Promise.allSettled`, collects per-model responses and failure details, and throws `FusionError('all_panels_failed')` only when every panel model rejects.

#### Constructor

```typescript
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';

export class PanelRunner {
  constructor(
    private readonly chatModelPort: ChatModelPort,
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort
  ) {}
}
```

Imports from domain ports only — `ChatModelPort`, `LoggerPort`, `ClockPort`. These are injected by the DI container (Task 05 / Task 08). The single `ChatModelPort` is used for all panel calls; the infrastructure layer is responsible for routing each `ChatRequest` (which carries a `ModelRef` with `baseURL` and `apiKey`) to the correct backend. The `PanelRunner` does not need to know how routing works — it only calls `complete()` on the port.

#### `run(request: FusionRequest, panelModels: ModelRef[]): Promise<{ responses: PanelResponse[]; failedModels: FailedModelInfo[] }>`

1. **Handle empty panelModels** — if `panelModels.length === 0`, throw `new FusionError('all_panels_failed', 'No panel models configured')`. An ensemble pipeline with zero panel models is a configuration error and should not silently succeed.

2. **Log stage start and capture overall start time** — `this.loggerPort.logStageStart('panel')` and `const stageStart = this.clockPort.now()`.

3. **Build parallel promises** — for each `ModelRef` in `panelModels`, create a `ChatRequest` and an async wrapper that measures per-model latency:

   For each model, construct a `ChatRequest`:
   - `messages`: shallow-copy `request.messages`. Do not prepend `request.systemPrompt` — the panel is evaluating the exact user request.
   - `model`: the panel `ModelRef`.
   - `options`: include `temperature` if `request.temperature !== undefined`, include `maxTokens` if `request.maxTokens !== undefined`. Omit `options` entirely if neither is set. (No `responseFormat` — panel calls use default text output.) Include `signal` as `undefined` (the `AbortSignal` for timeouts will be wired in Phase 3 by the caller, but the `ChatOptions.signal` field is already declared in the domain type).

   Each per-model wrapper must:
   - Record `const start = this.clockPort.now()`.
   - Call `this.chatModelPort.complete(chatRequest)`.
   - On fulfillment: compute `latencyMs = this.clockPort.now() - start` and return a `PanelResponse`: `{ model: panelModel, content: response.content, usage: response.usage, latencyMs }`. Note: `PanelResponse.latencyMs` is the per-call wall-clock time, measured before and after `complete()` returns.
   - On rejection: extract error info and re-throw as a structured object so `Promise.allSettled` captures it in a rejected result. The rejection reason is the raw `Error` from the port — do not wrap it; `allSettled` will store it in `reason`. After collection, normalize rejected results into `FailedModelInfo`.

   Use `Promise.allSettled` to await all per-model promises concurrently:
   ```typescript
   const settlementResults = await Promise.allSettled(perModelPromises);
   ```

4. **Collect results from settlement** — iterate `settlementResults` and partition into two arrays:

   - **Fulfilled** (`status === 'fulfilled'`): the value is a `PanelResponse` — push into `responses: PanelResponse[]`.
   - **Rejected** (`status === 'rejected'`): the `reason` is the error thrown within the wrapper. Convert to `FailedModelInfo`:
     - `modelId`: the `model` string from the `ModelRef` that failed (you must track which `ModelRef` each promise corresponds to — use `panelModels[i]` index matching).
     - `errorCode`: if `reason` is an `Error`, use `(reason as any).code ?? reason.name ?? 'UNKNOWN'`. If `reason` is a string, use `'REJECTED'`. Otherwise coerce to string and use `'UNKNOWN'`.
     - `errorMessage`: if `reason` is an `Error`, use `reason.message`. If `reason` is a string, use that string. Otherwise use `String(reason)`. Do not truncate at this layer — the `ConsoleLoggerAdapter` (Task 15) handles truncation to ≤200 characters.

   Each `FailedModelInfo` shape: `{ modelId: string; errorCode: string; errorMessage: string }`.

5. **Check for total failure** — after collecting, if `responses.length === 0` (meaning every panel model rejected), throw:
   ```typescript
   throw new FusionError('all_panels_failed', 'Every panel model failed', { failedModels });
   ```
   The third argument (`details`) carries the `failedModels` array so callers can inspect which models failed.

6. **Log failures** — if `failedModels.length > 0`, call `this.loggerPort.logFailedModels(failedModels)` regardless of whether there are also successes. Partial failures are logged; total failure throws before reaching this step.

7. **Compute aggregate usage and stage duration** — aggregate token usage across all `responses`:
   - `promptTokens`: sum of each response's `usage?.promptTokens ?? 0`.
   - `completionTokens`: sum of each response's `usage?.completionTokens ?? 0`.
   - `totalTokens`: sum of each response's `usage?.totalTokens ?? 0`.
   - `const aggregateUsage: TokenUsage = { promptTokens, completionTokens, totalTokens }`.
   - `const stageDurationMs = this.clockPort.now() - stageStart`.

   Call `this.loggerPort.logStageEnd('panel', stageDurationMs, aggregateUsage)`.

8. **Return** `{ responses, failedModels }`.

---

### 2. `JudgeStep` (`src/application/usecases/judge-step.ts`)

Calls a judge model through `ChatModelPort.complete()` with a JSON `response_format`, parses the structured output against the `Analysis` zod schema via `safeParseAnalysis`, and returns the parsed `Analysis` or `null` on any failure without throwing. The judge failure is never fatal — graceful degradation is ensured by returning `null` and logging the error.

#### Constructor

```typescript
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ModelRef } from '../../domain/model/fusion-types.js';

export class JudgeStep {
  constructor(
    private readonly chatModelPort: ChatModelPort,
    private readonly judgeModel: ModelRef,
    private readonly loggerPort: LoggerPort
  ) {}
}
```

The `judgeModel: ModelRef` is injected directly (resolved by the orchestrator from `ConfigPort.getJudgeModel()`). `ClockPort` is not needed — the orchestrator measures judge stage duration externally.

#### `analyze(panelResponses: PanelResponse[]): Promise<Analysis | null>`

1. **Load prompt** — call `buildJudgePrompt(panelResponses)` from `../../domain/services/judge-prompt-builder.js`. This returns `{ systemPrompt: string; userPrompt: string }`.

2. **Build `ChatRequest`**:
   - `messages`: array with two elements — `{ role: 'system', content: systemPrompt }` then `{ role: 'user', content: userPrompt }`.
   - `model`: `this.judgeModel`.
   - `options`: `{ responseFormat: { type: 'json_object' } }`. (Only `responseFormat` is set — no `temperature`, `maxTokens`, or `signal` at this stage.) The `ResponseFormat` literal `{ type: 'json_object' }` instructs the outbound adapter (e.g., `OpenAiChatAdapter`) to set the provider-specific parameter (`response_format: { type: "json_object" }` for OpenAI, `output_config.format` for Anthropic).

3. **Call the judge model** — `const response: ChatResponse = await this.chatModelPort.complete(chatRequest)`. If `complete()` rejects (network error, timeout, API error), catch the rejection in step 4.

4. **Parse the response with graceful degradation** — use a try/catch around the entire `complete()` + parse sequence:

   ```typescript
   try {
     const response = await this.chatModelPort.complete(chatRequest);
     const result = safeParseAnalysis(response.content);
     if (result.success) {
       return result.data;  // Analysis object
     } else {
       this.loggerPort.logError('judge', new Error(`Schema validation failed: ${result.error}`));
       return null;
     }
   } catch (error) {
     const err = error instanceof Error ? error : new Error(String(error));
     this.loggerPort.logError('judge', err);
     return null;
   }
   ```

   - On `complete()` rejection → log via `loggerPort.logError('judge', error)` and return `null`.
   - On `safeParseAnalysis` returning `{ success: false, error }` → log via `loggerPort.logError('judge', new Error('Schema validation failed: ' + error))` and return `null`.
   - On success → return the `Analysis` object directly.

   The method **never throws**. Every failure path returns `null` and logs the error. This is the core of AC-8 graceful degradation.

---

### 3. `SynthesizeStep` (`src/application/usecases/synthesize-step.ts`)

Calls the synthesizer model through `ChatModelPort.complete()` (non-streamed in Phase 2; streaming is added in Task 10) with a prompt built from panel outputs and optional judge analysis. Returns the raw text content from the model.

#### Constructor

```typescript
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { ModelRef } from '../../domain/model/fusion-types.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { PanelResponse } from '../../domain/model/panel-types.js';
import type { Analysis } from '../../domain/services/analysis-schema.js';

export class SynthesizeStep {
  constructor(
    private readonly chatModelPort: ChatModelPort,
    private readonly synthesizerModel: ModelRef
  ) {}
}
```

The `synthesizerModel: ModelRef` is injected directly (resolved by the orchestrator from `ConfigPort.getSynthesizerModel()`). `LoggerPort` and `ClockPort` are not needed — the orchestrator handles synthesis stage logging.

#### `synthesize(request: FusionRequest, panelResponses: PanelResponse[], analysis?: Analysis): Promise<string>`

1. **Build the synthesis prompt** — call `buildSynthesisPrompt(panelResponses, analysis)` from `../../domain/services/prompt-builders.js`. When `analysis` is `undefined` (judge skipped or failed), the function produces a prompt grounded solely in panel outputs. When `analysis` is provided, the prompt incorporates the structured analysis fields (`consensus`, `contradictions`, `uniqueInsights`, `blindSpots`).

2. **Build `ChatRequest`**:
   - `messages`: if `request.systemPrompt` is a non-empty string, prepend `{ role: 'system', content: request.systemPrompt }` to the messages array; then append `{ role: 'user', content: synthesisPromptText }`. The synthesis prompt text is already a complete instruction (built by `buildSynthesisPrompt`), so it is placed as a single user message. If there is no `systemPrompt`, the messages array contains only the user message with the synthesis prompt.
   - `model`: `this.synthesizerModel`.
   - `options`: include `temperature` if `request.temperature !== undefined`, include `maxTokens` if `request.maxTokens !== undefined`. Omit `options` if neither is set. No `responseFormat` — synthesis output is free-form text.

3. **Call the synthesizer model** — `const response: ChatResponse = await this.chatModelPort.complete(chatRequest)`.

4. **Return** `response.content` (a string). If the model returned an empty string or null content, return an empty string `""` — do not throw or return null.

   Errors from `complete()` are not caught here — they propagate to the orchestrator, which handles error events in the stream.

---

### Import restrictions (NFR-1)

All three files in `src/application/usecases/` must only import from `src/domain/` paths. Specifically:

- `src/domain/ports/chat-model-port.js` — `ChatModelPort`
- `src/domain/ports/logger-port.js` — `LoggerPort`
- `src/domain/ports/clock-port.js` — `ClockPort`
- `src/domain/model/message.js` — `Message`
- `src/domain/model/chat-types.js` — `ChatRequest`, `ChatResponse`, `ChatOptions`, `ResponseFormat`, `TokenUsage`
- `src/domain/model/fusion-types.js` — `ModelRef`, `FusionError`, `FusionRequest`
- `src/domain/model/stream-types.js` — `FailedModelInfo`
- `src/domain/model/panel-types.js` — `PanelResponse`, `PanelResult`
- `src/domain/services/prompt-builders.js` — `buildSynthesisPrompt`
- `src/domain/services/analysis-schema.js` — `Analysis`, `safeParseAnalysis`
- `src/domain/services/judge-prompt-builder.js` — `buildJudgePrompt`

All imports must use `.js` extension (per ESM/NodeNext module resolution). No imports from `src/infrastructure/` or from any npm package (`openai`, `@anthropic-ai/sdk`, `hono`, `zod`, etc.). Using `zod` for runtime validation is confined to the domain service `safeParseAnalysis` — the application services call that function and never import `zod` directly.

## Files
- `src/application/usecases/panel-runner.ts` (CREATE) — `PanelRunner` class: constructor accepts `ChatModelPort`, `LoggerPort`, `ClockPort`; `run(request, panelModels)` dispatches parallel `complete()` calls via `Promise.allSettled`, measures per-model latency via `ClockPort`, collects `PanelResponse[]` and `FailedModelInfo[]`, logs stage lifecycle and failures via `LoggerPort`, throws `FusionError('all_panels_failed')` when every model rejects.
- `src/application/usecases/judge-step.ts` (CREATE) — `JudgeStep` class: constructor accepts `ChatModelPort`, `ModelRef` (judge), `LoggerPort`; `analyze(panelResponses)` builds the judge prompt via `buildJudgePrompt`, calls `complete()` with `responseFormat: { type: 'json_object' }`, parses content with `safeParseAnalysis`, returns `Analysis` on success or `null` on any failure (model rejection or schema validation failure), logs all failures via `LoggerPort.logError` without throwing.
- `src/application/usecases/synthesize-step.ts` (CREATE) — `SynthesizeStep` class: constructor accepts `ChatModelPort`, `ModelRef` (synthesizer); `synthesize(request, panelResponses, analysis?)` builds the synthesis prompt via `buildSynthesisPrompt` (with optional analysis), constructs a `ChatRequest` (prepending system prompt from request if present), calls `complete()`, returns the text content as a string.

## Test Expectations
- **PanelRunner success — all models fulfill:** When `PanelRunner.run()` is called with a `FusionRequest` containing `messages: [{ role: 'user', content: 'test' }]` and two `ModelRef` entries, and the stubbed `ChatModelPort.complete()` resolves for both calls (each returning `ChatResponse` with distinct content), the returned promise resolves to an object with `responses` array of length 2 (each a `PanelResponse` with `model`, `content`, `usage`, `latencyMs`) and `failedModels` array of length 0.
- **PanelRunner partial failure:** When three panel models are configured and the stubbed `complete()` rejects for the second model with `Error('timeout')`, the returned object has `responses` array of length 2 (the two successful models) and `failedModels` array of length 1 containing `{ modelId: <second model's model string>, errorCode: 'Error', errorMessage: 'timeout' }`.
- **PanelRunner total failure — throws FusionError:** When every panel model rejects (all three `complete()` calls reject), the returned promise rejects with a `FusionError` whose `code` is `'all_panels_failed'`, `message` is `'Every panel model failed'`, and `details.failedModels` is an array of three `FailedModelInfo` entries (one per model).
- **PanelRunner total failure details:** The thrown `FusionError` is an instance of `Error` (via `instanceof`), has `name === 'FusionError'`, and `details.failedModels[0]` has `modelId`, `errorCode`, and `errorMessage` all as strings.
- **PanelRunner empty panelModels:** When `panelModels` is an empty array, the method throws `FusionError('all_panels_failed', 'No panel models configured')` and no calls to `ChatModelPort.complete()` are made.
- **PanelRunner per-model latency:** Each `PanelResponse` in the `responses` array has a `latencyMs` that equals the difference between two `clockPort.now()` calls that wrap the corresponding `complete()` call. If the stubbed `ClockPort` returns `100` then `250`, the `latencyMs` is `150`.
- **PanelRunner logging — stage lifecycle:** `loggerPort.logStageStart('panel')` is called exactly once before any `complete()` call. `loggerPort.logStageEnd('panel', <durationMs>, <aggregateUsage>)` is called exactly once after all `complete()` calls settle. On total failure (all reject), `logStageEnd` is not called — the method throws before reaching that step.
- **PanelRunner logging — failed models:** When at least one model rejects (partial failure), `loggerPort.logFailedModels()` is called with a non-empty array of `FailedModelInfo` objects. On total failure (all reject), `logFailedModels` is not called — the method throws `FusionError` before reaching the logging step (the `failedModels` are included in `FusionError.details.failedModels`). On full success (no rejections), `logFailedModels` is not called.
- **PanelRunner aggregate usage:** The `TokenUsage` passed to `logStageEnd` aggregates token counts across all fulfilled responses: `promptTokens` sums each response's `usage.promptTokens`, `completionTokens` sums each response's `usage.completionTokens`, `totalTokens` sums each response's `usage.totalTokens`. Responses with `undefined` usage contribute 0.
- **JudgeStep success — valid JSON response:** When `JudgeStep.analyze()` is called with two `PanelResponse` entries, `buildJudgePrompt` returns a system and user prompt, and the stubbed `complete()` resolves with `content` containing valid JSON matching the `Analysis` schema, the returned promise resolves to an `Analysis` object with `consensus`, `contradictions`, `uniqueInsights`, and `blindSpots` fields.
- **JudgeStep failure — invalid JSON:** When `complete()` resolves but `response.content` is not valid JSON, `safeParseAnalysis` returns `{ success: false }`, and the method returns `null` (not throws). The `loggerPort.logError('judge', <Error>)` is called exactly once.
- **JudgeStep failure — schema mismatch:** When `complete()` resolves with valid JSON that is missing the required `consensus` field, `safeParseAnalysis` returns `{ success: false, error: '<description>' }`, the method returns `null`, and `loggerPort.logError('judge', <Error>)` is called with an error whose message contains the schema validation error text.
- **JudgeStep failure — complete() rejects:** When the stubbed `complete()` rejects with `new Error('judge unreachable')`, the method returns `null` (not throws) and `loggerPort.logError('judge', <Error>)` is called with the rejection error.
- **JudgeStep never throws:** Regardless of whether `complete()` rejects, returns invalid JSON, or returns schema-mismatched JSON, `analyze()` always resolves (never rejects). The resolution value is `Analysis | null`.
- **JudgeStep prompt construction:** The `ChatRequest` passed to `complete()` has `messages` array with two entries: a system message with the prompt from `buildJudgePrompt().systemPrompt` and a user message with `buildJudgePrompt().userPrompt`. `options.responseFormat` is `{ type: 'json_object' }`.
- **SynthesizeStep success with analysis:** When `synthesize()` is called with a request containing `messages: [{ role: 'user', content: 'hello' }]`, two `PanelResponse` entries, and an `Analysis` object, the method calls `buildSynthesisPrompt(panelResponses, analysis)`, constructs a `ChatRequest` with the resulting prompt as a user message, and returns the `content` string from the stubbed `complete()` response.
- **SynthesizeStep success without analysis:** When `analysis` is `undefined`, `buildSynthesisPrompt(panelResponses)` is called without the analysis argument, and the synthesis prompt is built solely from panel outputs. The returned string still comes from `complete().content`.
- **SynthesizeStep system prompt prepend:** When `request.systemPrompt` is `'Be concise'`, the `ChatRequest.messages` array passed to `complete()` starts with `{ role: 'system', content: 'Be concise' }` followed by `{ role: 'user', content: <synthesisPromptText> }`. When `systemPrompt` is `undefined` or empty, only the user message exists.
- **SynthesizeStep empty content:** When `complete()` returns `ChatResponse` with `content: ''` (empty string), `synthesize()` returns `''` rather than throwing.
- **SynthesizeStep error propagation:** When `complete()` rejects, `synthesize()` rejects with the same error (no try/catch inside this method — the orchestrator handles synthesis errors).
- **Dependency rule — no infrastructure imports:** Running `grep -r "from.*infrastructure" src/application/usecases/panel-runner.ts src/application/usecases/judge-step.ts src/application/usecases/synthesize-step.ts` returns no matches.
- **Dependency rule — no SDK imports:** Running `grep -r "from 'openai'" src/application/usecases/panel-runner.ts src/application/usecases/judge-step.ts src/application/usecases/synthesize-step.ts` returns no matches; same for `@anthropic-ai/sdk`, `hono`, `@hono/node-server`. (The `zod` package is not imported by these files — `safeParseAnalysis` is a domain service that encapsulates zod usage internally.)
- **Compilation:** After Task 01, 02, and 06 files are in place, `npx tsc --noEmit` produces zero TypeScript errors from the three files in `src/application/usecases/`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
