# Task 02: Domain ports

## Metadata
- **Task:** 02
- **Phase:** 1
- **Route:** full
- **Slice:** Passthrough Chat Completion (OpenAI)

## Dependencies
- **Task 01** provides the domain model types that these port interfaces reference: `Message` from `src/domain/model/message.ts`, `ChatRequest`, `ChatResponse`, `TokenUsage` from `src/domain/model/chat-types.ts`, `ModelRef`, `FusionError`, `FusionRequest` from `src/domain/model/fusion-types.ts`, and `FusionStreamEvent`, `FailedModelInfo` from `src/domain/model/stream-types.ts`. Task 01 also provides `tsconfig.json` so the port files compile under the project's strict TypeScript configuration.

## Traceability
- **Acceptance Criteria:** AC-3 (partial — `complete()` signature only; `stream()` deferred to Task 09)
- **NFRs:** NFR-1 (dependency rule: zero SDK/framework imports in domain)
- **Replan Gate Criteria:** Phase 1 Gate 2 (zero SDK/framework imports in domain)

## Source Traceability
- **Goals:** AC-3 — `ChatModelPort` interface defines `complete()` signature using only domain types
- **Plan:** Task 02, Phase 1 — Core Passthrough
- **Design:** Passthrough Chat Completion (OpenAI)
- **Structure:** Passthrough Chat Completion (OpenAI) — `src/domain/ports/chat-model-port.ts`, `src/domain/ports/config-port.ts`, `src/domain/ports/logger-port.ts`, `src/domain/ports/clock-port.ts`

## Description

Define the four outbound port interfaces in `src/domain/ports/`. These interfaces are pure TypeScript contracts — no implementations, no default methods, zero imports from any SDK (`openai`, `@anthropic-ai/sdk`, `hono`, `zod`) or from `src/application/` or `src/infrastructure/`. They reference only domain model types created in Task 01. Infrastructure adapters in later tasks will implement these interfaces; application use cases will consume them via dependency injection.

### `ChatModelPort` (`src/domain/ports/chat-model-port.ts`)

The single outbound port for all LLM calls. In this phase, it exposes only the non-streaming `complete()` method. The `stream()` method is added in Task 09 (Phase 3). Every adapter that talks to an LLM provider must implement this interface. Panel, judge, and synthesis steps in the application layer depend only on this port — never on a concrete SDK.

- `complete(request: ChatRequest): Promise<ChatResponse>` — sends a canonical chat request to a model and returns the full response. The `ChatRequest` carries the message list, target model reference, and optional parameters (temperature, maxTokens, responseFormat). The `ChatResponse` carries the model's text content, token usage, and the model identifier string.

The interface must import `ChatRequest` and `ChatResponse` from `../model/chat-types.js` (using `.js` extension per ESM).

### `ConfigPort` (`src/domain/ports/config-port.ts`)

Abstracts access to the system configuration so the application layer never reads `fusion.config.json` directly. The four methods expose exactly the information the application needs to orchestrate the ensemble pipeline:

- `getPanelModels(): ModelRef[]` — returns the list of models that serve as the panel. Always returns an array (may be empty if no panel models are configured, though in practice at least one is expected).
- `getJudgeModel(): ModelRef | null` — returns the judge model if one is configured, or `null` if judging is disabled. A `null` return signals to the use case that the judge step should be skipped.
- `getSynthesizerModel(): ModelRef` — returns the synthesizer model. This must always return a valid `ModelRef`; the synthesizer is mandatory for producing a final response. Never returns `null`.
- `getTimeoutMs(): number` — returns the per-call timeout in milliseconds (e.g., `30000` for 30 seconds). The application layer passes this to outbound adapters via `ChatOptions` or `AbortSignal`.

The interface must import `ModelRef` from `../model/fusion-types.js`.

### `LoggerPort` (`src/domain/ports/logger-port.ts`)

Abstracts structured logging so the application layer can report stage lifecycle events and errors without coupling to a specific logging library or output format:

- `logStageStart(stage: string): void` — called when a pipeline stage (panel, judge, synthesis) begins.
- `logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void` — called when a pipeline stage completes, carrying the elapsed wall-clock duration and optional token usage from the LLM response.
- `logFailedModels(models: FailedModelInfo[]): void` — called to report which panel models failed during fan-out, including the model identifier and failure reason for each.
- `logError(stage: string, error: Error): void` — called when an error occurs during a stage, e.g., a judge model call rejection or schema validation failure.

The interface must import `TokenUsage` from `../model/chat-types.js` and `FailedModelInfo` from `../model/stream-types.js`.

### `ClockPort` (`src/domain/ports/clock-port.ts`)

Wraps access to the system clock for testability. Instead of calling `Date.now()` directly throughout the application, components receive a `ClockPort` and call `now()`. Production wiring uses `Date.now()` inside the adapter; tests can supply a fake clock to control time.

- `now(): number` — returns the current time in milliseconds since the Unix epoch, semantically equivalent to `Date.now()`.

This interface has no imports — it is entirely self-contained.

## Files
- `src/domain/ports/chat-model-port.ts` (CREATE) — `ChatModelPort` interface with `complete(request: ChatRequest): Promise<ChatResponse>`; imports only `ChatRequest` and `ChatResponse` from `../model/chat-types.js`
- `src/domain/ports/config-port.ts` (CREATE) — `ConfigPort` interface with `getPanelModels(): ModelRef[]`, `getJudgeModel(): ModelRef | null`, `getSynthesizerModel(): ModelRef`, `getTimeoutMs(): number`; imports only `ModelRef` from `../model/fusion-types.js`
- `src/domain/ports/logger-port.ts` (CREATE) — `LoggerPort` interface with `logStageStart(stage: string): void`, `logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void`, `logFailedModels(models: FailedModelInfo[]): void`, `logError(stage: string, error: Error): void`; imports `TokenUsage` from `../model/chat-types.js` and `FailedModelInfo` from `../model/stream-types.js`
- `src/domain/ports/clock-port.ts` (CREATE) — `ClockPort` interface with `now(): number`; no imports

## Test Expectations
- **Compilation**: `npx tsc --noEmit` produces zero TypeScript errors from files under `src/domain/ports/` (requires Task 01 domain model types to be present).
- **Dependency rule — no SDK imports**: `grep -r "from 'openai'" src/domain/ports/` returns empty; `grep -r "from '@anthropic-ai" src/domain/ports/` returns empty; `grep -r "from 'hono'" src/domain/ports/` returns empty; `grep -r "from 'zod'" src/domain/ports/` returns empty.
- **Dependency rule — no layer violations**: `grep -r "from 'src/application/" src/domain/ports/` returns empty; `grep -r "from 'src/infrastructure/" src/domain/ports/` returns empty.
- **ChatModelPort contract**: The interface exports a single method `complete` with the signature `(request: ChatRequest) => Promise<ChatResponse>`. There is no `stream` method at this stage.
- **ConfigPort contract**: `getSynthesizerModel()` returns `ModelRef` (not `ModelRef | null` — the synthesizer is mandatory). `getJudgeModel()` returns `ModelRef | null` (the judge is optional). `getPanelModels()` returns `ModelRef[]`. `getTimeoutMs()` returns `number`.
- **LoggerPort contract**: All four methods (`logStageStart`, `logStageEnd`, `logFailedModels`, `logError`) return `void`. `logStageEnd` accepts an optional `usage` parameter of type `TokenUsage`.
- **ClockPort contract**: `now()` returns `number` and accepts no arguments.
- **No runtime coupling**: No port file imports, uses, or references any concrete class, SDK client, or filesystem operation. Every file contains only an `export interface` (or `export type` for any needed helper types) with zero executable code.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
