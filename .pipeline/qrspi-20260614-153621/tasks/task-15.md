# Task 15: Enhanced logging

## Metadata
- **Task:** 15
- **Phase:** 5
- **Route:** full
- **Slice:** Observability, Tests, and Documentation

## Dependencies
- **Task 14 — Anthropic inbound adapter:** Provides the completed `/v1/messages` route and SSE encoder — the last infrastructure component before observability enhancements. Task 15 does not import from Task 14's files; the dependency exists because the full ensemble pipeline (panel, judge, synthesis, streaming, Anthropic support) must be wired and working before the enhanced logger can be correctly exercised through the DI container.

## Traceability
- **Acceptance Criteria:** AC-13
- **NFRs:** NFR-1, NFR-7
- **Replan Gate Criteria:** Phase 5 Gate 1 (structured log lines verified)

## Source Traceability
- **Goals:** AC-13 — ConsoleLoggerAdapter logs per-stage cost and latency for panel, judge, and synthesis; failed_models entries include model identifier, error code, and truncated error message
- **Plan:** Task 15, Phase 5 — Polish
- **Design:** Slice 6 — Observability, Tests, and Documentation
- **Structure:** Slice 6 — Observability, Tests, and Documentation — `src/infrastructure/outbound/logging/console-logger-adapter.ts` (MODIFY), `src/infrastructure/di/container.ts` (MODIFY)

## Description

Enhance `ConsoleLoggerAdapter` to produce production-grade structured observability output and update the DI container to wire the enhanced adapter with a `ClockPort` dependency. This task is a cross-phase modification of the adapter originally created in Task 04 and the container originally created in Task 05. All changes are confined to the two files listed below. Neither the `LoggerPort` interface nor any domain type changes — the enhancements are purely within the adapter implementation and the DI wiring.

---

### 1. `ConsoleLoggerAdapter` enhancements (`src/infrastructure/outbound/logging/console-logger-adapter.ts`)

The existing `ConsoleLoggerAdapter` does the following (current state):
- Has no constructor parameters
- `logStageStart(stage)` emits `{ stage, event: "start" }`
- `logStageEnd(stage, durationMs, usage?)` emits `{ stage, event: "end", durationMs, tokens: usage ?? undefined }` (passes the raw `TokenUsage` object)
- `logFailedModels(models)` emits `{ event: "failed_models", models }` (one JSON line per call, key is `models`, no stage context)
- `logError(stage, error)` emits `{ stage, event: "error", error: error.message }`

The enhanced adapter introduces these changes:

#### a) Constructor takes `ClockPort`

```typescript
import type { ClockPort } from '../../../domain/ports/clock-port.js';

export class ConsoleLoggerAdapter implements LoggerPort {
  private readonly startTimes = new Map<string, number>();
  private currentStage: string | null = null;

  constructor(private readonly clockPort: ClockPort) {}

  // ... methods
}
```

The `ClockPort` is stored as a private field and used for all time measurement. The `startTimes` map and `currentStage` field are new private state.

#### b) `logStageStart` — records start time and sets stage context

When `logStageStart(stage)` is called:
1. Record the current time: `this.startTimes.set(stage, this.clockPort.now())`.
2. Set the current stage context: `this.currentStage = stage`.
3. Emit a structured JSON line via `console.log`:
   ```json
   { "stage": "<stage>", "event": "start" }
   ```

#### c) `logStageEnd` — computes latency via ClockPort, maps token fields

When `logStageEnd(stage, durationMs, usage?)` is called:
1. Look up the start time for the given `stage` from `this.startTimes`.
2. Compute the elapsed duration:
   - If a start time exists: `const elapsed = this.clockPort.now() - startTime;`
   - If no start time exists (e.g., `logStageEnd` called without a prior `logStageStart`): fall back to the `durationMs` parameter.
3. Delete the start time entry from the map and clear `this.currentStage`.
4. Emit a structured JSON line:
   ```json
   {
     "stage": "<stage>",
     "event": "end",
     "durationMs": <elapsed>,
     "tokens": { "prompt": <usage.promptTokens>, "completion": <usage.completionTokens>, "total": <usage.totalTokens> }
   }
   ```
   - If `usage` is `undefined`, omit the `tokens` field entirely.
   - **Token field mapping**: The domain `TokenUsage` type has fields `promptTokens`, `completionTokens`, `totalTokens`. The log output maps these to `prompt`, `completion`, `total` respectively. This is a fix from the current implementation which passes the raw `TokenUsage` object directly (producing `promptTokens`/`completionTokens`/`totalTokens` keys).

#### d) `logFailedModels` — truncated error messages, stage context, single array output

When `logFailedModels(models: FailedModelInfo[])` is called:
1. For each `FailedModelInfo` in the array, truncate `errorMessage` to at most 200 characters. If the message is already ≤200 characters, leave it unchanged. Truncation means taking the first 200 characters — no ellipsis or suffix is appended.
2. Build an array of objects, each with `modelId`, `errorCode`, and `errorMessage` (the truncated value).
3. Emit a single structured JSON line:
   ```json
   {
     "stage": "<this.currentStage>",
     "event": "failed_models",
     "failedModels": [
       { "modelId": "...", "errorCode": "...", "errorMessage": "..." }
     ]
   }
   ```
   - If `this.currentStage` is `null` (no stage has been started), omit the `stage` field from the output.
   - The JSON key for the array is `failedModels` (not `models` as in the current implementation).
   - This emits **one** JSON line per `logFailedModels` call, containing all model entries in a single array. It does **not** iterate and emit one line per model.

#### e) `logError` — unchanged contract

The `logError(stage: string, error: Error)` method retains its current behavior:
```json
{ "stage": "<stage>", "event": "error", "message": "<error.message>" }
```
Note: the key is `message` and the value is `error.message` (a string). The current implementation uses `"error"` as the key — this must be changed to `"message"` to match the original Task 04 spec (which expects `"message"`).

#### f) Per-stage child labels

The adapter maintains a `currentStage` context (set by `logStageStart`, cleared by `logStageEnd`). When `logFailedModels` is called between a `logStageStart` and `logStageEnd`, the `stage` field in the output reflects the active stage. This gives each failed-model log line the appropriate per-stage label without requiring the `LoggerPort` interface to change. The `logFailedModels` method does not take a `stage` parameter in the interface, so this internal tracking is the mechanism for per-stage labeling.

#### g) Import additions

Add the following import to the file:
```typescript
import type { ClockPort } from '../../../domain/ports/clock-port.js';
```

The existing imports (`LoggerPort`, `TokenUsage`, `FailedModelInfo`) remain unchanged.

---

### 2. DI container changes (`src/infrastructure/di/container.ts`)

The container currently (post-Phase 4) creates the `ClockPort` after the `ConsoleLoggerAdapter`. The enhanced adapter requires `ClockPort` at construction time, so the wiring order must change.

#### Required change

Swap the order of steps so `ClockPort` is instantiated **before** `ConsoleLoggerAdapter`, and pass `clockPort` to the `ConsoleLoggerAdapter` constructor.

**Before (current order):**
```
// 2. Logger
const loggerPort: LoggerPort = new ConsoleLoggerAdapter();

// 3. Clock
const clockPort: ClockPort = { now: () => Date.now() };
```

**After (required order):**
```
// 2. Clock
const clockPort: ClockPort = { now: () => Date.now() };

// 3. Logger
const loggerPort: LoggerPort = new ConsoleLoggerAdapter(clockPort);
```

No other container changes are needed. The `clockPort` inline object (`{ now: () => Date.now() }`) is unchanged. The `clockPort` is already passed to `RunFusionUseCase` by the existing wiring — verify that this continues to work (the instance is the same `clockPort` reference).

#### Verification

After the change, the container must still:
- Export `createApp()` returning `{ app, configPort }` (or the equivalent return type currently in use).
- Pass `clockPort` to `RunFusionUseCase` as before.
- Not introduce any new imports beyond what is already present.
- Not import any SDK or framework in a way that violates NFR-1.

---

### Summary of behavioral changes

| Method | Before (Task 04) | After (Task 15) |
|--------|-----------------|-----------------|
| Constructor | `constructor()` | `constructor(clockPort: ClockPort)` |
| `logStageStart` | Emits `{ stage, event: "start" }` | Also records `clockPort.now()` for the stage and sets `currentStage` |
| `logStageEnd` | Uses passed `durationMs`; raw `TokenUsage` in `tokens` field | Computes elapsed via `clockPort.now() - startTime`; maps token fields to `{ prompt, completion, total }`; omits `tokens` when `usage` is `undefined` |
| `logFailedModels` | `{ event: "failed_models", models: [...] }` — no truncation, key is `models`, no stage | `{ stage?, event: "failed_models", failedModels: [...] }` — `errorMessage` truncated to ≤200 chars, key is `failedModels`, stage from `currentStage` |
| `logError` | `{ stage, event: "error", error: error.message }` | `{ stage, event: "error", message: error.message }` — key changed from `error` to `message` |

## Files
- `src/infrastructure/outbound/logging/console-logger-adapter.ts` (MODIFY) — Add `ClockPort` dependency to constructor; add private `startTimes` map and `currentStage` field; `logStageStart` records start time via `clockPort.now()`; `logStageEnd` computes elapsed via ClockPort, maps `TokenUsage` fields to `{ prompt, completion, total }`; `logFailedModels` truncates `errorMessage` to ≤200 characters, uses `currentStage` for stage label, emits under `failedModels` key; `logError` uses `message` key. All output is single-line JSON via `console.log`.
- `src/infrastructure/di/container.ts` (MODIFY) — Move `ClockPort` instantiation before `ConsoleLoggerAdapter`; pass `clockPort` to `new ConsoleLoggerAdapter(clockPort)`.

## Test Expectations
- **Logger constructor accepts ClockPort:** Constructing `new ConsoleLoggerAdapter(clockPort)` succeeds without throwing. The `clockPort` is a `ClockPort` (object with `now(): number`).
- **Stage start emits start event:** Calling `logStageStart("panel")` on an enhanced `ConsoleLoggerAdapter` causes `console.log` to be called with a JSON string whose parsed object is exactly `{ stage: "panel", event: "start" }`.
- **Stage end computes latency from start:** When `logStageStart("panel")` is called, and the mocked `ClockPort.now()` returns `1000` on the first call (during start) and `1250` on the second call (during end), then calling `logStageEnd("panel", 0)` (durationMs=0 from caller) causes `console.log` to emit a JSON object with `durationMs: 250`.
- **Stage end with usage maps token fields:** Calling `logStageEnd("panel", 150, { promptTokens: 100, completionTokens: 50, totalTokens: 150 })` causes `console.log` to emit a JSON string whose parsed object contains `tokens: { prompt: 100, completion: 50, total: 150 }`. The keys are `prompt`, `completion`, `total` — not `promptTokens`, `completionTokens`, `totalTokens`.
- **Stage end without usage omits tokens:** Calling `logStageEnd("panel", 150)` (no third argument) causes `console.log` to emit a JSON object that does **not** contain a `tokens` key.
- **Stage end without prior start uses passed durationMs:** When `logStageEnd("judge", 500)` is called without a preceding `logStageStart("judge")`, the emitted JSON object has `durationMs: 500` (the fallback value from the parameter, since no start time was recorded).
- **Failed models truncates long error messages:** Calling `logFailedModels([{ modelId: "gpt-4o", errorCode: "TIMEOUT", errorMessage: "A".repeat(250) }])` causes `console.log` to emit a JSON object whose `failedModels[0].errorMessage` has length exactly 200.
- **Failed models preserves short error messages:** Calling `logFailedModels([{ modelId: "claude", errorCode: "RATE_LIMIT", errorMessage: "Too many requests" }])` causes `console.log` to emit a JSON object whose `failedModels[0].errorMessage` is exactly `"Too many requests"` (untruncated, length 18).
- **Failed models includes stage context:** When `logStageStart("panel")` is called followed by `logFailedModels([...])` (without an intervening `logStageEnd`), the emitted JSON object contains `stage: "panel"` alongside `event: "failed_models"`.
- **Failed models omits stage when no stage active:** Calling `logFailedModels([...])` on a fresh adapter instance (no prior `logStageStart`) causes `console.log` to emit a JSON object that does **not** contain a `stage` key.
- **Failed models emits single log line with array:** Calling `logFailedModels([{ modelId: "a", errorCode: "E1", errorMessage: "m1" }, { modelId: "b", errorCode: "E2", errorMessage: "m2" }])` causes exactly **one** `console.log` call. The emitted JSON object has `failedModels` as an array containing both entries.
- **Failed models key is `failedModels`:** The emitted JSON object uses the key `failedModels` (not `models`) for the array.
- **Log error emits message key:** Calling `logError("passthrough", new Error("connection refused"))` causes `console.log` to emit a JSON string whose parsed object contains `{ stage: "passthrough", event: "error", message: "connection refused" }`. The error detail key is `message` (not `error`).
- **Container creates ClockPort before Logger:** Calling `createApp()` from the modified `container.ts` instantiates `ClockPort` before `ConsoleLoggerAdapter`. The `ConsoleLoggerAdapter` constructor receives the `clockPort` instance. No runtime error occurs during wiring.
- **Container passes same ClockPort to use case:** The `clockPort` instance passed to `ConsoleLoggerAdapter` is the same reference passed to `RunFusionUseCase` (both share the same `{ now: () => Date.now() }` object).
- **Dependency rule holds after changes:** Running `grep -r "from 'openai'" src/domain/` and `grep -r "from 'openai'" src/application/` from the project root returns zero matches. Same for `@anthropic-ai/sdk` and `hono` in both directories. For `zod`, `grep -r "from 'zod'" src/application/` returns zero matches; in `src/domain/`, only the pre-existing `analysis-schema.ts` import is permitted (per the convention that zod is the only allowed SDK import in the domain layer). This confirms the enhanced logger adapter and DI container changes do not introduce new SDK imports into the domain or application layers.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
