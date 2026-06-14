# Implementation Plan

## Overview

The Fusion Local Proxy is a TypeScript local proxy server (Node 20+, Hono) that exposes OpenAI- and Anthropic-compatible HTTP APIs while internally running an ensemble pipeline: fan-out to a configurable panel of models, an optional judge analysis, and a streamed synthesis response. The system uses a hexagonal (ports-and-adapters) architecture — domain and application layers are pure and testable, with all I/O and provider SDKs confined to infrastructure adapters. The single outbound port `ChatModelPort` is implemented by `OpenAiChatAdapter` and `AnthropicChatAdapter`, switched via `ChatAdapterFactory` by `provider.type`.

Implementation proceeds through five phases, each delivering a runnable system. Phase 1 proves the hexagonal skeleton end-to-end with a working OpenAI-compatible passthrough endpoint. Phase 2 adds the core ensemble: parallel panel fan-out, structured judge analysis with graceful degradation, and non-streamed synthesis. Phase 3 adds streaming synthesis via SSE with keep-alive comments and `AbortController` timeouts. Phase 4 delivers full Anthropic API compatibility on both inbound and outbound sides. Phase 5 delivers observability, unit tests, and documentation. Every task is a vertical increment — no task delivers only horizontal-layer artifacts.

## Phase Summary

- **Phase 1:** Core Passthrough — establishes the hexagonal skeleton, proves the dependency rule, and delivers a working OpenAI-compatible `/v1/chat/completions` passthrough endpoint with config loading and `/v1/models` stub. Contains Tasks 01–05.
- **Phase 2:** Ensemble Pipeline — adds panel fan-out with `Promise.allSettled`, structured judge analysis with Zod `safeParse` graceful degradation, and non-streamed synthesis grounded in panel outputs and judge analysis. Contains Tasks 06–08.
- **Phase 3:** Streaming Synthesis — extends `ChatModelPort` with `stream()`, wires `SynthesizeStep` to stream tokens, yields `FusionStreamEvent` async iterables from the use case, and encodes OpenAI SSE with keep-alive comments and `AbortController`-based per-call timeouts. Contains Tasks 09–12.
- **Phase 4:** Anthropic API Compatibility — adds `AnthropicChatAdapter` (outbound) and the inbound `/v1/messages` route with request/response translation and SSE state machine emitting all 6 Anthropic event types in documented sequence. Contains Tasks 13–14.
- **Phase 5:** Polish — enhances `ConsoleLoggerAdapter` for per-stage cost/latency with structured `failed_models` reporting, delivers domain and application unit tests with stubbed ports, and produces README plus example `fusion.config.json` mixing local and remote providers. Contains Tasks 15–18.

## Task Order

| #   | Task                                             | Dependencies | Phase | Slice                                        |
| --- | ------------------------------------------------ | ------------ | ----- | -------------------------------------------- |
| 01  | Project scaffold and domain model types          | —            | 1     | Passthrough Chat Completion (OpenAI)         |
| 02  | Domain ports                                     | 01           | 1     | Passthrough Chat Completion (OpenAI)         |
| 03  | Application passthrough use case                 | 01, 02       | 1     | Passthrough Chat Completion (OpenAI)         |
| 04  | Infrastructure outbound adapters                 | 01, 02       | 1     | Passthrough Chat Completion (OpenAI)         |
| 05  | Infrastructure inbound HTTP, DI, and bootstrap   | 03, 04       | 1     | Passthrough Chat Completion (OpenAI)         |
| 06  | Domain types and services for ensemble           | 05           | 2     | Panel Fan-out + Synthesis, Judge Analysis    |
| 07  | Application ensemble services                    | 06           | 2     | Panel Fan-out + Synthesis, Judge Analysis    |
| 08  | Ensemble orchestration and config                | 07           | 2     | Panel Fan-out + Synthesis, Judge Analysis    |
| 09  | Domain streaming extension                       | 08           | 3     | Streaming Synthesis + Timeouts               |
| 10  | Streaming in application layer                   | 09           | 3     | Streaming Synthesis + Timeouts               |
| 11  | OpenAI streaming adapter and SSE encoder         | 09           | 3     | Streaming Synthesis + Timeouts               |
| 12  | Streaming inbound route and config               | 10, 11       | 3     | Streaming Synthesis + Timeouts               |
| 13  | Anthropic outbound adapter                       | 12           | 4     | Anthropic API Support                        |
| 14  | Anthropic inbound adapter                        | 13           | 4     | Anthropic API Support                        |
| 15  | Enhanced logging                                 | 14           | 5     | Observability, Tests, and Documentation      |
| 16  | Domain-layer unit tests                          | 15           | 5     | Observability, Tests, and Documentation      |
| 17  | Application-layer unit tests                     | 16           | 5     | Observability, Tests, and Documentation      |
| 18  | Documentation and example config                 | 17           | 5     | Observability, Tests, and Documentation      |

## Wave Analysis

- **Wave 1** (no dependencies): Task 01
- **Wave 2** (depends on Wave 1): Task 02
- **Wave 3** (depends on Wave 2, no mutual dependency): Tasks 03, 04
- **Wave 4** (depends on Wave 3): Task 05
- **Wave 5** (depends on Wave 4): Task 06
- **Wave 6** (depends on Wave 5): Task 07
- **Wave 7** (depends on Wave 6): Task 08
- **Wave 8** (depends on Wave 7): Task 09
- **Wave 9** (depends on Wave 8, no mutual dependency): Tasks 10, 11
- **Wave 10** (depends on Wave 9): Task 12
- **Wave 11** (depends on Wave 10): Task 13
- **Wave 12** (depends on Wave 11): Task 14
- **Wave 13** (depends on Wave 12): Task 15
- **Wave 14** (depends on Wave 13): Task 16
- **Wave 15** (depends on Wave 14): Task 17
- **Wave 16** (depends on Wave 15): Task 18

## Coverage Notes

- **AC-1** (package.json + tsconfig.json with Node 20+, strict TS, tsx dev) → Task 01
- **AC-2** (domain/app zero SDK/framework imports) → Tasks 01, 03, 05 (established); Tasks 06–18 maintain
- **AC-3** (ChatModelPort complete + stream signatures) → Tasks 02, 09
- **AC-4** (FusionService runFusion async iterable) → Task 03
- **AC-5** (OpenAiChatAdapter + factory selection + real client response) → Tasks 04, 05
- **AC-6** (JsonFileConfigAdapter + /v1/models stub) → Tasks 04, 05
- **AC-7** (PanelRunner parallel allSettled + all_panels_failed FusionError) → Tasks 06, 07, 08
- **AC-8** (JudgeStep JSON response_format + safeParse degradation) → Tasks 06, 07, 08
- **AC-9** (SynthesizeStep references panel + analysis, no unsourced claims) → Tasks 06, 07, 08
- **AC-10** (SSE keep-alive + chat.completion.chunk + [DONE]) → Tasks 10, 11, 12
- **AC-11** (AnthropicChatAdapter + /v1/messages translation + 6 SSE events) → Tasks 13, 14
- **AC-12** (AbortController timeout cancellation) → Tasks 11, 12
- **AC-13** (ConsoleLoggerAdapter per-stage cost/latency + failed_models details) → Task 15
- **AC-14** (domain + application unit tests with stubbed ports) → Tasks 16, 17
- **AC-15** (README architecture/setup/usage + example config mixing local/remote) → Task 18
- **NFR-1** (dependency rule: infra → app → domain) → Tasks 01, 02, 03, 04, 05 establish; Tasks 06–18 maintain
- **NFR-2** (Hono confined to src/infrastructure/inbound/http/) → Tasks 05, 12, 14
- **NFR-3** (openai SDK only in OpenAiChatAdapter; @anthropic-ai/sdk only in AnthropicChatAdapter) → Tasks 04, 11, 13
- **NFR-4** (only synthesis streams; panel/judge buffered; keep-alive comments) → Tasks 10, 12
- **NFR-5** (graceful degradation: panel all-fail fatal, judge never fatal) → Tasks 07, 08
- **NFR-6** (ConfigPort abstracts config schema) → Task 04
- **NFR-7** (per-stage cost/latency + failed_models with id/code/truncated message) → Task 15
- **Phase 1 Gate 1** (real client receives valid ChatCompletion JSON via passthrough) → Task 05
- **Phase 1 Gate 2** (zero SDK/framework imports in domain and application) → Tasks 01, 02, 03, 05
- **Phase 2 Gate 1** (response references panel outputs and judge analysis) → Task 08
- **Phase 2 Gate 2** (judge-unreachable graceful degradation with logged failure) → Tasks 07, 08
- **Phase 3 Gate 1** (curl stream:true receives SSE chat.completion.chunk + keep-alive + [DONE]) → Tasks 10, 12
- **Phase 3 Gate 2** (30s timeout aborts upstream and surfaces FusionError) → Tasks 11, 12
- **Phase 4 Gate 1** (curl /v1/messages receives all 6 Anthropic SSE events in sequence) → Task 14
- **Phase 4 Gate 2** (no Anthropic-specific types leak to domain/app) → Tasks 13, 14
- **Phase 5 Gate 1** (structured log lines per stage with duration, tokens, failed_models) → Task 15
- **Phase 5 Gate 2** (npm test ≥80% branch coverage on src/domain/ and src/application/) → Tasks 16, 17
- **src/domain/model/** → Tasks 01, 06
- **src/domain/services/** → Tasks 06, 16
- **src/domain/ports/** → Tasks 02, 09
- **src/application/ports/** → Task 03
- **src/application/usecases/** → Tasks 03, 07, 08, 10, 17
- **src/infrastructure/inbound/http/** → Tasks 05, 11, 12, 14
- **src/infrastructure/outbound/llm/** → Tasks 04, 11, 13
- **src/infrastructure/outbound/config/** → Task 04
- **src/infrastructure/outbound/logging/** → Tasks 04, 15
- **src/infrastructure/di/** → Tasks 05, 15
- **Root config (package.json, tsconfig.json, .env.example, fusion.config.json)** → Tasks 01, 05, 08, 12, 18
- **vitest.config.ts** → Task 16
- **Test files (__tests__/)** → Tasks 16, 17
- **README.md** → Task 18
