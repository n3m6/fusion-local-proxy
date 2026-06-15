# Coverage Plan — Phase 4

## Phase-Scoped Criteria

| # | Criterion | Source | Action | Action Rationale | Planned Test File(s) |
|---|-----------|--------|--------|-----------------|----------------------|
| 1 | AC-11: `AnthropicChatAdapter` implements `ChatModelPort` via `@anthropic-ai/sdk` and is selected by `ChatAdapterFactory` when `provider.type === 'anthropic'`. The inbound `/v1/messages` route translates Anthropic-format requests to canonical, calls `FusionService`, and maps stream events to `message_start`/`content_block_delta`/`message_stop` SSE events. | Acceptance Criteria | reuse | Existing test suites from Tasks 09–10 comprehensively cover all sub-requirements: adapter behavior (20 tests), factory selection (8 tests), request translation + SSE encoding (49 tests), route integration (13 tests). 90/90 tests pass deterministically. No gaps requiring new tests. | `src/infrastructure/outbound/llm/anthropic-chat-adapter.test.ts`, `src/infrastructure/outbound/llm/chat-adapter-factory.test.ts`, `src/infrastructure/inbound/http/anthropic/translator.test.ts`, `src/infrastructure/inbound/http/anthropic/route.integration.test.ts` |
| 2 | NFR-2: Hono confinement — Hono must appear only in `src/infrastructure/inbound/http/`. | Non-Functional Requirements | new | No existing architectural-boundary tests exist for Hono confinement. A new grep-based static-analysis test file is created to enforce the Hono import boundary across all production source files. | `src/infrastructure/architectural-boundaries.test.ts` |
| 3 | NFR-3: SDK confinement — `openai` SDK used only in `OpenAiChatAdapter`; `@anthropic-ai/sdk` used only in `AnthropicChatAdapter`. | Non-Functional Requirements | new | No existing architectural-boundary tests exist for SDK confinement. A new grep-based static-analysis test file is created to enforce SDK import boundaries. Shares the same test file as NFR-2 with documented multi-criterion justification. | `src/infrastructure/architectural-boundaries.test.ts` |

## File Mapping

| Test File | Action | Criterion(s) | Test Type |
|-----------|--------|--------------|-----------|
| `src/infrastructure/outbound/llm/anthropic-chat-adapter.test.ts` | reuse | AC-11 | acceptance / integration |
| `src/infrastructure/outbound/llm/chat-adapter-factory.test.ts` | reuse | AC-11 | acceptance / integration |
| `src/infrastructure/inbound/http/anthropic/translator.test.ts` | reuse | AC-11 | acceptance / integration |
| `src/infrastructure/inbound/http/anthropic/route.integration.test.ts` | reuse | AC-11 | acceptance / integration |
| `src/infrastructure/architectural-boundaries.test.ts` | new | NFR-2, NFR-3 | boundary / arch-lint |

## Notes

- NFR-2 and NFR-3 share a single architectural-boundaries test file. This is justified because both criteria validate import-enforcement rules using identical grep-based static analysis methodology. Grouping them avoids duplicate file-system traversal.
- The architectural-boundaries test uses grep with known limitations (regex dialect dependency, PATH requirement, single-line import detection only) documented via static-guardrail comment in the test file.
- Test type is labeled `boundary/arch-lint` rather than `acceptance` because these tests verify code structure (import patterns), not runtime behavior.
