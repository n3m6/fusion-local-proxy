# Task 04: JudgeStep with graceful degradation

## Metadata
- **Task:** 04
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 3 (Judge Analysis)

## Dependencies
- **02 (analysis-schema, judge-prompt):** The `analysisSchema` zod schema with inferred `Analysis` type from `src/domain/services/analysis-schema.ts`, and `buildJudgeSystemPrompt()` / `buildJudgeUserPrompt()` from `src/domain/services/judge-prompt.ts`, must exist and compile. JudgeStep imports and uses all three.
- **03 (PanelResult type):** The `PanelResult` interface from `src/domain/model/fusion-types.ts` must exist and compile. JudgeStep's `analyze()` method receives `PanelResult[]` as its first argument and passes the array to `buildJudgeUserPrompt()`.

## Traceability
- **Acceptance Criteria:** AC-8, AC-14 (partial)
- **NFRs:** NFR-1, NFR-5 (judge failure never blocks synthesis), NFR-7 (logs judge failure with error details)
- **Replan Gate Criteria:** Phase 2 Gate 1 (analysis enriches synthesis), Phase 2 Gate 2 (graceful degradation when judge unreachable)

## Source Traceability
- **Goals:** AC-8 — `JudgeStep` calls `ChatModelPort.complete()` with a JSON `response_format` and parses the response against the `Analysis` zod schema; if the judge call fails or the response fails schema validation, the use case continues without analysis and logs the failure via `LoggerPort`; AC-14 — application-layer unit tests exercise `JudgeStep` with stubbed `ChatModelPort` and `ConfigPort`.
- **Plan:** Task 04, Phase 2 — Ensemble Pipeline (Panel + Judge + Synthesis)
- **Design:** Slice 3 (Judge Analysis with Graceful Degradation) — adds a structured judge step between panel and synthesis; judge model called with JSON `response_format`; output validated against `Analysis` zod schema; on judge failure or schema validation failure, use case degrades gracefully — synthesis proceeds with raw panel responses; judge success enriches the synthesis prompt.
- **Structure:** Slice 3 — `src/application/usecases/judge-step.ts` (CREATE), `src/application/usecases/judge-step.test.ts` (CREATE)

## Description

Create the `JudgeStep` application use case class. `JudgeStep` calls a designated judge model through `ChatModelPort.complete()` requesting structured JSON output, parses the response against the `analysisSchema` zod schema using `safeParse()`, and returns the parsed `Analysis` object. On any failure — SDK error from `ChatModelPort`, invalid JSON in the response, or zod schema validation failure — `JudgeStep` logs the error via `LoggerPort.logError()` and returns `null` (graceful degradation: the caller sees a nullable result and can fall back to synthesis without analysis).

### Class and constructor

The class is named `JudgeStep` and is exported from `src/application/usecases/judge-step.ts`. Its constructor accepts three ports:

```typescript
constructor(
  private readonly chatPort: ChatModelPort,
  private readonly loggerPort: LoggerPort,
  private readonly clockPort: ClockPort,
) {}
```

There is no `ConfigPort` dependency — the caller supplies the judge model reference and timeout as method arguments, keeping the class agnostic to configuration layout.

### Method: `analyze()`

The class exposes a single public async method:

```typescript
async analyze(
  panelResults: PanelResult[],
  originalMessages: Message[],
  judgeModel: ModelRef,
  timeoutMs: number,
): Promise<Analysis | null>
```

#### Parameters

- **`panelResults`**: The array of panel results produced by `PanelRunner`. Passed to `buildJudgeUserPrompt()` so the judge sees every panel model's output. An empty array is valid and must not throw — the method should construct the prompt with zero panel results and proceed.
- **`originalMessages`**: The user's original conversation messages from the inbound request. Passed to `buildJudgeUserPrompt()` so the judge has context about what the user asked.
- **`judgeModel`**: A `ModelRef` identifying which provider and model to use for the judge. Used as the `model` field in the `ChatRequest`.
- **`timeoutMs`**: A per-call timeout in milliseconds. Passed through to `ChatRequest.options.signal` by creating an `AbortController` whose `signal` is attached to the `ChatRequest` options. The `AbortController` is aborted after `timeoutMs` via `setTimeout`.

#### Return value

- **`Analysis`**: On success — the parsed and validated structured analysis object inferred from `analysisSchema`.
- **`null`**: On any failure — graceful degradation so the caller can proceed with synthesis using raw panel outputs only.

### Internal flow

1. **Log stage start**: Call `this.loggerPort.logStageStart('judge')`.
2. **Capture start time**: Call `this.clockPort.now()`.
3. **Build prompts**: Call `buildJudgeSystemPrompt()` and `buildJudgeUserPrompt(panelResults, originalMessages)` from `src/domain/services/judge-prompt.js`.
4. **Create AbortController with timeout**: Construct a new `AbortController`. Call `setTimeout(() => controller.abort(), timeoutMs)`. If `timeoutMs` is zero or negative, skip the timeout (no signal attached).
5. **Construct ChatRequest**: Build a `ChatRequest` with:
   - `messages`: A system message with the system prompt string, followed by a user message with the user prompt string.
   - `model`: The `judgeModel` parameter.
   - `options`: An object containing:
     - `responseFormat`: `{ type: 'json_schema', schema: analysisSchema.shape as Record<string, unknown> }` — this tells the downstream adapter to request structured JSON output that conforms to the `Analysis` schema shape. The `analysisSchema` is imported from `src/domain/services/analysis-schema.js`.
     - `signal`: The `AbortController`'s signal.
6. **Call ChatModelPort.complete()**: Await `this.chatPort.complete(chatRequest)`.
7. **Parse the response**: The `ChatResponse.content` string is expected to be JSON. Parse it with `JSON.parse()`. If `JSON.parse()` throws (invalid JSON), catch the error, log it, and return `null`.
8. **Validate with safeParse**: Call `analysisSchema.safeParse(parsedJson)`. If `safeParse` returns `{ success: false, error }`, log the `error` (a `ZodError`) via `loggerPort.logError()`, and return `null`.
9. **Log stage end on success**: Compute duration as `this.clockPort.now() - startTime`. Call `this.loggerPort.logStageEnd('judge', durationMs, response.usage)`.
10. **Return Analysis**: If `safeParse` returns `{ success: true, data }`, return `data` (typed as `Analysis`).
11. **Error handling (catch-all)**: Wrap steps 6–10 in a try/catch. If `chatPort.complete()` rejects (SDK error, network failure, timeout abort), or `JSON.parse()` throws, catch the error, call `this.loggerPort.logError('judge', error)`, and return `null`. Do NOT re-throw — graceful degradation requires that judge failure never propagates to the caller as an exception.

### Cleanup

If the `analyze()` method returns before the timeout fires (either success or caught failure), call `clearTimeout()` to avoid a dangling timer. The `AbortController` is left to garbage-collect after the method returns; no explicit cleanup is needed beyond clearing the timeout.

## Files
- `src/application/usecases/judge-step.ts` (CREATE) — The `JudgeStep` class implementing the `analyze()` method as described above. Imports: `Analysis` and `analysisSchema` from `../../domain/services/analysis-schema.js`, `buildJudgeSystemPrompt` and `buildJudgeUserPrompt` from `../../domain/services/judge-prompt.js`, `PanelResult` and `ModelRef` from `../../domain/model/fusion-types.js`, `Message` from `../../domain/model/message.js`, `ChatModelPort` from `../../domain/ports/chat-model-port.js`, `LoggerPort` from `../../domain/ports/logger-port.js`, `ClockPort` from `../../domain/ports/clock-port.js`, `ChatRequest` from `../../domain/model/chat-types.js`.
- `src/application/usecases/judge-step.test.ts` (CREATE) — Colocated `node:test` suite with hand-written stubs (plain objects implementing the port interfaces, no mocking libraries). Covers the behaviors listed in Test Expectations.

## Test Expectations
- **Successful analysis parse**: When `chatPort.complete()` resolves with a `ChatResponse` whose `content` is a valid JSON string matching the `analysisSchema` shape, `analyze()` returns an `Analysis` object with all fields populated, `loggerPort.logStageStart('judge')` is called once, `loggerPort.logStageEnd('judge', anyNonNegativeNumber, usage)` is called once, and `loggerPort.logError()` is NOT called.
- **Schema validation failure returns null**: When `chatPort.complete()` resolves with a `ChatResponse` whose `content` is valid JSON but the parsed object is missing the required `consensus` field (or any other required field according to `analysisSchema`), `analyze()` returns `null`, `loggerPort.logError('judge', error)` is called once with the `ZodError`, and `loggerPort.logStageEnd()` is NOT called.
- **Judge model error returns null**: When `chatPort.complete()` rejects with an `Error` (simulating an SDK error, network failure, or timeout), `analyze()` returns `null`, `loggerPort.logError('judge', error)` is called once with the rejected error, and the method does not throw.
- **Invalid JSON response returns null**: When `chatPort.complete()` resolves with a `ChatResponse` whose `content` is not valid JSON (e.g., plain text, truncated), `analyze()` returns `null` and `loggerPort.logError('judge', error)` is called once with the `SyntaxError`.
- **Empty panel results handled**: When `analyze()` is called with an empty `panelResults` array (`[]`), the method does not throw, the user prompt is constructed with an empty panel results list, and the judge call proceeds normally. If the judge responds with valid JSON, the `Analysis` is returned as usual.
- **Logger called on failure**: In every failure scenario (schema validation failure, SDK error, invalid JSON), `loggerPort.logError('judge', error)` is called exactly once, and `analyze()` returns `null`.
- **Timeout signal attached**: When `timeoutMs > 0`, the `ChatRequest.options.signal` is truthy (an `AbortSignal`), and the signal transitions to aborted state after `timeoutMs` milliseconds (tested by advancing fake timers or observing the signal's aborted property after a delay).
- **Cleanup on success**: When `analyze()` succeeds, the timeout `setTimeout` is cleared (no dangling timer observable by side effects after the method returns).

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.
