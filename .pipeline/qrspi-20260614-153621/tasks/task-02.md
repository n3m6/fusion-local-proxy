# Task 02: Domain service scaffold (analysis schema, judge prompt, synthesis prompt)

## Metadata
- **Task:** 02
- **Phase:** 1
- **Route:** full
- **Slice:** Slice 1 (Domain Services)

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC-2 (domain purity — domain has zero imports from `src/application/` or `src/infrastructure/`)
- **NFRs:** NFR-1 (no SDK/framework imports in domain layers; zod is explicitly permitted per design convention note 2 as a pure validation library), NFR-6 (ConfigPort contract types — `ModelRef`, `ProviderType` — are referenced by prompt builder signatures but the config port itself is not imported)
- **Replan Gate Criteria:** Phase 1 Gate 4 (domain service files `analysis-schema.ts`, `judge-prompt.ts`, `synthesis-prompt.ts` exist, compile, and have zero imports from `src/application/` or `src/infrastructure/`)

## Source Traceability
- **Goals:** AC-2 (domain zero imports from app/infra)
- **Plan:** Task 02, Phase 1 — Foundation Fix and Domain Services
- **Design:** Slice 1 — Passthrough Chat Completion (OpenAI); the domain service files are pure domain artifacts needed by later ensemble slices
- **Structure:** Slice 1 — `src/domain/services/analysis-schema.ts`, `src/domain/services/judge-prompt.ts`, `src/domain/services/synthesis-prompt.ts`

## Description

Create three pure domain service files in `src/domain/services/`. These files contain no executable I/O logic — only type definitions, a Zod schema, and prompt-building functions that later phases (JudgeStep in Task 04, SynthesizeStep in Task 05) consume. Every file must have zero imports from `src/application/` or `src/infrastructure/`. The only permitted external dependency is `zod` (used in `analysis-schema.ts` as a pure validation library per the design's deliberate exception).

### analysis-schema.ts

Define the `Analysis` Zod schema representing the structured output the judge model must produce. The schema has four top-level fields:

- **`consensus`** — `z.array(z.string())`. Points of agreement found across panel model responses. Each entry is a statement that multiple models independently converged on.
- **`contradictions`** — `z.array(z.object({ topic: z.string(), perspectives: z.array(z.string()) }))`. Topics where panel models gave conflicting answers. Each contradiction identifies a `topic` (the subject of disagreement) and `perspectives` (the conflicting viewpoints expressed by different models).
- **`unique_insights`** — `z.array(z.object({ model: z.string(), insight: z.string() }))`. Noteworthy observations made by a single model that no other model raised. Each entry identifies the `model` that made the insight and the `insight` content.
- **`blind_spots`** — `z.array(z.string())`. Important topics or angles that no panel model addressed at all — things the user's question implicitly required but no model covered.

Export the schema as `analysisSchema` and infer an `Analysis` type via `z.infer<typeof analysisSchema>`. Both exports are consumed by JudgeStep (for `safeParse` validation) and SynthesizeStep / prompt builders (for type annotation).

### judge-prompt.ts

Export two pure functions that construct the system and user prompts for the judge model:

- **`buildJudgeSystemPrompt(): string`** — Returns a system prompt instructing the model to act as an impartial comparative analyst. The prompt must direct the model to:
  1. Identify consensus points where multiple panel models agree.
  2. Detect contradictions between panel models, noting the specific topic and the conflicting perspectives.
  3. Highlight unique insights that only one model contributed.
  4. Call out blind spots — important aspects of the user's question that no model addressed.
  5. Output the analysis as a valid JSON object matching the `Analysis` schema (include the field names and structure in the prompt so the model knows the expected shape).
  6. Not invent facts beyond what the panel responses contain.

- **`buildJudgeUserPrompt(panelResults: PanelResult[], originalMessages: Message[]): string`** — Returns a user prompt that presents the original conversation and the panel model responses for the judge to analyze. The prompt must:
  1. Present the `originalMessages` in a readable format (labeling each message by role: system, user, assistant).
  2. Present each `PanelResult` with its `modelId` and `content`, clearly separated so the judge can attribute insights to specific models.
  3. End with an explicit instruction to produce the JSON analysis.

The `PanelResult` type is imported from `../model/fusion-types.js` as `import type { PanelResult } from '../model/fusion-types.js';`. This type will be created in Task 03; the import is a forward reference structured so it resolves once Task 03 adds `PanelResult` to `fusion-types.ts`. The `Message` type is imported from `../model/message.js` and already exists.

### synthesis-prompt.ts

Export two pure functions that construct the system and user prompts for the synthesizer model:

- **`buildSynthesisSystemPrompt(): string`** — Returns a system prompt instructing the model to act as a synthesis engine that produces the final response. The prompt must direct the model to:
  1. Integrate information from the panel model responses, giving more weight to points where multiple models agree (consensus).
  2. When contradictions exist, acknowledge the disagreement and present the competing perspectives rather than picking one side.
  3. Incorporate unique insights from individual models, attributing them where appropriate.
  4. Address blind spots if possible, or acknowledge what remains unknown.
  5. Ground every factual claim in the panel responses or analysis — do not introduce facts not present in the provided materials.
  6. Write in a helpful, conversational tone appropriate for the end user.

- **`buildSynthesisUserPrompt(panelResults: PanelResult[], originalMessages: Message[], analysis: Analysis | null): string`** — Returns a user prompt presenting all available context for the synthesizer. The prompt must:
  1. Present the `originalMessages` in a readable format.
  2. Present each `PanelResult` with its `modelId` and `content`.
  3. When `analysis` is not `null`, present the analysis fields (consensus, contradictions, unique_insights, blind_spots) in a structured, scannable format.
  4. When `analysis` is `null`, include a note that panel-level analysis is unavailable and the synthesizer should work directly from the raw panel responses.
  5. End with an explicit instruction to produce the final synthesized response.

The `PanelResult` type (forward reference, same as judge-prompt.ts), `Message` type, and `Analysis` type (from `./analysis-schema.js`) are imported.

### Architectural constraints

- Every file must have **zero imports** from `src/application/` or `src/infrastructure/`.
- The only non-domain `node_modules` import permitted is `zod` in `analysis-schema.ts`.
- All inter-domain imports use `.js` extensions (ESM resolution): `'../model/message.js'`, `'../model/fusion-types.js'`, `'./analysis-schema.js'`.
- These files contain **no classes, no HTTP handling, no SDK calls, no I/O**. They are pure functions and type definitions.

## Files
- `src/domain/services/analysis-schema.ts` (CREATE) — Zod schema for `Analysis` with four fields (`consensus`, `contradictions`, `unique_insights`, `blind_spots`). Exports `analysisSchema` and the inferred `Analysis` type.
- `src/domain/services/judge-prompt.ts` (CREATE) — Exports `buildJudgeSystemPrompt()` and `buildJudgeUserPrompt(panelResults, originalMessages)`. Imports `PanelResult` from `../model/fusion-types.js` (forward reference for Task 03) and `Message` from `../model/message.js`.
- `src/domain/services/synthesis-prompt.ts` (CREATE) — Exports `buildSynthesisSystemPrompt()` and `buildSynthesisUserPrompt(panelResults, originalMessages, analysis)`. Imports `PanelResult` from `../model/fusion-types.js` (forward reference), `Message` from `../model/message.js`, and `Analysis` from `./analysis-schema.js`.

## Test Expectations
- **analysisSchema — valid input**: When `analysisSchema.safeParse()` is called with a JSON object containing all four required fields with correct types (`consensus: string[]`, `contradictions: {topic, perspectives}[]`, `unique_insights: {model, insight}[]`, `blind_spots: string[]`), the result is `{ success: true, data: <Analysis> }`.
- **analysisSchema — missing required field**: When `analysisSchema.safeParse()` is called with a JSON object where `consensus` is absent, the result is `{ success: false, error: ZodError }` with an issue indicating `consensus` is required.
- **analysisSchema — malformed field type**: When `analysisSchema.safeParse()` is called with a JSON object where `contradictions` is a plain string instead of an array of objects, the result is `{ success: false }`.
- **analysisSchema — empty valid input**: When `analysisSchema.safeParse()` is called with all fields present as empty arrays (`consensus: []`, `contradictions: []`, `unique_insights: []`, `blind_spots: []`), the result is `{ success: true }` (empty arrays are valid per the schema).
- **buildJudgeSystemPrompt**: Calling `buildJudgeSystemPrompt()` returns a non-empty string (at least 100 characters) containing words instructing the model to perform comparative analysis, identify consensus/contradictions/insights/blind_spots, and output JSON.
- **buildJudgeUserPrompt with panel results**: Calling `buildJudgeUserPrompt(panelResults, originalMessages)` with a non-empty `panelResults` array and `originalMessages` array returns a non-empty string that includes at least one `modelId` from the panel results and at least one message content from the original messages.
- **buildSynthesisSystemPrompt**: Calling `buildSynthesisSystemPrompt()` returns a non-empty string (at least 100 characters) containing grounding instructions (e.g., "do not introduce facts not present in the provided materials" or equivalent constraint language).
- **buildSynthesisUserPrompt with analysis**: Calling `buildSynthesisUserPrompt(panelResults, originalMessages, analysis)` where `analysis` is a valid `Analysis` object returns a non-empty string that includes content from the analysis fields (e.g., consensus items, contradiction topics) and references panel results.
- **buildSynthesisUserPrompt without analysis (null path)**: Calling `buildSynthesisUserPrompt(panelResults, originalMessages, null)` returns a non-empty string that references the panel results, does NOT include analysis-specific structure (since analysis is null), and contains language indicating the synthesizer should work directly from raw panel responses.
- **Domain purity — analysis-schema.ts**: Running `grep` for `from 'src/application/'` and `from 'src/infrastructure/'` against `src/domain/services/analysis-schema.ts` produces zero matches.
- **Domain purity — judge-prompt.ts**: Running `grep` for `from 'src/application/'` and `from 'src/infrastructure/'` against `src/domain/services/judge-prompt.ts` produces zero matches.
- **Domain purity — synthesis-prompt.ts**: Running `grep` for `from 'src/application/'` and `from 'src/infrastructure/'` against `src/domain/services/synthesis-prompt.ts` produces zero matches.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.
