# Implementation Plan

## Overview

The Fusion Local Proxy is a TypeScript local proxy server that exposes OpenAI- and Anthropic-compatible HTTP APIs while internally running an ensemble pipeline: fan-out to a configurable panel of models, an optional judge analysis, and a streamed synthesis response. The system uses a hexagonal (ports-and-adapters) architecture so the domain and application layers are pure and testable, with all I/O and provider SDKs confined to infrastructure adapters.

The implementation proceeds in five phases. Phase 1 delivers a working OpenAI-compatible passthrough endpoint, proving the hexagonal architecture end-to-end. Phase 2 adds the ensemble pipeline: parallel panel fan-out with graceful degradation, a structured judge step with safe-parsing fallback, and a non-streamed synthesis stage. Phase 3 adds streaming synthesis via SSE with keep-alive comments and AbortController-based timeouts. Phase 4 adds full Anthropic API compatibility on both inbound and outbound sides. Phase 5 delivers observability (per-stage cost/latency logging), unit tests for domain and application layers, and documentation. Each phase produces a runnable system; no phase delivers only horizontal-layer artifacts.

## Phase Summary

- **Phase 1:** Core Passthrough — establishes the hexagonal skeleton and delivers a working OpenAI-compatible `/v1/chat/completions` passthrough endpoint. Contains Task 01.
- **Phase 2:** Ensemble Pipeline — adds parallel panel fan-out (Task 02) and structured judge analysis with graceful degradation (Task 03). The system orchestrates panel → judge → non-streamed synthesis.
- **Phase 3:** Streaming Synthesis — adds `ChatModelPort.stream()`, domain stream events, OpenAI SSE encoding with keep-alive comments, and `AbortController`-based per-call timeouts. Contains Task 04.
- **Phase 4:** Anthropic API Compatibility — adds `AnthropicChatAdapter` (outbound) and the inbound `/v1/messages` route with request/response translation and SSE mapping for all 6 Anthropic event types. Contains Task 05.
- **Phase 5:** Polish — enhances `ConsoleLoggerAdapter` for per-stage observability (Task 06), delivers domain-layer unit tests (Task 07) and application-layer unit tests (Task 08), and produces README plus example `fusion.config.json` (Task 09).

## Task Order

| #   | Task                                                  | Dependencies | Phase | Slice                                          |
| --- | ----------------------------------------------------- | ------------ | ----- | ---------------------------------------------- |
| 01  | Core Passthrough: hexagonal skeleton + OpenAI endpoint | —            | 1     | Passthrough Chat Completion (OpenAI)           |
| 02  | Panel fan-out + non-streamed synthesis                | 01           | 2     | Panel Fan-out + Non-streamed Synthesis         |
| 03  | Judge analysis with graceful degradation              | 02           | 2     | Judge Analysis with Graceful Degradation       |
| 04  | Streaming synthesis + timeouts                        | 03           | 3     | Streaming Synthesis + Timeouts                 |
| 05  | Anthropic API support (inbound + outbound)             | 04           | 4     | Anthropic API Support                          |
| 06  | Observability: enhanced ConsoleLoggerAdapter           | 05           | 5     | Observability, Tests, and Documentation        |
| 07  | Domain-layer unit tests                               | 06           | 5     | Observability, Tests, and Documentation        |
| 08  | Application-layer unit tests                          | 06           | 5     | Observability, Tests, and Documentation        |
| 09  | README + example fusion.config.json                   | 05           | 5     | Observability, Tests, and Documentation        |

## Wave Analysis

- **Wave 1** (no dependencies): Task 01
- **Wave 2** (depends on Wave 1): Task 02
- **Wave 3** (depends on Wave 2): Task 03
- **Wave 4** (depends on Wave 3): Task 04
- **Wave 5** (depends on Wave 4): Task 05
- **Wave 6** (depends on Wave 5, no mutual dependency): Tasks 06, 09
- **Wave 7** (depends on Wave 6): Tasks 07, 08

## Coverage Notes

- **AC-1** (project scaffold with Node 20+, strict TS, tsx dev) → Task 01
- **AC-2** (domain/app zero SDK/framework imports) → Task 01 (established); Tasks 02, 03, 04, 05, 06 maintain
- **AC-3** (ChatModelPort complete + stream signatures) → Tasks 01, 04
- **AC-4** (FusionService runFusion async iterable) → Task 01
- **AC-5** (OpenAiChatAdapter + factory selection + real client response) → Task 01
- **AC-6** (JsonFileConfigAdapter + /v1/models stub) → Task 01
- **AC-7** (PanelRunner parallel allSettled + all_panels_failed FusionError) → Task 02
- **AC-8** (JudgeStep JSON response_format + safeParse degradation) → Task 03
- **AC-9** (SynthesizeStep references panel + analysis, no unsourced claims) → Tasks 02, 03
- **AC-10** (SSE keep-alive + chat.completion.chunk + [DONE]) → Task 04
- **AC-11** (AnthropicChatAdapter + /v1/messages translation + SSE event sequence) → Task 05
- **AC-12** (AbortController timeout cancellation) → Task 04
- **AC-13** (ConsoleLoggerAdapter per-stage cost/latency + failed_models details) → Task 06
- **AC-14** (domain + application unit tests with stubbed ports) → Tasks 07, 08
- **AC-15** (README architecture/setup/usage + example config mixing local/remote) → Task 09
- **NFR-1** (dependency rule: infra → app → domain, zero SDK imports in domain/app) → Tasks 01, 02, 03, 04, 05, 06, 07, 08, 09
- **NFR-2** (Hono confined to src/infrastructure/inbound/http/) → Tasks 01, 04, 05
- **NFR-3** (openai SDK only in OpenAiChatAdapter; @anthropic-ai/sdk only in AnthropicChatAdapter) → Tasks 01, 05
- **NFR-4** (only synthesis streams; panel/judge buffered; keep-alive comments) → Task 04
- **NFR-5** (graceful degradation: panel all-fail fatal, judge never fatal, partial panel in metadata) → Tasks 02, 03
- **NFR-6** (ConfigPort abstracts config schema; app never reads fusion.config.json directly) → Task 01
- **NFR-7** (per-stage cost/latency + failed_models with id/code/truncated message) → Task 06
- **Phase 1 Gate 1** (real client receives valid ChatCompletion JSON via passthrough) → Task 01
- **Phase 1 Gate 2** (zero SDK/framework imports in domain and application layers) → Task 01
- **Phase 2 Gate 1** (response references both panel outputs and judge analysis) → Tasks 02, 03
- **Phase 2 Gate 2** (judge-unreachable graceful degradation with logged failure) → Task 03
- **Phase 3 Gate 1** (curl stream:true receives SSE chat.completion.chunk + keep-alive + [DONE]) → Task 04
- **Phase 3 Gate 2** (30s timeout aborts upstream and surfaces FusionError) → Task 04
- **Phase 4 Gate 1** (curl /v1/messages receives all 6 Anthropic SSE events in sequence) → Task 05
- **Phase 4 Gate 2** (no Anthropic-specific types leak to domain/app) → Task 05
- **Phase 5 Gate 1** (structured log lines per stage with duration, tokens, failed_models) → Task 06
- **Phase 5 Gate 2** (npm test ≥80% branch coverage on src/domain/ and src/application/) → Tasks 07, 08
- **src/domain/model/** → Tasks 01, 02, 03
- **src/domain/services/** → Tasks 02, 03
- **src/domain/ports/** → Tasks 01, 04
- **src/application/ports/** → Task 01
- **src/application/usecases/** → Tasks 01, 02, 03, 04
- **src/infrastructure/inbound/http/** → Tasks 01, 04, 05
- **src/infrastructure/outbound/llm/** → Tasks 01, 04, 05
- **src/infrastructure/outbound/config/** → Task 01
- **src/infrastructure/outbound/logging/** → Tasks 01, 06
- **src/infrastructure/di/** → Tasks 01, 06
- **Root config (package.json, tsconfig.json, .env.example, fusion.config.json)** → Tasks 01, 02, 04, 09
- **vitest.config.ts** → Task 06
- **Test files (__tests__/)** → Tasks 07, 08
- **README.md** → Task 09
