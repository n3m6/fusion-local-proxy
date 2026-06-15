---
total_phases: 5
completed_phases: [1, 2, 3]
---

## Phase 1 — Foundation Fix and Domain Services ✅ COMPLETED
- **Tasks:** 01, 02
- **Acceptance Criteria:** AC-1 (package.json scripts and dependencies), AC-2 (dependency rule maintained)
- **Replan Gate:**
  1. ✅ `package.json` contains exactly three scripts: `"dev": "tsx src/main.ts"`, `"start": "tsx src/main.ts"`, `"typecheck": "tsc --noEmit"`, and includes `@anthropic-ai/sdk: "^0.104.1"` in dependencies.
  2. ✅ `npm run typecheck` passes with zero errors.
  3. ✅ `curl POST /v1/chat/completions` with existing passthrough returns a valid ChatCompletion JSON response (system remains runnable).
  4. ✅ Domain service files (`analysis-schema.ts`, `judge-prompt.ts`, `synthesis-prompt.ts`) exist, compile, and have zero imports from `src/application/` or `src/infrastructure/`. Colocated test suites created (37 deterministic tests).

## Phase 2 — Ensemble Pipeline (Panel + Judge + Synthesis) ✅ COMPLETED
- **Tasks:** 03, 04, 05, 06
- **Acceptance Criteria:** AC-7 (PanelRunner parallel dispatch with all_panels_failed), AC-8 (JudgeStep graceful degradation), AC-9 (SynthesizeStep grounded responses), AC-4 (use-case orchestration), NFR-5 (graceful degradation)
- **Replan Gate:**
  1. ✅ When all panel models are configured, the `/v1/chat/completions` response content references at least one element from panel outputs and at least one element from judge analysis.
  2. ✅ When the judge model is unreachable or returns invalid JSON, the system returns a valid synthesis response (graceful degradation) and logs the judge failure via `LoggerPort.logError()`.
  3. ✅ `PanelRunner` throws `FusionError('all_panels_failed')` when every panel model fails.
- **Evidence:** 50 deterministic tests (Tasks 03–06), 240 total tests pass. Integration gate PASS. Acceptance gate PASS (5/5 criteria). Zero flaky, zero harness_noisy, zero ambiguous, zero redundant.

## Phase 3 — Streaming Synthesis ✅ COMPLETED
- **Tasks:** 07, 08
- **Acceptance Criteria:** AC-3 (ChatModelPort.stream()), AC-10 (SSE keep-alive + chat.completion.chunk + [DONE]), AC-12 (AbortController timeout), NFR-4 (streaming guarantees)
- **Replan Gate:**
  1. ✅ A `curl` request with `stream: true` to `/v1/chat/completions` receives SSE `data:` lines with `object: "chat.completion.chunk"` payloads, terminated by `data: [DONE]`, with keep-alive comments visible before the first content chunk.
  2. ✅ A per-call timeout correctly cancels the upstream LLM call via `AbortController` and surfaces the cancellation.
- **Evidence:** 92 deterministic tests (Tasks 07–08), 277 total tests pass (up from 240). Integration gate PASS. Acceptance gate PASS (4/4 criteria: AC-3, AC-10, AC-12, NFR-4). Zero flaky, zero harness_noisy, zero ambiguous, zero redundant. Streaming infrastructure end-to-end verified, non-streaming path preserved.
- **Replan Amendment (Phase 2 → Phase 3):** Task 08 scope expanded to include upgrading `SynthesizeStep` from `ChatModelPort.complete()` (buffered) to `ChatModelPort.stream()` (incremental token streaming). Without this change, synthesis output is a single buffered chunk regardless of SSE framing. The amendment stays within the existing architectural boundaries — `SynthesizeStep` already depends on `ChatModelPort`, and `stream()` is the same port's incremental method. See `phase-02/replan/replan-note.md`.
- **Replan Amendment (Phase 3 → Phase 4):** `sse-encoder.test.ts` was created in Task 08 (Phase 3) as part of the SSE encoder work, shifting it from its originally planned location in Task 13 (Phase 5). The file contains 12 deterministic tests covering keep-alive comments, `chat.completion.chunk` format, `[DONE]` termination, error handling, id/created consistency, and edge cases. Task 13's scope is reduced: `sse-encoder.test.ts` is changed from CREATE to VERIFY-EXTEND (or skip if existing coverage is sufficient). See `phase-03/replan/replan-note.md`.

## Phase 4 — Anthropic API Compatibility
- **Tasks:** 09, 10
- **Acceptance Criteria:** AC-11 (AnthropicChatAdapter + /v1/messages route + 6-event SSE sequence), NFR-2 (Hono confinement), NFR-3 (SDK confinement)
- **Replan Gate:**
  1. A `curl` request to `POST /v1/messages` with an Anthropic-format body receives SSE events in documented sequence: `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`, using both `event:` and `data:` SSE fields.
  2. `ChatAdapterFactory.create()` returns an `AnthropicChatAdapter` for `provider.type === 'anthropic'` and the adapter correctly maps canonical request/response types without leaking Anthropic-specific shapes into domain or application layers.

## Phase 5 — Polish (Wiring, Tests, Documentation)
- **Tasks:** 11, 12, 13, 14
- **Acceptance Criteria:** AC-13 (structured logging), AC-14 (domain + application unit tests), AC-15 (README + example config), NFR-7 (observability)
- **Replan Gate:**
  1. `ConsoleLoggerAdapter` emits structured log lines for each stage containing stage name, duration in ms, token counts, and `failed_models` array with model identifier, error code, and truncated message (≤200 chars).
  2. `npm test` executes domain-layer unit tests (zero mocks required) and application-layer unit tests (stubbed ports) with ≥80% branch coverage on `src/domain/` and `src/application/`.
