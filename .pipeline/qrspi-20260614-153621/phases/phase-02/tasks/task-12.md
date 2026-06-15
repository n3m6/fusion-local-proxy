# Task 12: Domain-layer unit tests

## Metadata
- **Task:** 12
- **Phase:** 5
- **Route:** full
- **Slice:** Slice 6 (Domain Tests)

## Dependencies
- **Task 02** — Provides `analysisSchema` and inferred `Analysis` type from `src/domain/services/analysis-schema.ts`, `buildJudgeSystemPrompt`/`buildJudgeUserPrompt` from `src/domain/services/judge-prompt.ts`, and `buildSynthesisSystemPrompt`/`buildSynthesisUserPrompt` from `src/domain/services/synthesis-prompt.ts`.
- **Task 03** — Provides `PanelResult` and `PanelMeta` interfaces (plus the imported `FailedModelInfo`) in `src/domain/model/fusion-types.ts`, as well as the `all_panels_failed` error code convention on `FusionError`.
- **Task 04** — Ensures the `analysisSchema` and `judge-prompt.ts` domain artifacts are integrated and validated through the `JudgeStep` application use case before domain unit tests lock in their behavior.
- **Task 05** — Ensures the `synthesis-prompt.ts` domain artifact is integrated and validated through the `SynthesizeStep` application use case before domain unit tests lock in its behavior.

## Traceability
- **Acceptance Criteria:** AC-14
- **NFRs:** NFR-1 (domain tests import only from domain layer)
- **Replan Gate Criteria:** Phase 5 Gate 2 (≥80% branch coverage on domain layer)

## Source Traceability
- **Goals:** AC-14
- **Plan:** Task 12, Phase 5 — Polish (Wiring, Tests, Documentation)
- **Design:** Slice 6 (Observability, Tests, and Documentation)
- **Structure:** Slice 6 — `src/domain/services/analysis-schema.test.ts`, `src/domain/services/judge-prompt.test.ts`, `src/domain/services/synthesis-prompt.test.ts`, `src/domain/model/fusion-types.test.ts` (MODIFY)

## Description

Phase 1 Task 02 already delivered 37 deterministic unit tests across the three domain service test files:
- `analysis-schema.test.ts` — 6 tests covering valid input, missing required fields, malformed field types, empty valid input, and domain purity.
- `judge-prompt.test.ts` — 10 tests covering system prompt shape/content, user prompt inclusion of model identifiers and original message content, edge cases (empty panel results, no user-role messages), and domain purity.
- `synthesis-prompt.test.ts` — 21 tests covering system prompt grounding/consensus/contradiction instructions, user prompt with full analysis fields, null-analysis fallback path, and domain purity.

This task **verifies** all 37 existing tests continue to pass after Tasks 03–05 have landed, **extends** coverage where existing suites fall short of the ≥80% branch coverage gate, and **adds** new test blocks for domain model types introduced by Task 03 (`PanelResult`, `PanelMeta`, `FusionError` `all_panels_failed` code) into the existing `fusion-types.test.ts`.

Every test file uses `node:test` and `node:assert/strict` and imports only from `src/domain/` — no imports from `src/application/` or `src/infrastructure/`, and no mocks or stubs required (pure logic only).

### analysis-schema.test.ts (VERIFY-EXTEND)

Verify the 6 existing tests from Phase 1 pass. The schema validates structured `Analysis` objects with four fields: `consensus` (`string[]`), `contradictions` (`{ topic, perspectives }[]`), `unique_insights` (`{ model, insight }[]`), and `blind_spots` (`string[]`). Extend coverage with additional edge cases if branch coverage is below 80%: malformed sub-fields (e.g., `topic` as a number, missing `perspectives`), nested unknown field stripping, and `safeParse` behavior when `unique_insights` entries are missing `model` or `insight`.

### judge-prompt.test.ts (VERIFY-EXTEND)

Verify the 10 existing tests from Phase 1 pass. Extend coverage for: messages containing only `system` and `assistant` roles (no user-role messages — strengthen existing coverage), panel results with `content` containing special characters / multi-line text, and `buildJudgeUserPrompt` output format consistency.

### synthesis-prompt.test.ts (VERIFY-EXTEND)

Verify the 21 existing tests from Phase 1 pass. Extend with: `buildSynthesisUserPrompt` with `null` analysis excluding `consensus`, `contradiction`, `blind_spot`, and `unique_insight` terminology (case-insensitive check — confirms null path does not leak analysis language), panel results with empty `content`, and analysis object where individual arrays are empty.

### fusion-types.test.ts (MODIFY)

Add tests for the `PanelResult`, `PanelMeta`, and `FusionError` types appended by Task 03. Verify that objects conforming to `PanelResult` have all five required fields (`modelId`, `provider`, `content`, `usage`, `latencyMs`) with correct types. Verify that `PanelMeta` contains `results: PanelResult[]` and `failedModels: FailedModelInfo[]` with conforming shapes. Verify that `FusionError` accepts `'all_panels_failed'` as a valid code, preserving it in the `code` property, and retains the existing constructor behavior (name, message, optional details). Do not duplicate or remove the existing `FusionError` tests; append new test blocks.

## Files
- `src/domain/services/analysis-schema.test.ts` (MODIFY / VERIFY-EXTEND) — Existing 6-test suite from Phase 1 Task 02. Verify all pass; extend with malformed sub-field rejection, nested unknown field stripping, and missing `model`/`insight` on `unique_insights` entries.
- `src/domain/services/judge-prompt.test.ts` (MODIFY / VERIFY-EXTEND) — Existing 10-test suite from Phase 1 Task 02. Verify all pass; extend with no-user-role edge case coverage, special characters in content, and output format consistency checks.
- `src/domain/services/synthesis-prompt.test.ts` (MODIFY / VERIFY-EXTEND) — Existing 21-test suite from Phase 1 Task 02. Verify all pass; extend with null-analysis terminology exclusion, empty content edge case, and empty-analysis sub-array handling.
- `src/domain/model/fusion-types.test.ts` (MODIFY) — Append test blocks: `PanelResult` object shape has `modelId`, `provider`, `content`, `usage: { promptTokens, completionTokens }`, `latencyMs` all present and correctly typed; `PanelMeta` shape validates `results: PanelResult[]` and `failedModels: FailedModelInfo[]`; `FusionError` code `'all_panels_failed'` constructs successfully and stores that code; retain all existing `FusionError` tests unchanged.

## Test Expectations
- **[analysis-schema] Existing 6 tests pass:** All 6 tests from the Phase 1 task-02 analysis-schema.test.ts suite pass without modification after Tasks 03–05 have landed.
- **[analysis-schema] Valid payload passes:** When `safeParse` receives an object with all four required fields (`consensus` non-empty array, `contradictions` array with `topic`/`perspectives` entries, `unique_insights` array with `model`/`insight` entries, `blind_spots` non-empty array), expect `safeParse` to return `{ success: true }` and `data` to contain the provided values.
- **[analysis-schema] Missing consensus fails:** When `safeParse` receives an object without the `consensus` field (all other fields present and valid), expect `safeParse` to return `{ success: false }` with a `ZodError`.
- **[analysis-schema] Malformed contradictions fails:** When `safeParse` receives an object where `contradictions` is an array of strings (not objects with `topic`/`perspectives`), expect `safeParse` to return `{ success: false }`.
- **[analysis-schema] Empty blind_spots accepted:** When `safeParse` receives an object where `blind_spots` is an empty array, expect `safeParse` to return `{ success: true }`.
- **[analysis-schema] Extra fields ignored:** When `safeParse` receives a fully valid payload plus an additional top-level field not defined in the schema (e.g., `extra: 123`), expect `safeParse` to return `{ success: true }` and the extra field to be absent from `data` (stripped by Zod).
- **[judge-prompt] Existing 10 tests pass:** All 10 tests from the Phase 1 task-02 judge-prompt.test.ts suite pass without modification after Tasks 03–05 have landed.
- **[judge-prompt] System prompt is non-empty:** When `buildJudgeSystemPrompt()` is called, expect the return value to be a non-empty string.
- **[judge-prompt] User prompt contains model identifiers:** When `buildJudgeUserPrompt` is called with `panelResults` containing entries with `modelId` values `"gpt-4o"` and `"claude-haiku"`, expect the returned string to contain both `"gpt-4o"` and `"claude-haiku"`.
- **[judge-prompt] User prompt contains original user message:** When `buildJudgeUserPrompt` is called with `originalMessages` containing a `Message` with `role: 'user'` and `content: 'What is the capital of France?'`, expect the returned string to contain the substring `"What is the capital of France?"`.
- **[judge-prompt] Empty panel results:** When `buildJudgeUserPrompt` is called with an empty `panelResults` array and `originalMessages` containing a valid user message, expect the function to return a non-empty string (no throw).
- **[judge-prompt] No user-role messages:** When `buildJudgeUserPrompt` is called with `originalMessages` containing only `system` and `assistant` role messages, expect the function to return a non-empty string (no throw).
- **[synthesis-prompt] Existing 21 tests pass:** All 21 tests from the Phase 1 task-02 synthesis-prompt.test.ts suite pass without modification after Tasks 03–05 have landed.
- **[synthesis-prompt] System prompt is non-empty:** When `buildSynthesisSystemPrompt()` is called, expect the return value to be a non-empty string.
- **[synthesis-prompt] With analysis includes consensus:** When `buildSynthesisUserPrompt` is called with a valid `Analysis` whose `consensus` array contains `"Models agree on X"`, expect the returned string to contain `"Models agree on X"`.
- **[synthesis-prompt] With analysis includes contradiction topic:** When `buildSynthesisUserPrompt` is called with a valid `Analysis` whose `contradictions` array contains an entry with `topic: "disagreement on Y"`, expect the returned string to contain `"disagreement on Y"`.
- **[synthesis-prompt] With analysis includes unique insight:** When `buildSynthesisUserPrompt` is called with a valid `Analysis` whose `unique_insights` contains `{ model: "gpt-4o", insight: "novel point Z" }`, expect the returned string to contain `"novel point Z"`.
- **[synthesis-prompt] With analysis includes blind spot:** When `buildSynthesisUserPrompt` is called with a valid `Analysis` whose `blind_spots` contains `"missed angle W"`, expect the returned string to contain `"missed angle W"`.
- **[synthesis-prompt] Null analysis includes panel results only:** When `buildSynthesisUserPrompt` is called with `analysis: null` and `panelResults` containing an entry with `content: "panel output text"`, expect the returned string to contain `"panel output text"`.
- **[synthesis-prompt] Null analysis excludes analysis-specific terminology:** When `buildSynthesisUserPrompt` is called with `analysis: null` and a non-empty `panelResults` array, expect the returned string NOT to contain the words `"consensus"`, `"contradiction"`, `"blind_spot"`, or `"unique_insight"` (case-insensitive check on section-like headers discouraged; at minimum the returned string must not reference analysis fields as if they were present).
- **[fusion-types] PanelResult shape:** Construct an object conforming to `PanelResult` with `modelId: "test-model"`, `provider: "openai"`, `content: "result"`, `usage: { promptTokens: 10, completionTokens: 5 }`, and `latencyMs: 100`. Verify that `modelId` is a string, `provider` is a valid `ProviderType`, `content` is a string, `usage.promptTokens` and `usage.completionTokens` are numbers, and `latencyMs` is a number.
- **[fusion-types] PanelMeta shape:** Construct a `PanelMeta` with a `results` array containing a valid `PanelResult` and a `failedModels` array containing a `FailedModelInfo` with `modelId`, `errorCode`, and `errorMessage`. Verify that `results` is an array, `failedModels` is an array, and each element of `failedModels` has the three expected string fields.
- **[fusion-types] FusionError all_panels_failed code:** Construct `new FusionError('all_panels_failed', 'Every panel model failed')`. Verify `err.code` equals `'all_panels_failed'`, `err.name` equals `'FusionError'`, and `err.message` equals `'Every panel model failed'`.
- **[fusion-types] Existing FusionError tests preserved:** The existing tests for `FusionError` (constructor with details, constructor without details) must pass unchanged after the new test blocks are appended.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.

## Review Status
- **State:** clean (round 3)
- **Outstanding Concerns:** None.
