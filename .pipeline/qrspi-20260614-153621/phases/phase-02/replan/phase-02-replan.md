### Status — PASS

# Replan After Phase 2

## What Changed
Task 08 scope expanded to include upgrading `SynthesizeStep` from `ChatModelPort.complete()` (buffered, single response) to `ChatModelPort.stream()` (incremental token streaming). The corresponding test file (`synthesize-step.test.ts`) must migrate stubs from `complete()` to `stream()`.

## Why It Changed
Phase 2 delivered `SynthesizeStep` using `complete()`, which buffers the entire synthesis response. The `synthesize()` method calls `this.chatPort.complete(request)`, receives a single `ChatResponse`, and yields it as one monolithic `content_delta`. 

Without the upgrade, even after Task 07 adds `ChatModelPort.stream()` and Task 08 creates the SSE encoder and route SSE path, the streaming output would be a single large chunk rather than incremental tokens. The SSE encoder infrastructure would work correctly (proper framing, keep-alive comments, `[DONE]` termination), but synthesis would not be truly streamed — it would be a single buffered chunk. This violates the spirit of Phase 3's goal ("Streamed synthesis via SSE") and would produce a poor client experience.

The upgrade stays within the existing architectural boundaries:
- `ChatModelPort.stream()` is already being added by Task 07 (same port, same contract).
- `SynthesizeStep.synthesize()` already yields `AsyncIterable<FusionStreamEvent>` — only the internal LLM call mechanism changes.
- No constructor change, no new dependencies, no new files.
- The `RunFusionUseCase` orchestration already forwards `content_delta` events iteratively — no change needed there.

## Design Amendments
- **Task 08 files list:** Added `src/application/usecases/synthesize-step.ts (MODIFY)` and `src/application/usecases/synthesize-step.test.ts (MODIFY)` to the task scope.
- **SynthesizeStep.synthesize():** Internal implementation changed from `await this.chatPort.complete(request)` to `for await (const chunk of this.chatPort.stream(request))`. All other behavior (prompt building, logging, timeout, AbortController cleanup, event sequence) is preserved.
- **SynthesizeStep test stubs:** `StubChatModelPort` must implement `stream()` returning `AsyncIterable<ChatStreamChunk>` instead of `complete()`. Test expectations (event types, order, logging, error propagation) are preserved.

## Technical Debt Assessment
- **Safe for next phase:** The DI container (`container.ts`) requires no changes — `SynthesizeStep` constructor signature is unchanged. The `PanelRunner` and `JudgeStep` still use `complete()` correctly. The `OpenAiChatAdapter.complete()` method is preserved unchanged alongside the new `stream()` method.
- **Risk requiring mitigation:** If the SynthesizeStep stub migration in `synthesize-step.test.ts` is done incorrectly, the 13 existing tests from Phase 2 may fail. Mitigation: the task spec explicitly requires all 13 existing test expectations to pass with the new stream-based stubs. Test-by-test verification is part of the task review gate.

## Next Phase Ready
- Phase 3 — Streaming Synthesis. Delivers: `ChatModelPort.stream()` + `ChatStreamChunk` (Task 07, domain-only), `OpenAiChatAdapter.stream()` + SynthesizeStep stream upgrade + OpenAI SSE encoder + route SSE path (Task 08). Proves: end-to-end SSE streaming with `chat.completion.chunk` payloads, keep-alive comments during panel/judge, `[DONE]` termination, and AbortController-based timeout cancellation.
