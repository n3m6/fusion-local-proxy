# Task 10: Streaming in application layer

## Metadata
- **Task:** 10
- **Phase:** 3
- **Route:** full
- **Slice:** Streaming Synthesis + Timeouts

## Dependencies
- **09** — Provides the extended `ChatModelPort` with the `stream()` method and the `ChatStreamEvent` discriminated union type (`token`, `done`, `error`) in `src/domain/ports/chat-model-port.ts`. Task 10 depends on the `ChatModelPort.stream()` signature and `ChatStreamEvent` type to change `SynthesizeStep` from buffered `complete()` to streaming and to pipe port-level stream events into application-level `FusionStreamEvent` events.

## Traceability
- **Acceptance Criteria:** AC-10 (partial — progress events, content_delta streaming from synthesis)
- **NFRs:** NFR-1, NFR-4
- **Replan Gate Criteria:** Phase 3 Gate 1 (use case yields progress and content_delta events)

## Source Traceability
- **Goals:** AC-10
- **Plan:** Task 10, Phase 3 — Streaming Synthesis
- **Design:** Slice 4 — Streaming Synthesis + Timeouts
- **Structure:** Slice 4 — Streaming Synthesis + Timeouts; files `src/application/usecases/synthesize-step.ts`, `src/application/usecases/run-fusion-use-case.ts`

## Description

Modify two application-layer files to replace the buffered synthesis call with a streaming one. `SynthesizeStep` switches from `ChatModelPort.complete()` to `ChatModelPort.stream()`, changing its return type from `Promise<string>` to `AsyncIterable<ChatStreamEvent>`. `RunFusionUseCase` iterates the `ChatStreamEvent` stream and pipes each `token` event into a `FusionStreamEvent.content_delta`, then yields a final `done` event with accumulated usage and `failedModels`.

This task is a cross-phase modification of the application layer. The `SynthesizeStep` was originally created in Task 07 with a non-streamed `complete()` call, and `RunFusionUseCase` was originally created in Task 03 (passthrough) then rewritten in Task 08 (ensemble orchestration). Task 09 introduced the `ChatModelPort.stream()` signature and `ChatStreamEvent` type in the domain layer. This task wires those into the application layer so synthesis tokens flow out to callers as they arrive.

### `SynthesizeStep` (`src/application/usecases/synthesize-step.ts`)

The class constructor and dependencies do not change — it still receives `ChatModelPort` and the synthesizer `ModelRef`. Only the `synthesize()` method changes.

#### Current signature (after Task 07)

```ts
synthesize(request: FusionRequest, panelResponses: PanelResponse[], analysis?: Analysis): Promise<string>
```

The current implementation builds a synthesis prompt via `buildSynthesisPrompt()` (from domain services), constructs a `ChatRequest` with the system prompt, calls `await this.chatModelPort.complete(chatRequest)`, and returns `response.content`.

#### New signature (after Task 10)

```ts
synthesize(request: FusionRequest, panelResponses: PanelResponse[], analysis?: Analysis): AsyncIterable<ChatStreamEvent>
```

The method becomes an `async function*` generator. The prompt-building logic (calling `buildSynthesisPrompt`, prepending the system prompt, forwarding `temperature` and `maxTokens` from `request`) is preserved exactly as-is. The only change after prompt construction is replacing:

```ts
const response = await this.chatModelPort.complete(chatRequest);
```

with:

```ts
for await (const event of this.chatModelPort.stream(chatRequest)) {
  yield event;
}
```

The `SynthesizeStep` does not translate between `ChatStreamEvent` and `FusionStreamEvent` — it passes port-level events through unchanged. The translation happens in `RunFusionUseCase`. This keeps `SynthesizeStep` a thin wrapper over the port and preserves the layered separation: port events stay at the domain boundary, and the application layer (use case) owns the mapping to domain `FusionStreamEvent` types.

#### `ChatStreamEvent` reference (from Task 09 / domain ports)

```ts
export type ChatStreamEvent =
  | { readonly type: 'token'; readonly text: string }
  | { readonly type: 'done'; readonly usage?: TokenUsage }
  | { readonly type: 'error'; readonly code: string; readonly message: string };
```

The `SynthesizeStep` may yield all three variants: `token` events for each text chunk from the LLM, a `done` event when the LLM stream completes (carrying `TokenUsage`), or an `error` event if the adapter encounters a stream-level failure. The caller must handle all three.

#### Prompt building (unchanged logic, reproduced for self-containment)

1. Call `buildSynthesisPrompt(panelResponses, analysis)` from `src/domain/services/prompt-builders.js` to produce a synthesis system prompt string.
2. Construct the `ChatRequest.messages` array:
   - First element: `{ role: 'system', content: synthesisPrompt }`.
   - Remaining elements: the user-facing `request.messages` (spread directly).
3. Set `ChatRequest.model` to the `synthesizerModel` from the constructor.
4. If `request.temperature` is defined, include it in `ChatOptions`. If `request.maxTokens` is defined, include it. Omit `options` entirely if neither is set. Do **not** set `responseFormat` or `signal` — synthesis is a text stream.
5. Call `this.chatModelPort.stream(chatRequest)` and yield every event.

### `RunFusionUseCase` (`src/application/usecases/run-fusion-use-case.ts`)

The ensemble orchestration sequence (panel → judge → synthesis) established in Task 08 is preserved. The change is in the synthesis stage: instead of `await synthesize()` to get a full string and yield a single `content_delta`, the use case now iterates the stream.

#### Current synthesis handling (after Task 08)

After the judge stage (or graceful degradation fallback), the use case calls:

```ts
const content = await this.synthesizeStep.synthesize(request, panelResponses, analysis);
// then yields:
yield { type: 'content_delta' as const, delta: content };
yield { type: 'done' as const, usage: synthesisUsage, failedModels };
```

Where `synthesisUsage` comes from the `complete()` response and `failedModels` is collected during the panel stage.

#### New synthesis handling (after Task 10)

After the panel and judge stages complete (logic unchanged from Task 08), the use case replaces the buffered call with streaming iteration:

```ts
// Log synthesis stage start
this.loggerPort.logStageStart('synthesis');
const synthStartTime = this.clockPort.now();

// Iterate the stream
for await (const event of this.synthesizeStep.synthesize(request, panelResponses, analysis)) {
  if (event.type === 'token') {
    yield { type: 'content_delta' as const, delta: event.text };
  } else if (event.type === 'done') {
    synthesisUsage = event.usage;
  } else if (event.type === 'error') {
    this.loggerPort.logError('synthesis', new Error(event.message));
    yield {
      type: 'error' as const,
      code: event.code,
      message: event.message,
    };
    return; // stop the generator — no done event after a synthesis error
  }
}

// Log synthesis stage end
const synthDurationMs = this.clockPort.now() - synthStartTime;
this.loggerPort.logStageEnd('synthesis', synthDurationMs, synthesisUsage);

// Yield final done event
yield {
  type: 'done' as const,
  usage: synthesisUsage,
  failedModels,
};
```

Key behaviors:

- **Token piping**: Each `ChatStreamEvent.token` is immediately yielded as a `FusionStreamEvent.content_delta`. The caller receives one `content_delta` per token — this is the streaming guarantee.
- **Usage capture**: The `ChatStreamEvent.done` event carries the `TokenUsage` from the adapter layer. This usage is captured in a local variable (`synthesisUsage`) and attached to the final `FusionStreamEvent.done`. If the stream never yields a `done` event (e.g., early termination), `synthesisUsage` remains `undefined` and the final `done` event omits it.
- **Error propagation**: If the stream yields an `error` event, the use case logs it via `LoggerPort.logError`, yields a `FusionStreamEvent.error`, and returns immediately — no final `done` event is emitted after a synthesis error. This is consistent with the contract that a stream either produces successful tokens + done or an error, not both.
- **Progress events unchanged**: The `progress` events for the panel and judge stages (already emitted in Task 08) are preserved. No new progress event is added for the synthesis stage — the synthesis stream itself signals activity to the caller via `content_delta` events.
- **Logging alignment**: The synthesis stage `logStageStart` and `logStageEnd` calls wrap the stream iteration, measuring wall-clock duration from first event to stream completion.

#### Combined final `done` event

The `failedModels` array (populated during the panel stage in Task 07/08) is attached to the final `done` event alongside the synthesis `TokenUsage`. This gives the caller a complete picture: how many tokens were used, and which (if any) panel models failed.

#### Import restrictions (NFR-1)

Both files must only import from `src/domain/` and `src/application/` paths. Specifically:

- `synthesize-step.ts` imports: `ChatModelPort` and `ChatStreamEvent` from `src/domain/ports/chat-model-port.js`, `ChatRequest`/`ChatOptions` from `src/domain/model/chat-types.js`, `FusionRequest` from `src/domain/model/fusion-types.js`, `PanelResponse` from `src/domain/model/panel-types.js`, `Analysis` from `src/domain/services/analysis-schema.js`, `buildSynthesisPrompt` from `src/domain/services/prompt-builders.js`, `ModelRef` from `src/domain/model/fusion-types.js`, `Message` from `src/domain/model/message.js`.

- `run-fusion-use-case.ts` adds imports for: `ChatStreamEvent` from `src/domain/ports/chat-model-port.js` (if not already imported; may already import `ChatModelPort`). All existing domain imports from Task 03/08 are preserved.

No imports from `src/infrastructure/`, `openai`, `@anthropic-ai/sdk`, `hono`, `@hono/node-server`, or any other npm package.

## Files
- `src/application/usecases/synthesize-step.ts` (MODIFY) — Change `synthesize()` from an `async` method returning `Promise<string>` to an `async function*` generator returning `AsyncIterable<ChatStreamEvent>`. Replace `await this.chatModelPort.complete(chatRequest)` with `for await (const event of this.chatModelPort.stream(chatRequest)) { yield event; }`. Prompt-building logic (calling `buildSynthesisPrompt`, constructing `ChatRequest` with system prompt, temperature, and maxTokens) is preserved unchanged.
- `src/application/usecases/run-fusion-use-case.ts` (MODIFY) — Replace the buffered synthesis call (`const content = await this.synthesizeStep.synthesize(...)`) with `for await (const event of ...)` iteration. Pipe `ChatStreamEvent.token` → `FusionStreamEvent.content_delta`. Capture `ChatStreamEvent.done.usage` for the final done event. On `ChatStreamEvent.error`, log via `LoggerPort.logError`, yield `FusionStreamEvent.error`, and return. After the stream completes, yield `FusionStreamEvent.done` with captured `TokenUsage` and `failedModels`. Wrap the streaming iteration with `logStageStart('synthesis')` / `logStageEnd('synthesis', durationMs, usage)`.

## Test Expectations
- **SynthesizeStep returns async iterable**: When `synthesize()` is called with stubbed `ChatModelPort.stream()` that yields two `token` events (`{ type: 'token', text: 'Hello' }`, `{ type: 'token', text: ' world' }`) followed by a `done` event (`{ type: 'done', usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 } }`), iterating the returned async iterable yields exactly those three events in order. The `complete()` method on the stubbed port is never called.
- **SynthesizeStep preserves prompt construction**: When `synthesize()` is called with `panelResponses` containing two `PanelResponse` objects and no `analysis`, the `ChatRequest.messages` passed to `ChatModelPort.stream()` starts with a system message containing the output of `buildSynthesisPrompt(panelResponses)`. When `analysis` is provided, the prompt includes analysis content (via `buildSynthesisPrompt`).
- **SynthesizeStep forwards request options**: When `request.temperature` is `0.7` and `request.maxTokens` is `512`, the `ChatRequest.options` passed to `stream()` includes both `temperature: 0.7` and `maxTokens: 512`.
- **RunFusionUseCase yields content_delta per token**: With stubbed ports where `PanelRunner.run()` returns 2 panel responses and no failed models, `JudgeStep.analyze()` returns a valid `Analysis`, and `SynthesizeStep.synthesize()` yields 3 `token` events then a `done` event, iterating `runFusion()` yields: `progress` (panel), `progress` (judge), 3 `content_delta` events (one per token), then `done` with total usage and no `failedModels`.
- **RunFusionUseCase yields done with usage and failedModels**: When the panel stage produces 2 `failedModels` entries (partial failure) and the synthesis stream yields a `done` event with `usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }`, the final `FusionStreamEvent.done` has `usage` matching the synthesis usage and `failedModels` containing both entries from the panel stage.
- **RunFusionUseCase handles ChatStreamEvent.error**: When `SynthesizeStep.synthesize()` yields a `token` event followed by an `error` event (`{ type: 'error', code: 'STREAM_ERROR', message: 'connection lost' }`), iterating `runFusion()` yields the `content_delta` for the token, then a `FusionStreamEvent.error` with the same code and message, and the generator stops without yielding a `done` event. `LoggerPort.logError` is called with `'synthesis'` and an `Error` whose message is `'connection lost'`.
- **No done event without stream completion**: When the synthesis stream yields only `token` events and then stops without a `done` event (early termination, connection closed by server), the use case still yields a final `FusionStreamEvent.done` after the stream loop exits, with `usage` set to `undefined` and `failedModels` from the panel stage.
- **Synthesis stage logging**: `logStageStart('synthesis')` is called before the first iteration of the synthesis stream. `logStageEnd('synthesis', <durationMs>, <usage>)` is called after the stream loop exits (including when the stream ends without a `done` event), where `<durationMs>` is the wall-clock time between the two log calls and `<usage>` is the `TokenUsage` from the `done` event (or `undefined` if no `done` was yielded).
- **Progress events preserved**: The `progress` events for panel and judge stages (Task 08 behavior) are still yielded before the first synthesis `content_delta`. No `progress` event is yielded for the synthesis stage itself.
- **Zero infrastructure imports**: Running `grep -r "from 'openai'" src/application/` and `grep -r "from.*infrastructure" src/application/` returns no matches after the implementation.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
