# Task 16: Domain-layer unit tests

## Metadata
- **Task:** 16
- **Phase:** 5
- **Route:** full
- **Slice:** Observability, Tests, and Documentation

## Dependencies
- **Task 15** ensures the project is in a runnable Phase 5 state with enhanced logging (`ConsoleLoggerAdapter`) and the DI container wired for observability. Task 16 installs `vitest` as a dev dependency, adds `npm test`, and writes all tests; it uses vitest (`describe`/`it`/`expect`) for all tests and requires the domain source files created in earlier tasks to exist: `src/domain/model/fusion-types.ts` (Task 01 — provides `FusionError`, `ModelRef`, `FusionStreamEvent`), `src/domain/model/stream-types.ts` (Task 01 — provides `FusionStreamEvent`), `src/domain/services/analysis-schema.ts` (Task 06 — provides `analysisSchema`, `safeParseAnalysis`, inferred types), `src/domain/services/prompt-builders.ts` (Task 06 — provides `buildSynthesisPrompt`), `src/domain/services/judge-prompt-builder.ts` (Task 06 — provides `buildJudgePrompt`), and `src/domain/model/panel-types.ts` (Task 06 — provides `PanelResponse`, `PanelResult`). All of these source files are pure domain code; the tests import only from these domain modules and from `vitest` — no infrastructure, application, or mock imports.

## Traceability
- **Acceptance Criteria:** AC-14
- **NFRs:** NFR-1
- **Replan Gate Criteria:** Phase 5 Gate 2 (domain test coverage)

## Source Traceability
- **Goals:** AC-14 (domain-layer unit tests exercise Analysis schema validation, prompt builder output shapes, and FusionError codes using only domain types with no mocks needed)
- **Plan:** Task 16, Phase 5 — Polish
- **Design:** Slice 6 — Observability, Tests, and Documentation
- **Structure:** Slice 6 — `vitest.config.ts`, `src/domain/model/__tests__/fusion-types.spec.ts`, `src/domain/services/__tests__/analysis-schema.spec.ts`, `src/domain/services/__tests__/prompt-builders.spec.ts`

## Description

Create the Vitest configuration and write three domain-layer test files that exercise `FusionError` construction, `Analysis` schema validation, and prompt builder output shapes. All tests are **pure** — zero mocks, zero stubs, zero infrastructure imports. They exercise domain code exactly as it is exported from the source modules. The test framework is **vitest** using `describe`/`it`/`expect` with globals enabled.

Before writing tests, install `vitest` as a dev dependency and add a `"test": "vitest run"` script to `package.json`. The `vitest.config.ts` at the project root configures globals and the include pattern.

---

### 1. Vitest configuration (`vitest.config.ts` — CREATE)

Create the project-level Vitest configuration at the repository root:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
```

- **`globals: true`** — makes `describe`, `it`, `expect`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `vi` available globally without per-file imports. Test files can use them directly.
- **`include: ['src/**/*.spec.ts']`** — only runs files ending in `.spec.ts` under `src/`. This matches the `__tests__/` convention used by all test files in this task.
- **`environment: 'node'`** — Node.js environment; no browser or jsdom needed since these are pure logic tests.

---

### 2. FusionError and ModelRef tests (`src/domain/model/__tests__/fusion-types.spec.ts` — CREATE)

Tests the `FusionError` class and `ModelRef` interface exported from `src/domain/model/fusion-types.ts`. These tests are pure: they import only from `../fusion-types.js` and `vitest` (via globals).

**Test file structure:**

```
describe('FusionError')
  describe('constructor')
    it('sets code, message, and details when all three are provided')
    it('sets details to undefined when omitted')
    it('sets the name property to "FusionError"')
    it('is an instance of Error')
    it('preserves the stack trace')

describe('ModelRef')
  describe('shape')
    it('accepts a valid ModelRef object with all required fields')
    it('requires provider to be "openai" or "anthropic" at the type level')
```

**Specific test behaviors:**

- **`FusionError` constructor sets `code`, `message`, and `details`**: Construct `new FusionError('ALL_FAILED', 'All panel models failed', { panelCount: 3 })`. Assert `error.code === 'ALL_FAILED'`, `error.message === 'All panel models failed'`, and `error.details` deep-equals `{ panelCount: 3 }`.

- **`FusionError` constructor with omitted `details`**: Construct `new FusionError('TIMEOUT', 'Request timed out')` (two arguments only). Assert `error.code === 'TIMEOUT'`, `error.message === 'Request timed out'`, and `error.details` is `undefined`.

- **`FusionError.name` is `'FusionError'`**: After constructing any `FusionError`, assert `error.name === 'FusionError'`. This ensures the `this.name` assignment in the constructor works and the error identity is preserved for consumers that check `error.name`.

- **`FusionError` instanceof `Error`**: Assert `error instanceof Error` is `true`. This is the fundamental requirement that `FusionError` can be caught in `catch (e)` blocks that expect `Error`.

- **`FusionError` preserves stack trace**: Construct a `FusionError` and assert `error.stack` is a non-empty string. The stack trace must exist and contain the class name or file reference.

- **`ModelRef` shape acceptance**: Declare a variable `const ref: ModelRef = { provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' }`. Assert `ref.provider === 'openai'` and all other fields match. This is a compile-time + runtime check that `ModelRef` requires exactly the four fields `provider`, `model`, `baseURL`, `apiKey`.

- **`FusionStreamEvent` discriminated union variants**: Import `FusionStreamEvent` from `../stream-types.js`. Test that each of the five variant shapes is assignable to `FusionStreamEvent`:
  - `{ type: 'progress', stage: 'panel', message: 'Panel running' }`
  - `{ type: 'content_delta', delta: 'Hello' }`
  - `{ type: 'content_stop' }`
  - `{ type: 'done', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }`
  - `{ type: 'error', code: 'ERR', message: 'failed' }`
  Each object literal assigned to a `const ev: FusionStreamEvent = ...` must compile and have the correct `type` discriminator value.

---

### 3. Analysis schema tests (`src/domain/services/__tests__/analysis-schema.spec.ts` — CREATE)

Tests the Zod `analysisSchema` and the `safeParseAnalysis` function exported from `src/domain/services/analysis-schema.ts`. These are pure domain tests: the `analysis-schema.ts` module imports `zod`, which is the only permitted SDK import in the domain layer. The test file itself imports from `../analysis-schema.js` and `vitest` globals — no mocks, no stubs.

**Test file structure:**

```
describe('analysisSchema')
  describe('safeParse (valid)')
    it('accepts a complete Analysis with all fields populated')
    it('accepts an Analysis with empty contradictions array')
    it('accepts an Analysis with empty uniqueInsights array')
    it('accepts an Analysis with empty blindSpots array')
    it('accepts an Analysis with all empty arrays')
  describe('safeParse (invalid)')
    it('rejects an object missing consensus')
    it('rejects an object missing contradictions')
    it('rejects an object missing uniqueInsights')
    it('rejects an object missing blindSpots')
    it('rejects a contradiction missing sourceA')
    it('rejects a contradiction missing sourceB')
    it('rejects a contradiction missing description')
    it('rejects a uniqueInsight missing source')
    it('rejects a uniqueInsight missing insight')

describe('safeParseAnalysis')
  describe('valid JSON inputs')
    it('parses a complete valid Analysis JSON string and returns success: true')
    it('parses an Analysis with empty arrays and returns success: true')
  describe('invalid JSON inputs')
    it('returns success: false for malformed JSON (unparseable string)')
    it('returns success: false for valid JSON that fails schema validation')
    it('returns success: false for an empty string')
    it('returns success: false for a JSON string representing a non-object (array, number, null)')
  describe('return shape')
    it('on success returns { success: true, data } with data matching Analysis type')
    it('on failure returns { success: false, error } with a non-empty error string')
    it('never throws — all failure paths return { success: false }')
```

**Specific test behaviors:**

- **Accepts complete Analysis**: Call `analysisSchema.safeParse({ consensus: 'Models agree the sky is blue', contradictions: [{ sourceA: 'gpt-4o', sourceB: 'claude', description: 'Disagree on shade' }], uniqueInsights: [{ source: 'gpt-4o', insight: 'Mentioned wavelength' }], blindSpots: ['humidity'] })`. Assert `result.success === true` and `result.data.consensus === 'Models agree the sky is blue'`.

- **Accepts Analysis with empty arrays**: Call `analysisSchema.safeParse({ consensus: 'All models agree', contradictions: [], uniqueInsights: [], blindSpots: [] })`. Assert `result.success === true`.

- **Rejects missing required fields**: For each of the four required top-level fields (`consensus`, `contradictions`, `uniqueInsights`, `blindSpots`), pass an object omitting that field to `analysisSchema.safeParse()`. Assert `result.success === false`.

- **Rejects malformed sub-object in arrays**: Pass an object where `contradictions` contains `[{ sourceA: 'only-one-field' }]` (missing `sourceB` and `description`). Assert `result.success === false`. Similarly, pass `uniqueInsights: [{ source: 'only-one-field' }]` (missing `insight`). Assert `result.success === false`.

- **`safeParseAnalysis` parses valid JSON**: Call `safeParseAnalysis('{"consensus":"yes","contradictions":[],"uniqueInsights":[],"blindSpots":[]}')`. Assert `result.success === true` and `result.data.consensus === 'yes'`.

- **`safeParseAnalysis` rejects malformed JSON**: Call `safeParseAnalysis('not json')`. Assert `result.success === false` and `typeof result.error === 'string'` with `result.error.length > 0`. The function must not throw.

- **`safeParseAnalysis` rejects valid JSON that fails schema**: Call `safeParseAnalysis('{"consensus":"yes"}')` (object is valid JSON but missing three required array fields). Assert `result.success === false` and `error` is a non-empty string. The function must not throw.

- **`safeParseAnalysis` rejects empty string**: Call `safeParseAnalysis('')`. Assert `result.success === false`. The function must not throw.

- **`safeParseAnalysis` rejects non-object JSON**: Call `safeParseAnalysis('42')`, `safeParseAnalysis('[]')`, `safeParseAnalysis('null')`. Each returns `{ success: false }` without throwing. (The implementation may handle these via JSON parsing or zod validation — the contract is only that they return failure.)

- **Inferred types (`Analysis`, `Contradiction`, `UniqueInsight`) are exported**: These are compile-time checks. The test file should import them with `import type { Analysis, Contradiction, UniqueInsight } from '../analysis-schema.js'` and declare variables typed with them to verify they compile.

- **Error message is descriptive**: On schema failure, the `error` string includes context about which fields failed (e.g., contains the word "consensus" or "contradictions" or "required"). This is not a strict assertion but a quality check — the error message should be readable enough to diagnose validation failures in production logs.

---

### 4. Prompt builder tests (`src/domain/services/__tests__/prompt-builders.spec.ts` — CREATE)

Tests `buildSynthesisPrompt` (from `prompt-builders.ts`) and `buildJudgePrompt` (from `judge-prompt-builder.ts`). These are pure function tests — no mocks, no I/O. The test file imports the functions, calls them with fixture data, and asserts on the returned strings/objects.

**Test file structure:**

```
describe('buildSynthesisPrompt')
  describe('with panel responses only')
    it('includes the model identifier for each panel response')
    it('includes the content string for each panel response')
    it('includes all panel responses when multiple are provided')
    it('returns a non-empty string even with a single panel response')
    it('handles an empty panel array without throwing')
  describe('with analysis provided')
    it('includes the consensus field from the analysis')
    it('includes contradiction descriptions when contradictions exist')
    it('includes unique insight text when uniqueInsights exist')
    it('includes blindSpot strings when blindSpots exist')
    it('includes all four analysis fields in the output')
  describe('without analysis (graceful degradation)')
    it('returns a valid prompt string when analysis is undefined')
    it('does not contain the word "consensus" when no analysis is provided')
    it('does not contain the word "blindSpots" when no analysis is provided')
  describe('prompt structure')
    it('returns a string suitable as a user prompt (no system prefix)')
    it('instructs the model to ground its answer in the panel outputs')

describe('buildJudgePrompt')
  describe('return shape')
    it('returns an object with non-empty systemPrompt and userPrompt strings')
    it('both systemPrompt and userPrompt are plain strings (not JSON-encoded)')
  describe('systemPrompt content')
    it('describes the judge role (analyst/evaluator)')
    it('references all four analysis fields: consensus, contradictions, uniqueInsights, blindSpots')
    it('requests JSON output from the judge model')
  describe('userPrompt content')
    it('includes the model identifier for each panel response')
    it('includes the full content of each panel response')
    it('includes all panel responses when multiple are provided')
    it('asks the judge to produce analysis conforming to the schema')
  describe('multiple panel responses')
    it('both prompts are non-empty with three panel responses')
    it('userPrompt contains all three model identifiers')
    it('userPrompt contains all three response content strings')
  describe('purity')
    it('same inputs always produce identical outputs (deterministic)')
```

**Specific test behaviors:**

- **`buildSynthesisPrompt` includes panel model identifiers**: Create a `PanelResponse` fixture with `model: { provider: 'openai', model: 'gpt-4o', baseURL: 'http://localhost:11434/v1', apiKey: 'sk-test' }` and `content: 'The sky is blue.'`. Call `buildSynthesisPrompt([fixture])`. Assert the returned string contains `"gpt-4o"` and `"The sky is blue."`.

- **`buildSynthesisPrompt` includes all panel responses**: Create three `PanelResponse` fixtures with distinct model names (`gpt-4o`, `claude-3`, `llama-3`) and distinct content strings. Call `buildSynthesisPrompt([fixture1, fixture2, fixture3])`. Assert the returned string contains all six strings (three model names + three content strings).

- **`buildSynthesisPrompt` with analysis**: Provide an `Analysis` object like `{ consensus: 'Agreed on color.', contradictions: [{ sourceA: 'gpt-4o', sourceB: 'claude-3', description: 'Disagree on shade.' }], uniqueInsights: [{ source: 'llama-3', insight: 'Mentioned Rayleigh scattering.' }], blindSpots: ['humidity', 'altitude effects'] }`. Call `buildSynthesisPrompt(panelResponses, analysis)`. Assert the returned string contains `"Agreed on color."`, `"Disagree on shade."`, `"Rayleigh scattering"`, and `"humidity"`.

- **`buildSynthesisPrompt` graceful degradation (analysis undefined)**: Call `buildSynthesisPrompt(panelResponses, undefined)` or `buildSynthesisPrompt(panelResponses)` (no second argument). Assert the returned string is non-empty and contains the panel model names and content. Assert the returned string does NOT contain the strings `"consensus"`, `"contradictions"`, `"uniqueInsights"`, or `"blindSpots"` (these analysis section headers should only appear when analysis data is actually present).

- **`buildSynthesisPrompt` empty panel array**: Call `buildSynthesisPrompt([], undefined)`. Assert the function returns a string (it should not throw). The string may indicate no panel responses are available.

- **`buildJudgePrompt` returns system and user prompts**: Call `buildJudgePrompt([{ model: { provider: 'openai', model: 'gpt-4o', ... }, content: '42', usage: undefined, latencyMs: 100 }])`. Assert the result is an object with keys `systemPrompt` and `userPrompt`. Assert both values are non-empty strings (`typeof systemPrompt === 'string'` and `systemPrompt.length > 0`; same for `userPrompt`).

- **`buildJudgePrompt` system prompt describes judge role**: Assert `result.systemPrompt` contains words indicating an analysis/judging role — e.g., matches at least one of `"analyst"`, `"judge"`, `"evaluate"`, `"analyze"`, `"assess"`. Assert it references the four analysis fields by name (`"consensus"`, `"contradictions"`, `"uniqueInsights"`, `"blindSpots"`). Assert it mentions JSON output (contains `"JSON"` or `"json"`).

- **`buildJudgePrompt` user prompt includes panel content**: Assert `result.userPrompt` contains the model identifier `"gpt-4o"` and the response content `"42"`.

- **`buildJudgePrompt` with multiple panel responses**: Assert `result.userPrompt` contains all model identifiers and all content strings for three panel responses.

- **`buildJudgePrompt` determinism**: Call `buildJudgePrompt` twice with the same argument. Assert the results are deep-equal (same function, same input, same output — confirms the function is pure and has no randomness or external state).

---

### Installation and project integration

Before the tests can run, vitest must be installed:

```bash
npm install --save-dev vitest
```

Then add a `"test"` script to `package.json`:

```json
"scripts": {
  "test": "vitest run"
}
```

After creating all files and installing vitest, `npm test` should discover and run the three `*.spec.ts` files without errors. All tests pass with zero failures.

---

## Files
- `vitest.config.ts` (CREATE) — Vitest configuration: `globals: true`, `include: ['src/**/*.spec.ts']`, `environment: 'node'`
- `src/domain/model/__tests__/fusion-types.spec.ts` (CREATE) — Pure tests: `FusionError` constructor sets `code`/`message`/`details`, sets `name` to `'FusionError'`, is `instanceof Error`, preserves stack trace; `ModelRef` accepts four required fields; `FusionStreamEvent` discriminated union accepts all five variants
- `src/domain/services/__tests__/analysis-schema.spec.ts` (CREATE) — `analysisSchema.safeParse` accepts complete Analysis, accepts empty arrays; rejects missing `consensus`, `contradictions`, `uniqueInsights`, `blindSpots`; rejects malformed sub-objects; `safeParseAnalysis` returns `{ success: true, data }` for valid JSON, `{ success: false, error }` for invalid/malformed JSON, empty string, and non-object JSON — never throws
- `src/domain/services/__tests__/prompt-builders.spec.ts` (CREATE) — `buildSynthesisPrompt` includes panel model names and content strings, includes analysis fields when provided, gracefully degrades when analysis is undefined; `buildJudgePrompt` returns `{ systemPrompt, userPrompt }` with system prompt describing judge role and JSON schema, user prompt containing panel model identifiers and response content; deterministic (pure function)

## Test Expectations
- **`FusionError` sets `code`, `message`, and `details`**: When `new FusionError('ALL_FAILED', 'All panel models failed', { panelCount: 3 })` is called, expect `error.code` to equal `'ALL_FAILED'`, `error.message` to equal `'All panel models failed'`, and `error.details` to deep-equal `{ panelCount: 3 }`.
- **`FusionError` sets `name` to `'FusionError'`**: When any `FusionError` is constructed, expect `error.name` to equal `'FusionError'`.
- **`FusionError` is `instanceof Error`**: When any `FusionError` is constructed, expect `error instanceof Error` to be `true`.
- **`FusionError` details optional**: When `new FusionError('TIMEOUT', 'Request timed out')` is called with two arguments, expect `error.details` to be `undefined`.
- **`FusionError` preserves stack trace**: When any `FusionError` is constructed, expect `error.stack` to be a non-empty string.
- **`ModelRef` accepts required fields**: When a variable is typed `ModelRef` and assigned `{ provider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' }`, expect each field to hold its assigned value (compile-time + runtime).
- **`FusionStreamEvent` accepts all five variants**: When an object literal `{ type: 'progress', stage: 'panel', message: 'Panel running' }` is assigned to a `FusionStreamEvent`-typed variable, expect it to compile and `type` to equal `'progress'`. Repeat for `content_delta`, `content_stop`, `done`, and `error` variants.
- **`analysisSchema.safeParse` accepts complete Analysis**: When `safeParse` is called with `{ consensus: 'Models agree', contradictions: [{ sourceA: 'a', sourceB: 'b', description: 'd' }], uniqueInsights: [{ source: 'a', insight: 'i' }], blindSpots: ['x'] }`, expect `result.success` to be `true` and `result.data.consensus` to equal `'Models agree'`.
- **`analysisSchema.safeParse` accepts empty arrays**: When `safeParse` is called with `{ consensus: 'ok', contradictions: [], uniqueInsights: [], blindSpots: [] }`, expect `result.success` to be `true`.
- **`analysisSchema.safeParse` rejects missing `consensus`**: When `safeParse` is called with `{ contradictions: [], uniqueInsights: [], blindSpots: [] }` (no `consensus`), expect `result.success` to be `false`.
- **`analysisSchema.safeParse` rejects missing `contradictions`**: When `safeParse` is called with `{ consensus: 'ok', uniqueInsights: [], blindSpots: [] }` (no `contradictions`), expect `result.success` to be `false`.
- **`analysisSchema.safeParse` rejects malformed sub-object**: When `safeParse` is called with `{ consensus: 'ok', contradictions: [{ sourceA: 'only-one-field' }], uniqueInsights: [], blindSpots: [] }` (contradiction missing `sourceB` and `description`), expect `result.success` to be `false`.
- **`safeParseAnalysis` returns `success: true` for valid JSON**: When `safeParseAnalysis('{"consensus":"yes","contradictions":[],"uniqueInsights":[],"blindSpots":[]}')` is called, expect `result.success` to be `true` and `result.data.consensus` to equal `'yes'`.
- **`safeParseAnalysis` returns `success: false` for malformed JSON**: When `safeParseAnalysis('not json')` is called, expect `result.success` to be `false` and `result.error` to be a non-empty string. The function must not throw.
- **`safeParseAnalysis` returns `success: false` for schema-invalid JSON**: When `safeParseAnalysis('{"consensus":"yes"}')` is called (missing required arrays), expect `result.success` to be `false`. The function must not throw.
- **`safeParseAnalysis` returns `success: false` for empty string**: When `safeParseAnalysis('')` is called, expect `result.success` to be `false`. The function must not throw.
- **`safeParseAnalysis` returns `success: false` for non-object JSON**: When `safeParseAnalysis('42')` is called, expect `result.success` to be `false`. The function must not throw.
- **`buildSynthesisPrompt` includes panel model names**: When called with a `PanelResponse` whose `model.model` is `'gpt-4o'`, expect the returned string to contain `'gpt-4o'`.
- **`buildSynthesisPrompt` includes panel content**: When called with a `PanelResponse` whose `content` is `'The sky is blue.'`, expect the returned string to contain `'The sky is blue.'`.
- **`buildSynthesisPrompt` includes all panel responses**: When called with three `PanelResponse` fixtures having distinct model names and content, expect the returned string to contain all three model names and all three content strings.
- **`buildSynthesisPrompt` includes analysis fields when provided**: When called with an `Analysis` having `consensus: 'Agreed on color.'` and `blindSpots: ['humidity']`, expect the returned string to contain both `'Agreed on color.'` and `'humidity'`.
- **`buildSynthesisPrompt` excludes analysis headers when analysis is undefined**: When called without an `analysis` argument, expect the returned string NOT to contain `'consensus'`, `'contradictions'`, `'uniqueInsights'`, or `'blindSpots'` (these section headings only appear when analysis data is provided).
- **`buildSynthesisPrompt` handles empty panel array**: When `buildSynthesisPrompt([], undefined)` is called, expect it to return a string without throwing.
- **`buildJudgePrompt` returns system and user prompts**: When called with one `PanelResponse`, expect the result to be an object with keys `systemPrompt` and `userPrompt`, both non-empty strings.
- **`buildJudgePrompt` system prompt describes judge role**: Expect `result.systemPrompt` to contain at least one of `'analyst'`, `'judge'`, `'evaluate'`, `'analyze'`, or `'assess'`, and to contain `'consensus'`, `'contradictions'`, `'uniqueInsights'`, `'blindSpots'`, and `'JSON'` (case-insensitive).
- **`buildJudgePrompt` user prompt includes panel identifiers and content**: Expect `result.userPrompt` to contain the model identifier and response content from each provided `PanelResponse`.
- **`buildJudgePrompt` is deterministic**: When called twice with the same argument, expect the two results to be deep-equal.
- **Vitest discovers and runs all tests**: When `npx vitest run` is executed, all three `.spec.ts` files are discovered, all tests pass, and the exit code is `0`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
