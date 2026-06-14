# Task 06: Domain types and services for ensemble

## Metadata
- **Task:** 06
- **Phase:** 2
- **Route:** full
- **Slice:** Panel Fan-out + Synthesis, Judge Analysis

## Dependencies
- **Task 05** provides the completed infrastructure inbound HTTP layer, DI container, and bootstrap wiring (`src/infrastructure/inbound/http/server.ts`, `src/infrastructure/inbound/http/openai/route.ts`, `src/infrastructure/inbound/http/openai/translator.ts`, `src/infrastructure/inbound/http/models-route.ts`, `src/infrastructure/di/container.ts`, `src/main.ts`), making the system runnable end-to-end in passthrough mode. Task 06 adds new domain types and pure services that will be consumed by application use cases in Task 07 — these new files depend only on existing domain model types from Tasks 01 (`Message`, `ModelRef`, `TokenUsage`, `FusionRequest`, `FusionError`, `FusionStreamEvent`, `FailedModelInfo`, `ChatRequest`, `ChatResponse`) and the `zod` library already declared in `package.json`.

## Traceability
- **Acceptance Criteria:** AC-7 (partial — panel types, prompt), AC-8 (partial — analysis schema, judge prompt), AC-9 (partial — synthesis prompt builder)
- **NFRs:** NFR-1, NFR-5
- **Replan Gate Criteria:** Phase 2 Gate 1 (domain types ready for ensemble), Phase 2 Gate 2 (schema supports safeParse degradation)

## Source Traceability
- **Goals:** AC-7 (PanelRunner types enabling all_panels_failed FusionError), AC-8 (Analysis zod schema + safeParse for judge degradation), AC-9 (synthesis prompt builder grounded in panel outputs and analysis)
- **Plan:** Task 06, Phase 2 — Ensemble Pipeline
- **Design:** Slice 2 — Panel Fan-out + Non-streamed Synthesis; Slice 3 — Judge Analysis with Graceful Degradation
- **Structure:** Slice 2 — `src/domain/model/panel-types.ts`, `src/domain/services/prompt-builders.ts`; Slice 3 — `src/domain/services/analysis-schema.ts`, `src/domain/services/judge-prompt-builder.ts`

## Description

Add four new pure domain files that provide the type vocabulary and pure-logic services for the ensemble pipeline: panel fan-out result types, the Zod `Analysis` schema with `safeParse` validation, a synthesis prompt builder, and a judge prompt builder. Every addition is pure domain code — zero imports from `src/application/`, `src/infrastructure/`, or any SDK (the only permitted third-party import is `zod` in `analysis-schema.ts`, consistent with the approved design placing the `Analysis` schema in `src/domain/services/`).

### 1. Panel response types (`src/domain/model/panel-types.ts`)

Defines the types used by `PanelRunner` (application service, Task 07) to collect per-model results from the parallel fan-out and by `JudgeStep` and `SynthesizeStep` to consume panel outputs.

**`PanelResponse`** — a successful panel model result:

```typescript
export interface PanelResponse {
  readonly model: ModelRef;
  readonly content: string;
  readonly usage?: TokenUsage;
  readonly latencyMs: number;
}
```

- `model` — the full `ModelRef` (provider, model name, baseURL, apiKey) that produced this response. Use `ModelRef` from `../fusion-types.js`.
- `content` — the text content returned by the model.
- `usage` — optional token usage data (`TokenUsage` from `../chat-types.js`). May be absent if the provider response did not include usage statistics.
- `latencyMs` — wall-clock duration of this panel call in milliseconds, measured by the caller (`PanelRunner`) and passed in.

**`PanelResult`** — discriminated union for each panel model's settlement outcome, mirroring `Promise.allSettled`:

```typescript
export type PanelResult =
  | { readonly status: 'fulfilled'; readonly response: PanelResponse }
  | { readonly status: 'rejected'; readonly modelId: string; readonly errorCode: string; readonly errorMessage: string };
```

- `fulfilled` variant — the panel model call succeeded; carries the `PanelResponse`.
- `rejected` variant — the panel model call failed; carries:
  - `modelId` — a human-readable identifier for the failed model (e.g., `"openai/gpt-4o"`). This should be distinct from the `ModelRef.model` field in that it identifies the model instance that failed.
  - `errorCode` — a short, machine-readable error code (e.g., `"TIMEOUT"`, `"NETWORK_ERROR"`, `"API_ERROR"`).
  - `errorMessage` — a human-readable error message.

The file imports only `ModelRef` from `./fusion-types.js` and `TokenUsage` from `./chat-types.js`. No runtime code, no classes, no functions — these are purely type/interface definitions.

---

### 2. Synthesis prompt builder (`src/domain/services/prompt-builders.ts`)

A pure function that builds the prompt string for the synthesizer model. It concatenates each panel model's response content and, when available, the judge's analysis fields into a single string instructing the synthesizer to produce a final, grounded response.

**Signature:**

```typescript
export function buildSynthesisPrompt(panelResponses: PanelResponse[], analysis?: Analysis): string;
```

**Behavior:**

1. Each `PanelResponse` in `panelResponses` contributes its `model.model` name and `content` to the prompt. The output should clearly delineate which model produced which content (e.g., prefix each response with the model identifier).
2. When `analysis` is provided (the judge succeeded), the prompt incorporates the `consensus`, `contradictions`, `uniqueInsights`, and `blindSpots` fields so the synthesizer can reference them. The prompt should instruct the model to ground its answer in these sources and not introduce factual claims absent from the panel outputs or analysis.
3. When `analysis` is `undefined` (judge was skipped or failed), the prompt still works using only the panel responses. The prompt should instruct the synthesizer to synthesize a response from the panel outputs alone, noting any disagreements among models.
4. The returned string is a complete user-facing prompt — it does not include a system message prefix. The caller (`SynthesizeStep`, Task 07) wraps it in a `Message` with `role: 'user'` when building the `ChatRequest`. The caller may prepend a system message from the original `FusionRequest.systemPrompt`.

**Imports:** `PanelResponse` from `../model/panel-types.js`, and the `Analysis` type from `./analysis-schema.js` (as a `type`-only import to avoid runtime coupling).

---

### 3. Analysis schema (`src/domain/services/analysis-schema.ts`)

Defines the Zod schema for the structured judge analysis, inferred TypeScript types, and a `safeParse` wrapper that the application layer uses for graceful degradation. This is the only file in the domain layer that imports `zod`.

**Zod schemas:**

```typescript
import { z } from 'zod';

export const contradictionSchema = z.object({
  sourceA: z.string(),
  sourceB: z.string(),
  description: z.string(),
});

export const uniqueInsightSchema = z.object({
  source: z.string(),
  insight: z.string(),
});

export const analysisSchema = z.object({
  consensus: z.string(),
  contradictions: z.array(contradictionSchema),
  uniqueInsights: z.array(uniqueInsightSchema),
  blindSpots: z.array(z.string()),
});
```

- `consensus` — a required string summarizing the points the panel models broadly agree on.
- `contradictions` — a required array (may be empty) of `{ sourceA, sourceB, description }` objects where `sourceA` and `sourceB` identify which models disagree and `description` explains the contradiction.
- `uniqueInsights` — a required array (may be empty) of `{ source, insight }` objects where `source` identifies which model contributed a unique perspective and `insight` describes it.
- `blindSpots` — a required array (may be empty) of strings, each naming a topic or angle that no panel model addressed.

**Inferred types:**

```typescript
export type Analysis = z.infer<typeof analysisSchema>;
export type Contradiction = z.infer<typeof contradictionSchema>;
export type UniqueInsight = z.infer<typeof uniqueInsightSchema>;
```

These are pure type exports — no runtime cost. Consumers import them with `import type`.

**`safeParseAnalysis`:**

```typescript
export function safeParseAnalysis(json: string): { success: true; data: Analysis } | { success: false; error: string };
```

- Accepts a raw JSON string (the judge model's response content).
- Internally calls `JSON.parse` on the input, then passes the parsed object to `analysisSchema.safeParse()`.
- On success: returns `{ success: true, data: <Analysis> }`.
- On failure (JSON parse error or zod validation failure): returns `{ success: false, error: <message-string> }`. The `error` string is a human-readable message extracted from the `ZodError` (use `error.issues` or `error.message` to produce a summary). The function must not throw — all failure paths return the `{ success: false }` branch. This is the graceful degradation boundary: `JudgeStep` (Task 07) calls this function and, on failure, returns `null` instead of an `Analysis`, allowing the pipeline to continue.
- The `ZodError` type must not appear in the return type — it is confined to the implementation body of `safeParseAnalysis`.

**Import rule:** This file imports `z` from `"zod"` — the only permitted SDK import in the domain layer per the approved design. It must not import from `src/application/` or `src/infrastructure/`.

---

### 4. Judge prompt builder (`src/domain/services/judge-prompt-builder.ts`)

A pure function that constructs the system and user prompts for the judge model, requesting a structured analysis of the panel responses.

**Signature:**

```typescript
export function buildJudgePrompt(panelResponses: PanelResponse[]): { systemPrompt: string; userPrompt: string };
```

**Behavior:**

- `systemPrompt` — a string that instructs the judge model about its role (an impartial analyst evaluating panel model responses) and describes the expected JSON output format with the four analysis fields (`consensus`, `contradictions`, `uniqueInsights`, `blindSpots`). The prompt should explicitly request JSON output and describe what each field means so the model produces valid structured output.
- `userPrompt` — a string that presents each panel model's response to the judge. Include the model identifier and the full response content for each panel member. The prompt should ask the judge to produce a JSON object conforming to the schema described in the system prompt.
- Both strings are plain text (not JSON-encoded at this layer). The caller (`JudgeStep`, Task 07) wraps them in `Message` objects with roles `'system'` and `'user'` respectively when building the `ChatRequest`.
- The function is pure: same inputs always produce the same outputs. It performs no I/O, does not call any port, and has no side effects.

**Import:** `PanelResponse` from `../model/panel-types.js`.

---

### Import and purity constraints

All four files live in `src/domain/` and must satisfy:

- **Zero imports from `src/application/`** — `grep -r "from.*application" src/domain/model/panel-types.ts src/domain/services/` must return empty.
- **Zero imports from `src/infrastructure/`** — `grep -r "from.*infrastructure" src/domain/model/panel-types.ts src/domain/services/` must return empty.
- **No SDK imports except `zod` in `analysis-schema.ts`** — `openai`, `@anthropic-ai/sdk`, `hono`, `@hono/node-server` must not appear in any import.
- **ESM import paths** — all relative imports use the `.js` extension (e.g., `'./fusion-types.js'`, `'../model/panel-types.js'`).

## Files
- `src/domain/model/panel-types.ts` (CREATE) — `PanelResponse` interface (`model`, `content`, `usage?`, `latencyMs`) and `PanelResult` discriminated union (`fulfilled` with `response: PanelResponse` | `rejected` with `modelId`, `errorCode`, `errorMessage`); imports `ModelRef` from `./fusion-types.js` and `TokenUsage` from `./chat-types.js`
- `src/domain/services/prompt-builders.ts` (CREATE) — `buildSynthesisPrompt(panelResponses: PanelResponse[], analysis?: Analysis): string`; concatenates panel model outputs and optional analysis fields into a grounded synthesis prompt; imports `PanelResponse` from `../model/panel-types.js` and `Analysis` as a type-only import from `./analysis-schema.js`
- `src/domain/services/analysis-schema.ts` (CREATE) — Zod schemas for `contradictionSchema`, `uniqueInsightSchema`, `analysisSchema`; inferred `Analysis`, `Contradiction`, `UniqueInsight` types; `safeParseAnalysis(json: string)` returning `{ success: true, data: Analysis } | { success: false, error: string }` without throwing; imports `z` from `zod`
- `src/domain/services/judge-prompt-builder.ts` (CREATE) — `buildJudgePrompt(panelResponses: PanelResponse[]): { systemPrompt: string; userPrompt: string }`; constructs system prompt describing the judge role and JSON schema, and user prompt presenting panel responses; imports `PanelResponse` from `../model/panel-types.js`

## Test Expectations
- **PanelResponse shape**: The `PanelResponse` interface is exported and accepts an object with `model` (any `ModelRef`), `content` (string), optional `usage` (`TokenUsage`), and `latencyMs` (number). TypeScript compilation succeeds when assigning a conforming object to a `PanelResponse` variable.
- **PanelResult discriminated union — fulfilled**: A value `{ status: 'fulfilled', response: { model: {...}, content: 'hello', usage: {...}, latencyMs: 42 } }` is assignable to `PanelResult`. Accessing `.response.content` after narrowing on `status === 'fulfilled'` compiles (TypeScript narrows correctly).
- **PanelResult discriminated union — rejected**: A value `{ status: 'rejected', modelId: 'openai/gpt-4o', errorCode: 'TIMEOUT', errorMessage: 'timed out' }` is assignable to `PanelResult`. Accessing `.errorCode` after narrowing on `status === 'rejected'` compiles.
- **PanelResult exhaustiveness**: A switch/if-else over `PanelResult['status']` covering only `'fulfilled'` produces a TypeScript error (not all branches covered) at the call site — the union is properly discriminated.
- **buildSynthesisPrompt — single panel response**: Calling `buildSynthesisPrompt([{ model: { provider: 'openai', model: 'gpt-4o', baseURL: 'http://localhost:11434/v1', apiKey: 'sk-test' }, content: 'The sky is blue.', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, latencyMs: 100 }])` returns a string that contains `"gpt-4o"` and `"The sky is blue."`.
- **buildSynthesisPrompt — multiple panel responses**: With three `PanelResponse` objects each having distinct `model.model` values and `content` strings, the returned string contains all three model names and all three content strings.
- **buildSynthesisPrompt — with analysis**: When `analysis` is `{ consensus: 'Agreed on color.', contradictions: [], uniqueInsights: [{ source: 'gpt-4o', insight: 'Mentioned wavelength.' }], blindSpots: ['humidity'] }`, the returned string contains `"Agreed on color."`, `"gpt-4o"`, `"Mentioned wavelength."`, and `"humidity"`.
- **buildSynthesisPrompt — without analysis (graceful degradation)**: Calling `buildSynthesisPrompt(panelResponses, undefined)` (no second argument) returns a valid non-empty string containing the panel model names and content. The string does not contain the words "consensus", "contradictions", "uniqueInsights", or "blindSpots" (analysis fields are absent because no analysis was provided).
- **buildSynthesisPrompt — empty panel array**: Calling `buildSynthesisPrompt([], undefined)` returns a string (possibly indicating no panel responses are available). The function does not throw.
- **analysisSchema — valid full Analysis**: Passing a JSON object with all four required fields (`consensus: string`, `contradictions: [{ sourceA, sourceB, description }]`, `uniqueInsights: [{ source, insight }]`, `blindSpots: [string]`) to `analysisSchema.safeParse()` returns `{ success: true, data: <Analysis> }`.
- **analysisSchema — empty arrays accepted**: An object with `consensus: 'ok'`, `contradictions: []`, `uniqueInsights: []`, `blindSpots: []` passes `safeParse` with `success: true`.
- **analysisSchema — missing required field**: An object with only `{ consensus: 'ok' }` (no `contradictions`, `uniqueInsights`, `blindSpots`) fails `safeParse` with `success: false`.
- **analysisSchema — malformed sub-object**: An object where `contradictions` contains an element missing `description` fails `safeParse` with `success: false`.
- **safeParseAnalysis — valid JSON string**: Calling `safeParseAnalysis('{"consensus":"yes","contradictions":[],"uniqueInsights":[],"blindSpots":[]}')` returns `{ success: true, data: <Analysis> }`.
- **safeParseAnalysis — invalid JSON string**: Calling `safeParseAnalysis('not json')` returns `{ success: false, error: <string> }`. The function does not throw.
- **safeParseAnalysis — valid JSON fails schema**: Calling `safeParseAnalysis('{"consensus":"yes"}')` (missing required arrays) returns `{ success: false, error: <string> }`. The function does not throw.
- **safeParseAnalysis — empty string**: Calling `safeParseAnalysis('')` returns `{ success: false, error: <string> }`. The function does not throw.
- **Inferred types exported**: `Analysis`, `Contradiction`, and `UniqueInsight` are exported from `analysis-schema.ts` and can be used as TypeScript types (e.g., `const a: Analysis = ...` compiles).
- **buildJudgePrompt — returns system and user prompts**: Calling `buildJudgePrompt([{ model: { provider: 'openai', model: 'gpt-4o', baseURL: 'http://localhost:11434/v1', apiKey: 'sk-test' }, content: '42', latencyMs: 100 }])` returns an object with non-empty string properties `systemPrompt` and `userPrompt`.
- **buildJudgePrompt — system prompt describes role and schema**: The `systemPrompt` string contains words indicating a judging/analysis role (e.g., "analyst", "judge", "evaluate") and references the four analysis fields (`consensus`, `contradictions`, `uniqueInsights`, `blindSpots`).
- **buildJudgePrompt — user prompt includes panel content**: The `userPrompt` string contains the model identifier `"gpt-4o"` and the response content `"42"` from the panel response.
- **buildJudgePrompt — multiple panel responses**: With three panel responses having distinct model names and content, both `systemPrompt` and `userPrompt` are non-empty strings; `userPrompt` contains all three model names and all three content strings.
- **Domain purity — no SDK imports in panel-types, prompt-builders, judge-prompt-builder**: Running `grep -r "from 'openai'" src/domain/model/panel-types.ts src/domain/services/prompt-builders.ts src/domain/services/judge-prompt-builder.ts` returns empty. Same for `@anthropic-ai/sdk`, `hono`, `@hono/node-server`.
- **Domain purity — zod confined to analysis-schema.ts**: `grep -r "from 'zod'" src/domain/model/panel-types.ts src/domain/services/prompt-builders.ts src/domain/services/judge-prompt-builder.ts` returns empty. Only `src/domain/services/analysis-schema.ts` imports `zod`.
- **Domain purity — no application imports**: `grep -r "from.*application" src/domain/model/panel-types.ts src/domain/services/` returns empty.
- **Domain purity — no infrastructure imports**: `grep -r "from.*infrastructure" src/domain/model/panel-types.ts src/domain/services/` returns empty.
- **TypeScript compilation**: After creating all four files, `npx tsc --noEmit` exits with code 0 and no errors under `src/domain/model/panel-types.ts` and `src/domain/services/`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
