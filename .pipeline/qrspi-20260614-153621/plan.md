# Implementation Plan

## Overview

This plan covers all remaining implementation across five phases, starting from an existing Phase 1 passthrough codebase (all 5 original tasks implemented with CLEAN review). The immediate priority is fixing the `package.json` regression (lost `"start"` and `"typecheck"` scripts) and adding the `@anthropic-ai/sdk` dependency, followed by domain service scaffold files needed by later phases. The plan then progresses through the full ensemble pipeline (panel fan-out → judge analysis → synthesis), streaming infrastructure, Anthropic API compatibility, and final polish (container wiring, tests, documentation).

The hexagonal architecture dependency rule (`infrastructure → application → domain`) is maintained throughout. All I/O and SDK usage is confined to infrastructure adapters. The codebase uses `node:test` with `node:assert/strict`, colocated `*.test.ts` files, kebab-case file naming, and `.js` extension ESM imports.

## Phase Summary

- **Phase 1:** Fixes the package.json scripts regression, adds `@anthropic-ai/sdk`, and creates domain service files (`analysis-schema.ts`, `judge-prompt.ts`, `synthesis-prompt.ts`). Proves the system remains runnable end-to-end with the passthrough.
- **Phase 2:** Delivers the ensemble pipeline: `PanelRunner` (parallel fan-out with `Promise.allSettled`), `JudgeStep` (structured analysis with graceful degradation), `SynthesizeStep` (non-streamed synthesis incorporating panel and judge outputs), and overhauls `RunFusionUseCase` to orchestrate the full ensemble. Proves ensemble behavior and graceful degradation.
- **Phase 3:** Adds streaming via `ChatModelPort.stream()`, `ChatStreamChunk` types, `OpenAiChatAdapter.stream()`, an OpenAI SSE encoder, and SSE route path. Proves end-to-end streaming with keep-alive comments, `chat.completion.chunk` events, and `[DONE]` termination.
- **Phase 4:** Adds full Anthropic API compatibility: outbound `AnthropicChatAdapter` via `@anthropic-ai/sdk`, inbound `/v1/messages` route with request/response translation, and SSE encoding of all 6 Anthropic event types in documented sequence. Proves wire compatibility with Anthropic client SDKs.
- **Phase 5:** Wires the DI container for the full ensemble, adds domain and infrastructure tests, produces README documentation, and delivers an example `fusion.config.json`. Proves observability, test coverage, and documentation quality.

## Task Order

| # | Task | Dependencies | Phase | Slice |
|---|------|-------------|-------|-------|
| 01 | Package.json regression fix and Anthropic SDK dependency | — | 1 | Slice 1 (Foundation Fix) |
| 02 | Domain service scaffold (analysis schema, judge prompt, synthesis prompt) | — | 1 | Slice 1 (Domain Services) |
| 03 | Panel types and PanelRunner use case | — | 2 | Slice 2 (Panel Fan-out) |
| 04 | JudgeStep with graceful degradation | 02, 03 | 2 | Slice 3 (Judge Analysis) |
| 05 | SynthesizeStep (non-streamed synthesis) | 02, 03 | 2 | Slice 3 (Synthesis) |
| 06 | RunFusionUseCase ensemble overhaul | 03, 04, 05 | 2 | Slice 3 (Use Case) |
| 07 | Domain streaming interface (ChatModelPort.stream() + ChatStreamChunk) | — | 3 | Slice 4 (Streaming Domain) |
| 08 | Streaming infrastructure (adapter.stream(), SSE encoder, route SSE) | 07 | 3 | Slice 4 (Streaming Infra) |
| 09 | Anthropic outbound adapter, factory, and config enum | 07 | 4 | Slice 5 (Anthropic Outbound) |
| 10 | Anthropic inbound route, translator, SSE encoder, server mount, and tests | 09 | 4 | Slice 5 (Anthropic Inbound) |
| 11 | DI container ensemble wiring | 06, 09, 10 | 5 | Slice 6 (Wiring) |
| 12 | Domain-layer unit tests | 02, 03, 04, 05 | 5 | Slice 6 (Domain Tests) |
| 13 | Infrastructure tests (OpenAI route, SSE encoder, server) | 08, 10 | 5 | Slice 6 (Infra Tests) |
| 14 | README and example fusion.config.json | 01–13 | 5 | Slice 6 (Documentation) |

## Wave Analysis

- **Wave 1** (no dependencies): Tasks 01, 02, 03, 07
- **Wave 2** (depends on Wave 1): Tasks 04, 05 (depend on 02, 03); Task 08 (depends on 07); Task 09 (depends on 07)
- **Wave 3** (depends on Wave 2): Tasks 06 (depends on 03, 04, 05); Task 10 (depends on 09)
- **Wave 4** (depends on Wave 3): Task 11 (depends on 06, 09, 10); Task 12 (depends on 02, 03, 04, 05); Task 13 (depends on 08, 10)
- **Wave 5** (depends on all prior): Task 14

## Coverage Notes

### Acceptance Criteria

- **AC-1** (package.json + tsconfig.json with Node 20+, strict TS, tsx dev) → Task 01
- **AC-2** (domain zero imports from app/infra; app zero imports from infra) → Tasks 01–14 (maintained by all; verified in CI)
- **AC-3** (ChatModelPort complete() + stream() signatures) → Task 07
- **AC-4** (FusionService.runFusion → AsyncIterable<StreamEvent>) → Already exists; Task 06 extends behavior
- **AC-5** (OpenAiChatAdapter implements ChatModelPort, factory selects for openai, real client receives response) → Existing (complete) + Task 08 (stream)
- **AC-6** (JsonFileConfigAdapter loads config, /v1/models returns models) → Already exists and functional
- **AC-7** (PanelRunner parallel dispatch, allSettled, failed_models, all_panels_failed FusionError) → Task 03
- **AC-8** (JudgeStep complete() with response_format, safeParse, graceful degradation on failure) → Task 04
- **AC-9** (SynthesizeStep references analysis + panel outputs, no unsourced claims) → Tasks 05, 06
- **AC-10** (SSE keep-alive during panel/judge, chat.completion.chunk, [DONE] termination) → Task 08
- **AC-11** (AnthropicChatAdapter + /v1/messages route, 6-event SSE sequence) → Tasks 09, 10
- **AC-12** (AbortController timeout cancels upstream call) → Tasks 06, 07, 08
- **AC-13** (ConsoleLoggerAdapter per-stage cost/latency, failed_models detail) → Already exists; Task 06 orchestrates full logging
- **AC-14** (Domain unit tests pure, application tests stubbed) → Tasks 03, 04, 05, 06, 12
- **AC-15** (README architecture, setup, usage + example config) → Task 14

### Non-Functional Requirements

- **NFR-1** (architecture dependency rule) → All tasks (01–14)
- **NFR-2** (Hono confined to infrastructure/inbound/http) → Tasks 08, 10
- **NFR-3** (SDK confinement: openai in OpenAiChatAdapter, @anthropic-ai/sdk in AnthropicChatAdapter) → Tasks 01 (adds SDK dep), 08, 09
- **NFR-4** (streaming guarantees: only synthesizer streams, keep-alive during panel/judge) → Tasks 07, 08
- **NFR-5** (graceful degradation: panel fatal only if all fail, judge never fatal) → Tasks 03, 04, 06
- **NFR-6** (ConfigPort contract insulates app from config file format) → Task 02 (domain types referenced), Task 03 (panel models via config)
- **NFR-7** (observability: per-stage cost/latency, failed_models detail) → Tasks 03, 04, 06

### Replan Gate Criteria

- **Phase 1 Gate 1** (`package.json` contains exactly three scripts: `"dev": "tsx src/main.ts"`, `"start": "tsx src/main.ts"`, `"typecheck": "tsc --noEmit"`, and includes `@anthropic-ai/sdk: "^0.104.1"` in dependencies) → Task 01
- **Phase 1 Gate 2** (`npm run typecheck` passes with zero errors) → Task 01
- **Phase 1 Gate 3** (`curl POST /v1/chat/completions` with existing passthrough returns a valid ChatCompletion JSON response; system remains runnable) → Task 01
- **Phase 1 Gate 4** (Domain service files `analysis-schema.ts`, `judge-prompt.ts`, `synthesis-prompt.ts` exist, compile, and have zero imports from `src/application/` or `src/infrastructure/`) → Task 02
- **Phase 2 Gate 1** (When all panel models are configured, the `/v1/chat/completions` response content references at least one element from panel outputs and at least one element from judge analysis) → Tasks 03, 04, 05, 06
- **Phase 2 Gate 2** (When the judge model is unreachable or returns invalid JSON, the system returns a valid synthesis response — graceful degradation — and logs the judge failure via `LoggerPort.logError()`) → Tasks 04, 06
- **Phase 2 Gate 3** (`PanelRunner` throws `FusionError('all_panels_failed')` when every panel model fails) → Task 03
- **Phase 3 Gate 1** (A `curl` request with `stream: true` to `/v1/chat/completions` receives SSE `data:` lines with `object: "chat.completion.chunk"` payloads, terminated by `data: [DONE]`, with keep-alive comments visible before the first content chunk) → Tasks 07, 08
- **Phase 3 Gate 2** (A per-call timeout correctly cancels the upstream LLM call via `AbortController` and surfaces the cancellation) → Tasks 06, 07, 08
- **Phase 4 Gate 1** (A `curl` request to `POST /v1/messages` with an Anthropic-format body receives SSE events in documented sequence: `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`, using both `event:` and `data:` SSE fields) → Tasks 09, 10
- **Phase 4 Gate 2** (`ChatAdapterFactory.create()` returns an `AnthropicChatAdapter` for `provider.type === 'anthropic'` and the adapter correctly maps canonical request/response types without leaking Anthropic-specific shapes into domain or application layers) → Tasks 09, 10
- **Phase 5 Gate 1** (`ConsoleLoggerAdapter` emits structured log lines for each stage containing stage name, duration in ms, token counts, and `failed_models` array with model identifier, error code, and truncated message ≤200 chars) → Tasks 06, 11
- **Phase 5 Gate 2** (`npm test` executes domain-layer unit tests — zero mocks required — and application-layer unit tests — stubbed ports — with ≥80% branch coverage on `src/domain/` and `src/application/`) → Tasks 03, 04, 05, 06, 12

### Structure File Map Coverage

- **Slice 1 — package.json** → Task 01
- **Slice 1 — src/domain/services/analysis-schema.ts** → Task 02
- **Slice 1 — src/domain/services/judge-prompt.ts** → Task 02
- **Slice 1 — src/domain/services/synthesis-prompt.ts** → Task 02
- **Slice 2 — src/domain/model/fusion-types.ts (MODIFY)** → Task 03
- **Slice 2 — src/application/usecases/panel-runner.ts** → Task 03
- **Slice 2 — src/application/usecases/panel-runner.test.ts** → Task 03
- **Slice 3 — src/application/usecases/judge-step.ts** → Task 04
- **Slice 3 — src/application/usecases/judge-step.test.ts** → Task 04
- **Slice 3 — src/application/usecases/synthesize-step.ts** → Task 05
- **Slice 3 — src/application/usecases/synthesize-step.test.ts** → Task 05
- **Slice 3 — src/application/usecases/run-fusion-use-case.ts (MODIFY)** → Task 06
- **Slice 3 — src/application/usecases/run-fusion-use-case.test.ts (MODIFY)** → Task 06
- **Slice 4 — src/domain/ports/chat-model-port.ts (MODIFY)** → Task 07
- **Slice 4 — src/domain/model/chat-types.ts (MODIFY)** → Task 07
- **Slice 4 — src/infrastructure/outbound/llm/openai-chat-adapter.ts (MODIFY)** → Task 08
- **Slice 4 — src/infrastructure/inbound/http/openai/sse-encoder.ts** → Task 08
- **Slice 4 — src/infrastructure/inbound/http/openai/route.ts (MODIFY)** → Task 08
- **Slice 4 — src/infrastructure/inbound/http/openai/translator.ts (MODIFY)** → Task 08
- **Slice 5 — src/infrastructure/outbound/llm/anthropic-chat-adapter.ts** → Task 09
- **Slice 5 — src/infrastructure/outbound/llm/anthropic-chat-adapter.test.ts** → Task 09
- **Slice 5 — src/infrastructure/outbound/llm/chat-adapter-factory.ts (MODIFY)** → Task 09
- **Slice 5 — src/infrastructure/outbound/llm/chat-adapter-factory.test.ts (MODIFY)** → Task 09
- **Slice 5 — src/infrastructure/outbound/config/json-file-config-adapter.ts (MODIFY)** → Task 09
- **Slice 5 — src/infrastructure/inbound/http/anthropic/route.ts** → Task 10
- **Slice 5 — src/infrastructure/inbound/http/anthropic/translator.ts** → Task 10
- **Slice 5 — src/infrastructure/inbound/http/anthropic/sse-encoder.ts** → Task 10
- **Slice 5 — src/infrastructure/inbound/http/server.ts (MODIFY)** → Task 10
- **Slice 5 — src/infrastructure/inbound/http/anthropic/translator.test.ts** → Task 10
- **Slice 5 — src/infrastructure/inbound/http/anthropic/route.integration.test.ts** → Task 10
- **Slice 6 — src/infrastructure/di/container.ts (MODIFY)** → Task 11
- **Slice 6 — src/infrastructure/di/container.test.ts (MODIFY)** → Task 11
- **Slice 6 — src/domain/services/analysis-schema.test.ts** → Task 12
- **Slice 6 — src/domain/services/judge-prompt.test.ts** → Task 12
- **Slice 6 — src/domain/services/synthesis-prompt.test.ts** → Task 12
- **Slice 6 — src/domain/model/fusion-types.test.ts (MODIFY)** → Task 12
- **Slice 6 — src/infrastructure/inbound/http/openai/route.test.ts** → Task 13
- **Slice 6 — src/infrastructure/inbound/http/openai/sse-encoder.test.ts** → Task 13
- **Slice 6 — src/infrastructure/inbound/http/server.test.ts (MODIFY)** → Task 13
- **Slice 6 — README.md (MODIFY)** → Task 14
- **Slice 6 — fusion.config.json (MODIFY)** → Task 14
