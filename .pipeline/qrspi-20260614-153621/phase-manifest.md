---
total_phases: 5
---

## Phase 1 — Core Passthrough

- **Tasks:** 01
- **Acceptance Criteria:** AC-1, AC-2, AC-3 (complete signature), AC-4, AC-5, AC-6
- **Replan Gate:**
  1. A real OpenAI-compatible client (e.g., `curl`) receives a valid `ChatCompletion` JSON response through `POST /v1/chat/completions` with streaming disabled.
  2. `src/domain/` contains zero imports from `src/application/` and `src/infrastructure/`; `src/application/` contains zero imports from `src/infrastructure/` (verified by grep or tooling).

## Phase 2 — Ensemble Pipeline

- **Tasks:** 02, 03
- **Acceptance Criteria:** AC-7, AC-8, AC-9
- **Replan Gate:**
  1. When all three panel models are configured and reachable, the `/v1/chat/completions` response content references at least one element from the panel outputs and at least one element from the judge analysis (`consensus`, `contradiction`, `unique_insight`, or `blind_spot`).
  2. When the judge model is unreachable, the system still returns a valid synthesis response (graceful degradation) and logs the judge failure with error details.

## Phase 3 — Streaming Synthesis

- **Tasks:** 04
- **Acceptance Criteria:** AC-3 (stream signature), AC-10, AC-12
- **Replan Gate:**
  1. A `curl` request with `stream: true` to `/v1/chat/completions` receives SSE `data:` lines with `object: "chat.completion.chunk"` payloads, terminated by `data: [DONE]`, with keep-alive comments (`: panel running`, `: judging`) visible in the stream before the first content chunk.
  2. A per-call timeout of 30 seconds (configurable) correctly cancels the upstream LLM call via `AbortController` and surfaces the cancellation as a `FusionError` in the stream metadata.

## Phase 4 — Anthropic API Compatibility

- **Tasks:** 05
- **Acceptance Criteria:** AC-11
- **Replan Gate:**
  1. A `curl` request to `POST /v1/messages` with an Anthropic-format body (including `max_tokens`, `messages`, and `model`) receives SSE events in the documented sequence: `message_start`, `content_block_start`, `content_block_delta` (multiple), `content_block_stop`, `message_delta`, `message_stop`, using both `event:` and `data:` SSE fields.
  2. The Anthropic outbound adapter correctly calls an Anthropic-compatible backend and maps the canonical request/response types without leaking Anthropic-specific shapes into the domain or application layers.

## Phase 5 — Polish

- **Tasks:** 06, 07, 08, 09
- **Acceptance Criteria:** AC-13, AC-14, AC-15
- **Replan Gate:**
  1. `ConsoleLoggerAdapter` emits structured log lines for each stage (panel, judge, synthesis) containing: stage name, duration in milliseconds, token counts (prompt + completion), and for panel: `failed_models` array with model identifier, error code, and truncated message (≤200 chars).
  2. `npm test` executes domain-layer unit tests (zero mocks required) and application-layer unit tests (stubbed ports) with ≥80% branch coverage on `src/domain/` and `src/application/`.
