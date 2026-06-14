All 31 outbound-adapter tests pass individually. Now I have a complete picture. Let me compile the final review.

---

### Status — FAIL

### Findings
| # | Severity | File | Lines | Category | Issue | Recommendation |
|---|----------|------|-------|----------|-------|----------------|
| 1 | HIGH | `src/infrastructure/outbound/llm/openai-chat-adapter.test.ts` | 335–353 | Test quality | **"completes without options" test does not capture SDK params.** The mock drops the params argument and assertions only check response shape (content, model). The test name promises "without options" but nothing verifies that `temperature` and `max_tokens` are absent from the SDK call. Every other test in this file captures params via `capturedParams`; this one is inconsistent. The implementation currently includes `temperature: undefined` and `max_tokens: undefined` in the params object — this test cannot detect that gap. | REWRITE |
| 2 | MEDIUM | `src/infrastructure/outbound/config/json-file-config-adapter.test.ts` | 6–38 | Coverage | **No test for empty `apiKeyEnv` variable.** The spec requires environment variables referenced by `apiKeyEnv` to exist *and be non-empty*. The "missing env var" test (line ~161) only verifies the variable is absent (`delete`). No test sets the env var to `""` (empty string). The code handles this via `if (!apiKey)`, but the spec-required behavior is untested. | ADD |
| 3 | MEDIUM | `src/infrastructure/outbound/config/json-file-config-adapter.test.ts` | 1–313 | Coverage | **No test for multiple panel providers.** The spec explicitly states "Multiple panel providers are allowed." All valid-config tests use exactly one panel. No test verifies that `getPanelModels()` returns multiple entries when multiple `role: "panel"` providers are configured. | ADD |
| 4 | MEDIUM | `src/infrastructure/outbound/config/json-file-config-adapter.test.ts` | 40–313 | Isolation | **`process.env` mutated without concurrency guard.** Multiple tests set and `delete` the same `process.env.OPENAI_API_KEY`. Node test runner runs subtests concurrently by default (Node ≥22). Two tests manipulating the same global can interleave and cause spurious failures. | REWRITE |
| 5 | MEDIUM | `src/infrastructure/outbound/logging/console-logger-adapter.test.ts` | 14–24 | Isolation | **`console.log` replaced globally via `captureConsole` helper.** Node test runner concurrency means two tests capturing console output simultaneously will intercept each other's lines, producing flaky or incorrect assertions. | REWRITE |
| 6 | MEDIUM | `src/infrastructure/outbound/llm/chat-adapter-factory.test.ts` | 6–31 | Coverage | **Factory tests do not verify OpenAI client configuration.** The factory's primary responsibility is constructing the SDK client with `baseURL` and `apiKey` from the `ModelRef`. Tests only check `instanceof OpenAiChatAdapter` — nothing asserts the client was configured with the correct values. If the factory accidentally hardcodes a URL or drops the key, tests still pass. | ADD |
| 7 | LOW | `src/infrastructure/outbound/config/json-file-config-adapter.test.ts` | 1–313 | Coverage | **No test for invalid `timeoutMs` values.** The spec says `timeoutMs` must be a positive integer. No test verifies that negative, zero, or non-integer values are rejected at construction (zod `.positive()` should reject ≤0, but this is untested). | ADD |
| 8 | LOW | `src/infrastructure/outbound/logging/console-logger-adapter.test.ts` | 1–120 | Coverage | **No test for empty `FailedModelInfo[]`.** Calling `logFailedModels([])` should emit nothing. The edge case is untested. | ADD |
| 9 | LOW | `src/infrastructure/outbound/llm/chat-adapter-factory.test.ts` | 35–49 | Test quality | **Third factory test is redundant and contains a type-shape-only assertion.** `typeof adapter.complete === 'function'` is a type-shape check already implied by the `instanceof` assertion in the first test. Adds no behavioral coverage. | DELETE |

### Notes

1. **Finding #1 is the gate-fail driver.** The `completes without options` test passes without verifying the core behavioral contract (no temperature/max_tokens sent). The implementation currently spreads `temperature: undefined` and `max_tokens: undefined` into the SDK params object when `options` is absent — a behavior the test should catch but doesn't. The other 9 tests in the same file use a `capturedParams` pattern; this one must adopt it.

2. The `OPENAI_API_KEY` env-var manipulation in the config-adapter tests and the `console.log` monkey-patching in the logger tests are both pre-existing patterns from earlier tasks. They are not new to task 04, but the review must flag them as isolation risks under the "Test isolation" rule.

3. The spec field-name inconsistency (`schema` vs. `jsonSchema` in `ResponseFormat`) was resolved in-task: `chat-types.ts` renamed the field to `jsonSchema`, and both the adapter and its tests use `jsonSchema` consistently. No action needed.
