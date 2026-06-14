# Design

## Approach

**Hexagonal (ports-and-adapters) architecture with a single outbound port.** The dependency rule points inward: `infrastructure → application → domain`. The domain and application layers are pure TypeScript with zero imports from any SDK or framework. All I/O and provider SDKs are confined to infrastructure adapters, switched via a `ChatAdapterFactory` that selects by `provider.type`.

Rationale: the ensemble pipeline (fan-out → judge → streamed synthesis) has clear orchestration logic that must remain testable without real LLM calls or HTTP servers. The ports-and-adapters pattern, prescribed by the requirements (`requirements.md:85`, `goals.md:24–26`), decouples that logic from provider SDKs so the system can mix local (Ollama/LM Studio), OpenRouter, and direct OpenAI/Anthropic backends with no changes to the application layer.

The Inbound port is `FusionService.runFusion(request) → AsyncIterable<StreamEvent>` (`goals.md:73`). Both the OpenAI `/v1/chat/completions` and Anthropic `/v1/messages` HTTP routes call this same port; translation between provider-specific shapes and the canonical domain model lives entirely in the inbound adapters. The single outbound port `ChatModelPort` provides `complete()` and `stream()` using only domain types (`goals.md:62–63`); `ChatAdapterFactory` selects an `OpenAiChatAdapter` or `AnthropicChatAdapter` by `provider.type` (`goals.md:20`).

Graceful degradation is an application-layer concern: panel failure is fatal only when every panel model fails (`all_panels_failed` FusionError); judge failure omits analysis and synthesis falls back to raw panel responses (`goals.md:10,30`). Only the synthesis stage streams; panel and judge stages are fully buffered with SSE keep-alive comments covering the wait (`goals.md:13,27`).

## Architectural Patterns

- **Follow**: Hexagonal Ports & Adapters — dependency rule `infrastructure → application → domain`; domain and application layers have zero imports from SDKs or frameworks (`goals.md:24`, `requirements.md:85`).
- **Follow**: Single Outbound Port — `ChatModelPort` is the only interface for LLM calls; no provider-specific ports in the domain or application layers (`goals.md:62–63`).
- **Follow**: Adapter Factory — `ChatAdapterFactory` selects a concrete `ChatModelPort` implementation by `provider.type`, so application code depends only on the port interface (`goals.md:20`).
- **Follow**: Dependency Inversion — ports are defined in the domain (`ChatModelPort`, `ConfigPort`, `LoggerPort`) or application (`FusionService`); infrastructure adapters implement them (`goals.md:46–56`).
- **Follow**: Graceful Degradation in Application Layer — panel partial failures are collected; judge failure is never fatal; the use case decides fallback behavior (`goals.md:10,30`).
- **Follow**: Keep-Alive via SSE Comments — non-streamed stages emit `: comment\n\n` lines so the client connection does not time out (`goals.md:27,79`; Hono base `StreamingApi.write()` from research Q3).
- **Avoid**: Framework/SDK leakage — `openai` SDK used only in `OpenAiChatAdapter`; `@anthropic-ai/sdk` used only in `AnthropicChatAdapter`; Hono used only in `src/infrastructure/inbound/http/` (`goals.md:24–26`).
- **Avoid**: Provider-specific types in domain — Anthropic SSE event types (`message_start`, `content_block_delta`, `message_stop`, etc.) exist only in the Anthropic inbound/outbound adapters (`goals.md:63`).
- **Avoid**: Horizontal-layer decomposition — every buildable increment delivers end-to-end behavior across all layers; no phase delivers "all database migrations" or "all API endpoints" in isolation.

## System Diagram

```mermaid
flowchart TD
    subgraph clients["External Clients"]
        oai_client["OpenAI client (curl, SDK)"]
        anth_client["Anthropic client (curl, SDK)"]
    end

    subgraph inbound["Inbound Adapters (infrastructure/inbound/http)"]
        oai_route["POST /v1/chat/completions"]
        anth_route["POST /v1/messages"]
        models_route["GET /v1/models"]
        oai_xlate["OpenAI request/response translator"]
        anth_xlate["Anthropic request/response translator"]
        sse_oai["OpenAI SSE encoder"]
        sse_anth["Anthropic SSE encoder"]
    end

    subgraph app["Application Layer"]
        fusion_port["FusionService (inbound port)"]
        usecase["RunFusionUseCase"]
        panel["PanelRunner"]
        judge["JudgeStep"]
        synth["SynthesizeStep"]
    end

    subgraph domain["Domain Layer (pure)"]
        model["Message, PanelResponse, Analysis, ModelRef, FusionError"]
        services["Prompt builders, Analysis zod schema, grounding rules"]
        chat_port["ChatModelPort (outbound port)"]
        cfg_port["ConfigPort"]
        log_port["LoggerPort"]
    end

    subgraph outbound["Outbound Adapters (infrastructure/outbound)"]
        factory["ChatAdapterFactory"]
        oa_adapter["OpenAiChatAdapter"]
        anth_adapter["AnthropicChatAdapter"]
        cfg_adapter["JsonFileConfigAdapter"]
        log_adapter["ConsoleLoggerAdapter"]
    end

    subgraph di["Composition Root"]
        container["src/infrastructure/di/container.ts"]
        main["src/main.ts"]
    end

    oai_client --> oai_route
    anth_client --> anth_route
    models_route --> container

    oai_route --> oai_xlate --> fusion_port
    anth_route --> anth_xlate --> fusion_port

    fusion_port --> usecase
    usecase --> panel
    usecase --> judge
    usecase --> synth
    usecase --> model
    usecase --> services

    panel --> chat_port
    judge --> chat_port
    synth -->|stream()| chat_port

    chat_port -.->|implemented by| factory
    factory --> oa_adapter
    factory --> anth_adapter

    cfg_port -.->|implemented by| cfg_adapter
    log_port -.->|implemented by| log_adapter

    synth -->|StreamEvent async iterable| fusion_port
    fusion_port --> oai_xlate --> sse_oai --> oai_client
    fusion_port --> anth_xlate --> sse_anth --> anth_client

    oa_adapter -->|openai SDK| api_oai["OpenAI-compatible backends"]
    anth_adapter -->|@anthropic-ai/sdk| api_anth["Anthropic backends"]
    cfg_adapter -->|read| cfg_file["fusion.config.json"]

    main --> container
    container --> oai_route
    container --> anth_route
    container --> factory
    container --> cfg_adapter
    container --> log_adapter
```

**Flow summary**: Client HTTP request → inbound adapter translates to canonical types → `FusionService.runFusion()` → `RunFusionUseCase` orchestrates panel (parallel `Promise.allSettled` via `ChatModelPort.complete()`) → judge (`ChatModelPort.complete()` with JSON `response_format`) → synthesis (`ChatModelPort.stream()`) → yields `StreamEvent` iterable → inbound adapter encodes as provider-specific SSE → client.

## Vertical Slices

Each slice delivers independently testable end-to-end behavior across all layers. No slice is a pure horizontal layer.

### Slice 1: Passthrough Chat Completion (OpenAI)

Delivers a working OpenAI-compatible `/v1/chat/completions` endpoint that proxies to a single configured model. Proves the hexagonal wiring, dependency rule, config loading, and real outbound LLM call end-to-end.

- **Components**:
  - Domain: `Message`, `ModelRef`, `FusionError`, `ChatModelPort` (interface), `ConfigPort` (interface), `LoggerPort` (interface)
  - Application: `FusionService` (inbound port), `RunFusionUseCase` (passthrough: calls one model via `ChatModelPort.complete()`)
  - Inbound: Hono server (`src/infrastructure/inbound/http/server.ts`), OpenAI route + request/response translator, `/v1/models` stub
  - Outbound: `JsonFileConfigAdapter`, `OpenAiChatAdapter`, `ChatAdapterFactory`, `ConsoleLoggerAdapter` (minimal)
  - DI: `container.ts`, `main.ts`
  - Config: `fusion.config.json` with single provider entry
- **Dependencies**: None (first slice)

### Slice 2: Panel Fan-out + Non-streamed Synthesis

Adds multi-model fan-out with parallel panel execution and a non-streamed synthesis step that aggregates panel outputs. The system now calls multiple models, collects results (including partial failures), and produces a synthesized response.

- **Components**:
  - Domain: `PanelResponse` value object, prompt builders for synthesis
  - Application: `PanelRunner` (`Promise.allSettled`, `failed_models` collection, `all_panels_failed` `FusionError`), `SynthesizeStep` (non-streamed `ChatModelPort.complete()`)
  - Modified: `RunFusionUseCase` orchestrates panel → synthesize sequence
  - Config: `fusion.config.json` extended with multiple panel providers
- **Dependencies**: Slice 1

### Slice 3: Judge Analysis with Graceful Degradation

Adds a structured judge step between panel and synthesis. The judge model is called with JSON `response_format`; its output is validated against the `Analysis` zod schema. On judge failure or schema validation failure, the use case degrades gracefully — synthesis proceeds with raw panel responses. When the judge succeeds, the analysis enriches the synthesis prompt.

- **Components**:
  - Domain: `Analysis` zod schema (`consensus`, `contradictions`, `unique_insights`, `blind_spots`), judge prompt builder, `zod` usage confined to domain services
  - Application: `JudgeStep` (calls `ChatModelPort.complete()` with `response_format`, parses via `safeParse`)
  - Modified: `RunFusionUseCase` adds judge stage with graceful degradation; `SynthesizeStep` accepts optional `Analysis` in prompt
- **Dependencies**: Slice 2

### Slice 4: Streaming Synthesis + Timeouts

Adds streaming support so the synthesis stage streams tokens via SSE. Domain stream events are defined, `ChatModelPort.stream()` is added, and the inbound OpenAI adapter encodes them as `chat.completion.chunk` SSE events with `[DONE]` termination. Keep-alive comments cover the non-streamed panel and judge phases. Per-call `AbortController` timeouts are surfaced through `ChatModelPort`.

- **Components**:
  - Domain: `StreamEvent` types, `ChatModelPort.stream()` signature
  - Application: `SynthesizeStep` uses `stream()` instead of `complete()`; `RunFusionUseCase` yields `AsyncIterable<StreamEvent>`
  - Inbound: OpenAI SSE encoder (`chat.completion.chunk` … `[DONE]`), keep-alive comment emission during panel/judge waits
  - Outbound: `OpenAiChatAdapter.stream()` implementation, `AbortController` wiring
  - Modified: `ChatModelPort` extended with `stream()`
- **Dependencies**: Slice 3

### Slice 5: Anthropic API Support

Adds full Anthropic API compatibility: outbound `AnthropicChatAdapter` implementing `ChatModelPort` via `@anthropic-ai/sdk`, and inbound `/v1/messages` route with request/response translation and SSE mapping (`message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`). Reuses the same `FusionService`.

- **Components**:
  - Outbound: `AnthropicChatAdapter` (canonical ↔ Anthropic SDK types), registered in `ChatAdapterFactory` for `provider.type === 'anthropic'`
  - Inbound: Anthropic route + request translator (Anthropic-format request → canonical), response translator + SSE encoder (canonical `StreamEvent` → Anthropic SSE events)
  - Config: `fusion.config.json` entries with `type: "anthropic"`
- **Dependencies**: Slice 4

### Slice 6: Observability, Tests, and Documentation

Wires `ConsoleLoggerAdapter` for per-stage cost/latency logging with structured `failed_models` reporting. Adds domain-layer unit tests (pure, no mocks) and application-layer unit tests (stubbed ports). Produces README with architecture diagram, setup instructions, and example `fusion.config.json` mixing local and remote providers.

- **Components**:
  - Infrastructure: `ConsoleLoggerAdapter` with per-stage child loggers, `Date.now()` latency deltas, structured `failed_models` entries (model identifier, error code, truncated message)
  - Tests: Domain tests for `Analysis` schema validation, prompt builder output shapes, `FusionError` codes; application tests for `RunFusionUseCase`, `PanelRunner`, `JudgeStep`, `SynthesizeStep` with stubbed `ChatModelPort` and `ConfigPort`
  - Docs: `README.md`, example `fusion.config.json`
- **Dependencies**: Slices 1–5

## Phases

### Phase 1: Core Passthrough

Delivers a working OpenAI-compatible passthrough endpoint, proving the hexagonal architecture, dependency rule, config loading, and real outbound LLM integration.

- **Included Slices**: Slice 1
- **Replan Gate**:
  - A real OpenAI-compatible client (e.g., `curl`) receives a valid `ChatCompletion` JSON response through `POST /v1/chat/completions` with streaming disabled.
  - `src/domain/` contains zero imports from `src/application/` and `src/infrastructure/`; `src/application/` contains zero imports from `src/infrastructure/` (verified by grep or tooling).

### Phase 2: Ensemble Pipeline (Panel + Judge + Synthesis)

Delivers the core ensemble: parallel fan-out to multiple panel models, structured judge analysis with graceful degradation, and a non-streamed synthesis that incorporates panel outputs and judge analysis.

- **Included Slices**: Slice 2, Slice 3
- **Replan Gate**:
  - When all three panel models are configured and reachable, the `/v1/chat/completions` response content references at least one element from the panel outputs and at least one element from the judge analysis (`consensus`, `contradiction`, `unique_insight`, or `blind_spot`).
  - When the judge model is unreachable, the system still returns a valid synthesis response (graceful degradation) and logs the judge failure with error details.

### Phase 3: Streaming Synthesis

Delivers streamed synthesis via SSE, with keep-alive comments during buffered stages and proper SSE event framing for OpenAI clients.

- **Included Slices**: Slice 4
- **Replan Gate**:
  - A `curl` request with `stream: true` to `/v1/chat/completions` receives SSE `data:` lines with `object: "chat.completion.chunk"` payloads, terminated by `data: [DONE]`, with keep-alive comments (`: panel running`, `: judging`) visible in the stream before the first content chunk.
  - A per-call timeout of 30 seconds (configurable) correctly cancels the upstream LLM call via `AbortController` and surfaces the cancellation as a `FusionError` in the stream metadata.

### Phase 4: Anthropic API Compatibility

Delivers full Anthropic API compatibility on both inbound and outbound sides, reusing the same `FusionService`.

- **Included Slices**: Slice 5
- **Replan Gate**:
  - A `curl` request to `POST /v1/messages` with an Anthropic-format body (including `max_tokens`, `messages`, and `model`) receives SSE events in the documented sequence: `message_start`, `content_block_start`, `content_block_delta` (multiple), `content_block_stop`, `message_delta`, `message_stop`, using both `event:` and `data:` SSE fields.
  - The Anthropic outbound adapter correctly calls an Anthropic-compatible backend (e.g., direct Anthropic API or a local Anthropic-compatible endpoint) and maps the canonical request/response types without leaking Anthropic-specific shapes into the domain or application layers.

### Phase 5: Polish

Delivers production-grade observability, test coverage, and documentation.

- **Included Slices**: Slice 6
- **Replan Gate**:
  - `ConsoleLoggerAdapter` emits structured log lines for each stage (panel, judge, synthesis) containing: stage name, duration in milliseconds, token counts (prompt + completion), and for panel: `failed_models` array with model identifier, error code, and truncated message (≤200 chars).
  - `npm test` executes domain-layer unit tests (zero mocks required) and application-layer unit tests (stubbed ports) with ≥80% branch coverage on `src/domain/` and `src/application/`.

## Test Strategy

| Slice | Unit Tests | Integration Tests | E2E Tests | Key Behaviors |
|-------|------------|-------------------|-----------|---------------|
| **Slice 1** | `FusionError` constructor sets code; `ConfigPort` interface shape; `ChatModelPort` interface shape | `JsonFileConfigAdapter` loads valid `fusion.config.json`; `OpenAiChatAdapter.complete()` maps canonical request to SDK params; Hono route returns 200 for valid request | `curl POST /v1/chat/completions` returns valid `ChatCompletion` JSON; `GET /v1/models` returns array with model entries | Dependency rule holds (no SDK imports in domain/app); passthrough response matches single-model output |
| **Slice 2** | `PanelRunner` aggregates results from `Promise.allSettled` shape; `all_panels_failed` throws `FusionError` when every result is rejected; `failed_models` includes model id and error | `PanelRunner` with stubbed `ChatModelPort` (2 fulfill, 1 reject) returns partial success envelope; `SynthesizeStep` prompt includes panel outputs | `curl POST /v1/chat/completions` with 3 configured panel models returns synthesis referencing panel content | Partial panel failure is reported; total panel failure returns `FusionError`; synthesis prompt is grounded in panel outputs |
| **Slice 3** | `Analysis` schema: valid JSON parses to `Analysis`; missing `consensus` fails `safeParse`; `safeParse` returns `{success: false}` for malformed judge output | `JudgeStep` with stubbed `ChatModelPort` returning valid JSON parses `Analysis`; judge returning invalid JSON triggers graceful degradation and logs failure via `LoggerPort`; `SynthesizeStep` prompt includes analysis fields when available | `curl` request with judge enabled returns response referencing analysis; `curl` request with judge unreachable returns response from panel-only synthesis | Judge failure never blocks response; `safeParse` degradation path is exercised; analysis fields appear in synthesis when judge succeeds |
| **Slice 4** | `StreamEvent` union types discriminate correctly; SSE encoder converts `StreamEvent` to SSE wire format strings | `SynthesizeStep.stream()` yields `StreamEvent` chunks; keep-alive comments emitted before first content event; `AbortController` fires on timeout threshold | `curl -N POST /v1/chat/completions` with `stream: true` receives SSE stream with `chat.completion.chunk` objects, keep-alive comments during wait, `data: [DONE]` termination | Streaming starts only after panel+judge complete; keep-alive prevents client timeout; `[DONE]` sentinel always emitted; timeout aborts upstream and surfaces error |
| **Slice 5** | Anthropic request translator maps `messages` array to canonical `Message[]`; Anthropic SSE encoder maps `StreamEvent` to `message_start`/`content_block_delta`/`message_stop` sequence | `AnthropicChatAdapter.complete()` maps canonical request to Anthropic SDK params; inbound `/v1/messages` route parses Anthropic-format body and calls `FusionService` | `curl POST /v1/messages` with Anthropic-format body receives SSE stream in correct event sequence (`message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`); each event has both `event:` and `data:` SSE fields | All 6 Anthropic SSE event types emitted in documented order; `FusionService` is reused unchanged; no Anthropic-specific types leak to domain/app |
| **Slice 6** | Domain: `Analysis` schema rejects missing required fields; `Analysis` schema accepts all optional fields; `FusionError` codes match expected values; prompt builder outputs contain expected strings for given inputs | Application: `RunFusionUseCase` with stubbed ports orchestrates full pipeline; `PanelRunner` edge cases (0 models, all fail, all succeed); `JudgeStep` handles both `complete()` resolve and reject; `SynthesizeStep` prompt includes both panel and analysis content when available | Full pipeline E2E: `curl` request to `/v1/chat/completions` returns streamed response with panel, judge, and synthesis stages logged to console | Per-stage log lines include stage name, latency (ms), token counts; `failed_models` log entries include model identifier, error code, truncated message; README describes architecture, setup, and usage; example config mixes local + remote providers |

## Trade-offs Considered

- **Config schema: Pattern 2 (registry + context groups)** — rejected because it adds indirection without commensurate benefit for this project's scale. A flat provider array with inline `role` field (Pattern 1) keeps the config file readable and `ConfigPort` abstracts the schema so the application never depends on it. If multi-tenancy or model pools are needed later, the port can be re-implemented with a different adapter.
- **Separate ports per provider (OpenAIPort, AnthropicPort)** — rejected per `goals.md:62–63`; a single `ChatModelPort` with `complete()` and `stream()` keeps the application layer agnostic to provider identity and simplifies the use-case code.
- **Streaming panel and judge stages** — rejected per `goals.md:13,27`; only the synthesis stage streams. Buffering panel and judge simplifies the orchestration (no concurrent stream multiplexing) and the stream events carry only synthesis content.
- **DI container library (tsyringe, inversify)** — rejected; manual DI in `src/infrastructure/di/container.ts` is sufficient for this project's scope (fewer than 10 adapters). Adding a DI library would violate the "no speculative abstractions" principle and increase bundle complexity.
- **Structured-logging library (pino, winston)** — rejected; `ConsoleLoggerAdapter` using `console.log` with structured JSON objects meets the observability requirements without an external dependency. A library can be introduced later behind the same `LoggerPort` if ndjson output or log levels are needed.
- **Streaming both panel and synthesis** — rejected; only synthesis streams. Dual-stream fan-out would require merging multiple SSE streams and complicates graceful degradation. Panel results are collected in full before synthesis begins, which also enables the judge to see complete panel outputs.

## Key Decisions

| Decision | Choice | Alternative Considered | Rationale |
|----------|--------|------------------------|-----------|
| Config schema | Flat `providers` array with `role` field per entry (`"role": "panel" \| "judge" \| "synthesizer"`) and `model` field | Separate `panel`/`judge`/`synthesizer` config blocks (Pattern 2); model-centric routing (Pattern 3) | Simplest for 3 roles; `ConfigPort.getPanelModels()`, `getJudgeModel()`, `getSynthesizerModel()` abstract the schema so application never sees the raw config (`goals.md:28,61`). Research Q6 catalogued all three patterns. |
| Anthropic SSE events | Emit all 6 event types in documented sequence: `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop` | Emit only the 3 types referenced in goals (`message_start`, `content_block_delta`, `message_stop`) | The `@anthropic-ai/sdk` v0.104.1 `RawMessageStreamEvent` union defines 6 types. Omitting `content_block_start`, `content_block_stop`, and `message_delta` would break wire compatibility with Anthropic client SDKs (research Q2, CONFLICT-ANTHROPIC-SSE-EVENTS). |
| SDK versions | `openai@^6.42.0`, `@anthropic-ai/sdk@^0.104.1` | `openai@^4.0.0`, `@anthropic-ai/sdk@^0.30.0` (as referenced in `goals.md:108`) | Research conducted against v6/v0.104.1 actual installations; these versions are current and confirmed to expose the required APIs (`stream()` convenience methods, `response_format`, `AbortSignal` passthrough). Using researched versions avoids CONFLICT-SDK-VERSIONS surprises. |
| Testing framework | vitest v4.x with `vi.fn()` stubs | jest, node:test | vitest v4.1.5 identified from sibling project (`/home/n3m6/src/zoink/`); provides the mocking primitives (`mockResolvedValue`, `mockRejectedValue`) needed for port stubs; colocated `*.spec.ts` convention matches hexagonal test patterns (research Q11). |
| Streaming API | Hono `streamSSE()` helper with `SSEStreamingApi.writeSSE()` for data events and base `StreamingApi.write()` for keep-alive comments | `stream()` with manual SSE framing; raw `TransformStream` | Hono's `streamSSE` handles SSE framing, `event:`/`data:` serialization, and connection lifecycle (`onAbort`). The base `StreamingApi.write(': comment\n\n')` is the documented way to emit SSE comments (research Q3). |
| JSON structured output | OpenAI `response_format: { type: "json_object" }` for judge call; Zod `safeParse` for validation | Anthropic `output_config.format`; manual JSON parsing | Judge model is called via `ChatModelPort.complete()`, which delegates to the provider adapter. OpenAI adapter uses `response_format`; Anthropic adapter uses `output_config`. Both return a string that the application layer parses with `safeParse`. The application layer never knows which provider the judge uses. |
| Timeout values | Default 30s per LLM call, configurable via `fusion.config.json` `timeoutMs` field | Hard-coded 60s; no timeout | Research found no prescribed timeout (GAP-TIMEOUT-VALUES). 30s is a reasonable default for local and remote models; configurability keeps it flexible without over-engineering. |
| Cost logging | Token counts logged per stage; no monetary cost calculation | Per-token pricing with provider-specific rate tables | No cost model specified (GAP-COST-MODEL in `goals.md`). Token counts (available from both SDKs, research Q9) provide sufficient observability for the current scope. Monetary cost can be added later behind `LoggerPort`. |
| Import enforcement | Manual verification via grep scripts (`grep -r "from 'openai'" src/domain/`) in CI/lint | eslint-plugin-boundaries, dependency-cruiser, tsconfig paths (research Q5) | No tool prescribed (GAP-IMPORT-ENFORCEMENT). Grep is zero-dependency and sufficient for the small module count (~20 files). A lint plugin can be added later without changing architecture. |

## Final Checks

- [x] No requirements added beyond what the provided inputs specify.
- [x] No speculative abstractions, extensibility hooks, or future-proofing unless the goals require them.
- [x] Every slice is vertical (delivers end-to-end behavior and is independently testable). Nothing organized as a horizontal layer (database, API, service, UI).
- [x] No foundation slice present — Slice 1 is a full vertical slice that delivers end-to-end passthrough behavior while establishing the hexagonal skeleton. All later slices build on prior slices incrementally.
- [x] The Mermaid diagram shows connected components and flow — not a list of isolated boxes.
- [x] Every phase has a replan gate with at least two concrete, testable criteria.
- [x] The test strategy names specific behaviors per slice (not "add tests").
- [x] The design is concrete enough for `qrspi-structure-mapper` to identify components, files, interfaces, and contracts.
