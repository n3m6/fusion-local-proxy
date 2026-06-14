# Research Summary

## Overview
The repository is a greenfield TypeScript project containing no source code, dependencies, or configuration files beyond a `README.md` (one-line description), `LICENSE` (MIT), and `.gitignore`. Research was conducted against installed SDK packages at `/tmp/` (`openai@6.42.0`, `@anthropic-ai/sdk@0.104.1`, `hono@4.12.25`), a sibling project's vitest installation at `/home/n3m6/src/zoink/`, official documentation websites (hono.dev, MDN, npm registries), published literature (prompt engineering papers, hexagonal-architecture guides), and the project's own `.pipeline/` planning documents. The planning documents (`requirements.md`, `goals.md`) prescribe a hexagonal ports-and-adapters architecture targeting Node.js 20+, Hono v4, strict TypeScript, ESM modules, and `tsx` dev execution. The findings catalogue SDK method signatures, SSE streaming formats, config-schema patterns, structured-logging libraries, prompt engineering techniques, testing patterns, and scaffolding conventions needed to begin implementation.

## Per-Question Findings
| Question | Source | Status | Key Facts |
|----------|--------|--------|-----------|
| Q-01 | web/hybrid | FOUND | OpenAI `/v1/chat/completions` schema fully catalogued from installed `openai@6.42.0` SDK type definitions at `/tmp/openai-sdk/package/`. Covers 32 request parameters (2 required: `messages`, `model`; 30 optional), 6 message role shapes, 4 ContentPart types, `ChatCompletion` non-streaming response (10 fields), `ChatCompletionChunk` streaming response (8 fields), and SSE wire format: `data:` lines carrying `object: "chat.completion.chunk"` JSON payloads, final usage chunk when `stream_options.include_usage: true`, `data: [DONE]` sentinel termination, SSE comment lines (`:` prefix) for keep-alive. No `event:` field emitted for chat-completion chunks. |
| Q-02 | web/hybrid | FOUND | Anthropic `/v1/messages` schema fully catalogued from installed `@anthropic-ai/sdk@0.104.1` SDK type definitions at `/tmp/anthropic-sdk/package/`. Covers 17 request parameters (3 required: `max_tokens`, `messages`, `model`; 14 optional including `stream`, `thinking`, `tools`, `output_config`), `Message` non-streaming response (10 fields including `content: Array<ContentBlock>`, `stop_reason`, `usage`), and 6 SSE event types in fixed sequence: `message_start` → (`content_block_start` → `content_block_delta`* → `content_block_stop`)* → `message_delta` → `message_stop`. Each event uses both `event:` and `data:` SSE fields. Five delta types catalogued: `text_delta`, `input_json_delta`, `citations_delta`, `thinking_delta`, `signature_delta`. |
| Q-03 | web/hybrid | FOUND | Hono v4 API surface documented from installed `hono@4.12.25` at `/tmp/hono-inspect/` and official docs at `https://hono.dev/docs/`. Three streaming helpers: `stream()`, `streamText()`, `streamSSE()` from `hono/streaming`. `SSEStreamingApi.writeSSE()` serialises `SSEMessage` (`{ data, event?, id?, retry? }`) to SSE wire format. Keep-alive/progress comments emitted via base `StreamingApi.write(': comment\n\n')`. Stream lifecycle: `TransformStream` with auto-close on callback resolution, optional `onError` handler, `onAbort()` for cleanup. JSON responses via `c.json()`, routing via `app.route(path, subApp)` and `app.basePath()`, Node.js serving via `@hono/node-server`. |
| Q-04 | web | FOUND | Both SDKs expose overloaded `create()` methods discriminated by `stream` boolean literal, dedicated `stream()` convenience methods returning rich stream objects with event emitters, structured-output parameters (`response_format` for OpenAI, `output_config.format` for Anthropic), and `AbortSignal` passthrough via a shared `RequestOptions.signal` field plus first-class `AbortController` on stream objects. OpenAPI types from `openai@6.42.0` at `/tmp/openai-sdk/package/`, Anthropic types from `@anthropic-ai/sdk@0.104.1` at `/tmp/anthropic-sdk/package/`. |
| Q-05 | web | FOUND | Three-layer hexagonal layout prescribed by `requirements.md:89–99` and `goals.md:46–56`: `src/domain/` (model, services, ports), `src/application/` (ports, usecases), `src/infrastructure/` (inbound/http, outbound/llm, outbound/config, outbound/logging, di). Outbound ports in domain: `ChatModelPort`, `ConfigPort`, `LoggerPort`, `ClockPort`. Inbound port in application: `FusionService` with `runFusion(request) -> AsyncIterable<StreamEvent>`. Manual DI via composition root (`src/infrastructure/di/container.ts`) planned; no DI container library selected. Import enforcement mechanism (AC-2) not specified — four techniques catalogued from literature: eslint-plugin-boundaries, dependency-cruiser, tsconfig paths, Nx module boundaries. |
| Q-06 | web | FOUND | Three JSON config-schema patterns surveyed for multi-provider API gateways: (1) flat provider array with inline per-provider role assignment (low complexity, moderate extensibility), (2) provider registry + named context groups with two-level separation (medium complexity, high extensibility), (3) model-centric routing where each entry represents a specific model instance (high complexity, very high extensibility). C-1 (`goals.md:61`) explicitly marks the config schema as an open question. `ConfigPort` and `JsonFileConfigAdapter` are planned abstractions insulating the application from schema choice. |
| Q-07 | web | FOUND | `Promise.allSettled` returns `PromiseFulfilledResult<T>` (`{ status: "fulfilled", value: T }`) and `PromiseRejectedResult` (`{ status: "rejected", reason: any }`). Two error-aggregation patterns catalogued: (A) collect-and-classify with partial-success envelope separating successes from failures, (B) native `AggregateError` (ES2021/Node 15+) for total-failure signalling. A common production approach combines both: envelope for partial failures, `AggregateError` throw on total failure. Specification references `all_panels_failed` `FusionError` at `goals.md:10,30`. |
| Q-08 | web | FOUND | Zod v3 API surface documented: schema definition via compositional constructors (`z.object`, `z.array`, `z.string`, etc.), modifiers (`.optional`, `.nullable`, `.default`), refinements (`.refine`, `.superRefine`). `safeParse()` returns discriminated union `{ success: true, data: T }` or `{ success: false, error: ZodError }`. `ZodError` provides `issues: ZodIssue[]` with `code`, `path`, `message`; `format()` for nested error trees; `flatten()` for dot-path field errors. FR-5 (`goals.md:11`) defines four `Analysis` fields; AC-8 (`goals.md:77`) requires `safeParse` for graceful degradation. |
| Q-09 | web | FOUND | OpenAI returns `CompletionUsage` (`prompt_tokens`, `completion_tokens`, `total_tokens`, optional `completion_tokens_details` and `prompt_tokens_details`) and a `created` Unix timestamp; no latency/duration fields. Anthropic returns `Usage` (`input_tokens`, `output_tokens`, cache-creation/read tokens, `thinking_tokens`, `server_tool_use`, `service_tier`, `inference_geo`); no timestamp or latency fields. Streaming usage: OpenAI delivers on final chunk only (requires `stream_options.include_usage: true`); Anthropic delivers cumulative counts via `message_delta` event. Both require client-side wall-clock measurement for latency. Types from `/tmp/openai-sdk/package/` and `/tmp/anthropic-sdk/package/`. |
| Q-10 | web | FOUND | `tsconfig.json` settings satisfying AC-1 (`goals.md:85`): `"strict": true`, `"target": "ES2023"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"esModuleInterop": true`, `"skipLibCheck": true`, `"resolveJsonModule": true`, `"isolatedModules": true`. `package.json`: `"type": "module"`, `"engines": { "node": ">=20.0.0" }`, `"scripts": { "dev": "tsx src/main.ts" }`, devDependencies on `tsx`, `typescript`, `@types/node`. Minimal examples provided for both files. |
| Q-11 | codebase/hybrid | FOUND | vitest v4.1.5 identified from sibling project at `/home/n3m6/src/zoink/zoink-cli/node_modules/vitest/`. Mocking primitives catalogued from `@vitest/spy` type definitions: `vi.fn()`, `vi.spyOn()`, `vi.mock()`, `MockInstance` with `.mockImplementation`, `.mockResolvedValue`, `.mockRejectedValue`, lifecycle methods (`.mockClear`, `.mockReset`, `.mockRestore`). Stub pattern for port interfaces: plain object with `vi.fn()`-assigned methods configured via `.mockResolvedValue()`. Colocated `*.spec.ts` convention observed (`vitest.config.ts` uses `include: ['src/**/*.spec.ts']`). Domain tests use no mocks; application tests inject stubbed ports. AC-14 (`goals.md:83`) describes but does not prescribe framework. |
| Q-12 | web | FOUND | Three judge prompt patterns catalogued from published literature: LLM-as-a-Judge with structured rubric (Zheng et al., 2023), Comparative Chain-of-Thought (Wei et al., 2022), Multi-Agent Debate/Moderator (Du et al., 2023). Three synthesis patterns: Source-Grounded Synthesis with explicit grounding rules (Lewis et al., 2020), Mixture-of-Agents aggregation (Wang et al., 2024), Principle-Guided/Constitutional synthesis (Bai et al., 2022). AC-9 (`goals.md:78`) requires synthesis to reference both analysis and panel outputs without unsourced claims. |
| Q-13 | web | FOUND | Three structured-logging libraries documented: pino v10.3.1 (ndjson, `err` key convention for error serialisation, `child()` for per-stage metadata, `mixin()` for dynamic fields, no built-in profiler), winston v3.19.0 (transport ecosystem, `defaultMeta` + `child()`, built-in `profile()`/`startTimer()` for latency, explicit format-based error serialisation), bunyan v1.8.15 (`child()` for bindings, `stdSerializers.err`, no built-in profiler). Common per-operation pattern: child logger per stage, manual `Date.now()` delta for latency, error passed as structured field with library-specific serialisation. NFR-7 and AC-13 (`goals.md:31,82`) specify per-stage cost/latency logging and `failed_models` with identifier, error code, truncated message. |
| Q-14 | web | FOUND | Common README sections observed in hexagonal TypeScript repositories catalogued from starred projects (`stemmlerjs/ddd-forum`, `afteracademy/nodejs-backend-architecture-typescript`, `talyssonoc/node-api-boilerplate`) and README guides. Thirteen-section checklist documented with detailed sub-sections for: architecture diagram (Mermaid/ASCII with port inventory table), local development setup (prerequisites, clone, install, env, dev server, verify, tests), and configuration (annotated `fusion.config.json` example with field reference table). AC-15 (`goals.md:84`) mandates architecture, setup, and usage coverage. |

## Integrated Analysis

### Codebase Architecture

- **No source code exists.** The repository contains only `README.md` (one-line description), `LICENSE` (MIT), and `.gitignore` (Node.js patterns) — `questions.md:135–137`.
- **Planned hexagonal layout** — `requirements.md:89–99`, `goals.md:46–56`: three layers: `src/domain/` (pure logic, no I/O), `src/application/` (use-case orchestration), `src/infrastructure/` (all I/O, SDKs, frameworks). Dependency rule: infrastructure → application → domain — `requirements.md:85`.
- **Domain layer** (`src/domain/`): `model/` (entities: `Message`, `PanelResponse`, `Analysis`, `ModelRef`, `FusionError`), `services/` (judge/synth prompt builders, `Analysis` zod schema, grounding rules), `ports/` (outbound interfaces: `ChatModelPort`, `ConfigPort`, `LoggerPort`, `ClockPort`) — `requirements.md:90`, `goals.md:62`.
- **Application layer** (`src/application/`): `ports/` (inbound: `FusionService` with `runFusion(request) -> AsyncIterable<StreamEvent>`), `usecases/` (`RunFusionUseCase`, `PanelRunner`, `JudgeStep`, `SynthesizeStep`) — `requirements.md:91`, `goals.md:73`.
- **Infrastructure layer** (`src/infrastructure/`): `inbound/http/` (Hono server, OpenAI route + translator + SSE encoder, Anthropic route + translator + SSE encoder, `/v1/models` stub), `outbound/llm/` (`OpenAiChatAdapter`, `AnthropicChatAdapter`, `ChatAdapterFactory`), `outbound/config/` (`JsonFileConfigAdapter`), `outbound/logging/` (`ConsoleLoggerAdapter`), `di/container.ts` (composition root) — `requirements.md:99`.
- **Dependency rule enforcement**: NFR-1 (`goals.md:24`) requires zero SDK/framework imports in domain and application layers. NFR-2 (`goals.md:25`) confines Hono to `src/infrastructure/inbound/http/`. NFR-3 (`goals.md:26`) restricts `openai` SDK to `OpenAiChatAdapter` and `@anthropic-ai/sdk` to `AnthropicChatAdapter`. AC-2 (`goals.md:71`) requires verification; no automated enforcement tool has been selected — Q5 findings.
- **Single outbound port**: `ChatModelPort` is the only port for all LLM calls; no provider-specific ports — C-4 (`goals.md:62`). `ChatAdapterFactory` selects adapter by `provider.type` — FR-10 (`goals.md:20`).
- **Manual DI**: Composition root at `src/infrastructure/di/container.ts`, bootstrap at `src/main.ts`. No DI container library (tsyringe, inversify, awilix) specified — Q5 findings.
- **Anthropic type confinement**: C-5 (`goals.md:63`) requires Anthropic SSE types to exist only in Anthropic adapters. SDK defines 6 SSE event types; planning documents reference 3 — see Gap/Conflict Index.

### External Dependencies

- **Planned dependencies** — `goals.md:108` references: `hono`, `@hono/node-server`, `openai`, `@anthropic-ai/sdk`, `zod`, `tsx`, `typescript`, `@types/node`.
- **`openai` SDK v6.42.0** (research installation at `/tmp/openai-sdk/package/`): exports `client.chat.completions.create()` with overloads discriminated by `stream: boolean`; `client.chat.completions.stream()` convenience method returning `ChatCompletionStream` with events (`content`, `chunk`, `message`, `finalMessage`, `content.delta`, `content.done`, `tool_calls.function.arguments.delta`); `response_format` parameter on `ChatCompletionCreateParamsBase` (`ResponseFormatText`, `ResponseFormatJSONSchema`, `ResponseFormatJSONObject`); `RequestOptions.signal` for `AbortSignal` passthrough; SSE parsing via `SSEDecoder` class that handles `data:`, `event:`, and comment (`:`) lines — Q1, Q4 findings.
- **`@anthropic-ai/sdk` v0.104.1** (research installation at `/tmp/anthropic-sdk/package/`): exports `client.messages.create()` with overloads; `client.messages.stream()` returning `MessageStream` with events (`text`, `thinking`, `inputJson`, `citation`, `message`, `finalMessage`, `contentBlock`, `streamEvent`, `error`, `abort`, `end`); `output_config.format` (`JSONOutputFormat`) for structured output; `RequestOptions.signal` for cancellation; 6 SSE event types in `RawMessageStreamEvent` union; `MessageStream.abort()` convenience method — Q2, Q4 findings.
- **Zod v3**: `safeParse()` returns discriminated union `{ success: true, data } | { success: false, error: ZodError }`. `ZodError.issues[]` provides `code`, `path`, `message`; `format()` for nested errors; `flatten()` for dot-path field errors. FR-5 defines `Analysis` with `consensus` (string), `contradictions` (array of `{source_a, source_b, description}`), `unique_insights` (array of `{source, insight}`), `blind_spots` (array of strings). AC-8 requires `safeParse` for graceful degradation — Q8 findings.
- **Hono v4** (research installation at `/tmp/hono-inspect/`): provides `streamSSE()` with `SSEStreamingApi.writeSSE()`, base `StreamingApi.write()` for raw SSE comments (keep-alive), `c.json()` for JSON responses, `app.route()` / `app.basePath()` for sub-router mounting. NFR-2 confines Hono to infrastructure — Q3 findings.
- **Structured logging**: Three libraries documented — pino v10.3.1, winston v3.19.0, bunyan v1.8.15. Each provides child loggers, error serialisation, and mechanisms for attaching structured metadata. pino and bunyan provide default `err` serialisation (`type`/`name`, `msg`/`message`, `stack`); winston uses `logform` formats. Latency measurement: winston has built-in `profile()`/`startTimer()`; pino and bunyan require manual `Date.now()` delta. No library selected in planning documents — Q13 findings.
- **Testing**: vitest v4.1.5 identified from sibling project. `vi.fn()`, `vi.spyOn()`, `vi.mock()` for stubs. `MockInstance.mockResolvedValue()`/`mockRejectedValue()` for async port stubs. Colocated `*.spec.ts` convention. No framework prescribed in planning documents — Q11 findings.
- **Runtime**: Node.js 20+, TypeScript strict mode, ESM (`"type": "module"`), `tsx` dev runner — `requirements.md:75`, AC-1 (`goals.md:85`), Q10 findings.

### API Surface

- **OpenAI inbound endpoint**: `/v1/chat/completions` — FR-1 (`goals.md:7`), AC-7 (`goals.md:76`). Request fields: `messages` (6 role shapes), `model`, `stream`, `response_format` (text, json_object, json_schema), plus 25 additional optional parameters. Non-streaming response: `ChatCompletion` with `choices[].message`. Streaming: SSE `data:` lines with `ChatCompletionChunk` JSON (`object: "chat.completion.chunk"`), terminated by `data: [DONE]`. SSE comments (`: comment\n\n`) used for keep-alive during non-streamed phases — Q1 findings, `goals.md:13,79`.
- **Anthropic inbound endpoint**: `/v1/messages` — FR-1 (`goals.md:7`), AC-11 (`goals.md:80`). Request fields: `max_tokens`, `messages`, `model`, `stream`, `system`, `thinking`, `tools`, `tool_choice`, `output_config`, plus 6 additional optional parameters. Non-streaming response: `Message` with `content: Array<ContentBlock>` and `stop_reason`. Streaming: 6 SSE event types in fixed sequence using `event:` and `data:` fields — Q2 findings, `goals.md:13,60,80`.
- **`/v1/models` endpoint**: Returns JSON array with at least one model entry — FR-2 (`goals.md:8`), AC-6 (`goals.md:74`).
- **`ChatModelPort` interface**: `complete()` (non-streaming) and `stream()` (streaming) using only domain types — C-6 (`goals.md:63`), AC-3 (`goals.md:72`). Both `openai` and `@anthropic-ai/sdk` can satisfy these signatures — Q4 findings.
- **SDK streaming convenience methods**: OpenAI `ChatCompletionStream` emits `content`, `chunk`, `message`, `finalMessage`; Anthropic `MessageStream` emits `text`, `thinking`, `inputJson`, `message`, `finalMessage`, `streamEvent`, `error`, `abort`, `end` — Q4 findings.
- **Token usage fields**: OpenAI `CompletionUsage` (prompt, completion, total tokens; optional reasoning, audio, prediction, cache breakdowns). Anthropic `Usage` (input, output tokens; optional cache, thinking, server-tool-use breakdowns; `service_tier`, `inference_geo`). Streaming delivery differs: OpenAI on final chunk with `stream_options.include_usage`; Anthropic via `message_delta` cumulative event — Q9 findings.
- **Latency/timing**: OpenAI returns `created` Unix timestamp; Anthropic returns no timestamp or latency field. Both require client-side wall-clock measurement — Q9 findings.

### Constraints and Risks

- **No concrete config schema selected.** C-1 (`goals.md:61`) marks the `fusion.config.json` schema as an open question. Three patterns surveyed (Q6) but no decision documented. `ConfigPort` is expected to insulate the application layer — NFR-6 (`goals.md:28`).
- **No import enforcement mechanism selected.** AC-2 (`goals.md:71`) requires verification of the dependency rule but no automated tool has been specified. Manual code review is the implied mechanism — Q5 findings.
- **No testing framework selected.** FR-14 and AC-14 describe test coverage scope but do not prescribe vitest, jest, or any runner. vitest v4.1.5 was identified from a sibling project as a candidate — Q11 findings.
- **No structured-logging library selected.** Q13 documented pino, winston, and bunyan; the planning documents reference `ConsoleLoggerAdapter` (AC-13) but do not prescribe a library.
- **SDK version mismatch:** Research conducted against `openai@6.42.0` and `@anthropic-ai/sdk@0.104.1`. Planning documents reference `openai ^4.0.0` and `@anthropic-ai/sdk ^0.30.0` — `goals.md:108`. The version gap may affect API surface, particularly for OpenAI (v4→v6 includes changes to streaming and structured output APIs).
- **Anthropic SSE event type gap:** The planning documents reference exactly 3 Anthropic SSE event types (`message_start`, `content_block_delta`, `message_stop`) at `goals.md:13,60,80` and `requirements.md:117`. The `@anthropic-ai/sdk` v0.104.1 `RawMessageStreamEvent` union type defines 6 event types (adds `message_delta`, `content_block_start`, `content_block_stop`). An inbound Anthropic adapter must emit all 6 event types in the documented sequence for wire compatibility with Anthropic client SDKs.
- **Graceful degradation surface:** Panel total failure (`all_panels_failed`) is fatal; judge failure is never fatal (skipped via `safeParse` degradation); partial panel failures are reported in stream metadata — FR-4, NFR-5, AC-7, AC-8 (`goals.md:10,30,76,77`). Specified but unimplemented.
- **No token-cost calculation specified.** FR-13 and AC-13 require per-stage cost logging but no cost model (pricing per token) is defined. Token counts are available from both SDKs — Q9 findings.
- **No timeout values specified.** FR-8 and AC-12 require `AbortController`-based timeouts but no concrete timeout durations are documented.
- **No keep-alive mechanism specified beyond SSE comments.** NFR-4 (`goals.md:27`) and AC-10 (`goals.md:79`) require SSE keep-alive comments during panel and judge phases. Hono v4 supports this via `StreamingApi.write(': comment\n\n')` — Q3 findings document the mechanism.

## Gap/Conflict Index

- **CONFLICT-ANTHROPIC-SSE-EVENTS**: The planning documents (`goals.md:13,60,80`, `requirements.md:117`) reference exactly 3 Anthropic SSE event types (`message_start`, `content_block_delta`, `message_stop`). The `@anthropic-ai/sdk` v0.104.1 `RawMessageStreamEvent` type defines 6 event types (adds `message_delta`, `content_block_start`, `content_block_stop`). The inbound Anthropic adapter specification omits half the event types the SDK uses. A wire-compatible adapter must emit all 6 in the documented sequence.
- **CONFLICT-SDK-VERSIONS**: Research conducted against `openai@6.42.0` and `@anthropic-ai/sdk@0.104.1`. Planning documents reference `openai ^4.0.0` and `@anthropic-ai/sdk ^0.30.0`. The version gap may cause API surface incompatibilities, especially for OpenAI's streaming convenience methods (`client.chat.completions.stream()` vs v4-era patterns).
- **GAP-CONFIG-SCHEMA**: C-1 (`goals.md:61`) marks the `fusion.config.json` schema as an unresolved open question. Three patterns surveyed (Q6) but no decision documented. `ConfigPort` abstractions are defined but cannot be finalized without a concrete schema.
- **GAP-IMPORT-ENFORCEMENT**: No automated import-enforcement tool (eslint-plugin-boundaries, dependency-cruiser, tsconfig paths) has been selected. AC-2 requires verification of the dependency rule but the mechanism is unspecified. Four techniques catalogued in Q5 findings.
- **GAP-TIMEOUT-VALUES**: No concrete timeout durations are specified for `AbortController`-based cancellation (FR-8, AC-12).
- **GAP-COST-MODEL**: FR-13 and AC-13 require per-stage cost logging but no pricing model (cost per token) is defined. Token counts are available from both SDKs (Q9).
- **GAP-TESTING-TOOL**: No testing framework is prescribed by the planning documents. FR-14 and AC-14 describe test scope but not tooling. vitest v4.1.5 was identified from a sibling project as an existing local installation with full mocking API (Q11).
- **GAP-LOGGING-LIBRARY**: No structured-logging library is prescribed. Three libraries documented in Q13 (pino, winston, bunyan) with per-operation logging patterns.

## Sources

### Codebase (repository root)
- `README.md:1–2` — Project title and one-line description; no architecture, setup, or API content.
- `LICENSE:1–24` — MIT License.
- `.gitignore:1–109` — Standard Node.js gitignore patterns.

### Specification documents (`.pipeline/qrspi-20260614-153621/`)
- `requirements.md:75–117` — Architecture definition, hexagonal layout, phase planning, dependency rule, planned module paths, runtime specification (Node 20+, Hono, TypeScript strict, `tsx`).
- `requirements.md:89–99` — Proposed directory layout for all three hexagonal layers plus infrastructure adapters.
- `requirements.md:85` — Dependency rule: infrastructure → application → domain.
- `goals.md:7–15` — Functional requirements FR-1 through FR-12.
- `goals.md:24–31` — Non-functional requirements NFR-1 through NFR-7.
- `goals.md:60–64` — Constraints C-1 through C-7.
- `goals.md:71–85` — Acceptance criteria AC-1 through AC-15.
- `goals.md:46–56` — Full module layout specification.
- `questions.md:1–137` — Research question inventory; all Q1–Q14 tagged `web`; confirmation at lines 135–137 that repository contains no source code.
- `goal-inventory.md:7–43` — Catalogued FR, NFR, C, AC IDs with cross-references.

### SDK installations (research artifacts at `/tmp/`)
- `/tmp/openai-sdk/package/resources/chat/completions/completions.d.ts:55–57, 148–217, 426–490, 553–710, 1089–1467, 1548–1978` — `openai@6.42.0` type definitions: `create()` overloads, `ChatCompletion`, `ChatCompletionChunk`, message role shapes, `ChatCompletionCreateParamsBase` with all 32 request fields and `response_format`.
- `/tmp/openai-sdk/package/resources/shared.d.ts:189–241` — `ResponseFormatJSONObject`, `ResponseFormatJSONSchema`, `ResponseFormatText`.
- `/tmp/openai-sdk/package/lib/ChatCompletionStream.d.ts:62–83` — `ChatCompletionStream` class events and methods.
- `/tmp/openai-sdk/package/core/streaming.d.ts:8–14` — `Stream<Item>`, `ServerSentEvent` type.
- `/tmp/openai-sdk/package/core/streaming.js:30–180` — `SSEDecoder` implementation, `[DONE]` detection, error handling, comment-line handling.
- `/tmp/openai-sdk/package/internal/request-options.d.ts:65` — `RequestOptions.signal?: AbortSignal`.
- `/tmp/openai-sdk/package/resources/completions.d.ts:91–147` — `CompletionUsage` with detail breakdowns.
- `/tmp/anthropic-sdk/package/resources/messages/messages.d.ts:31–33, 629–741, 748–777, 855–916, 1526–1569, 1942–2219` — `@anthropic-ai/sdk@0.104.1` type definitions: `create()` overloads, `Message`, SSE event types, `Usage`, `MessageDeltaUsage`, `MessageCreateParamsBase`.
- `/tmp/anthropic-sdk/package/resources/messages/messages.d.ts:836–847, 966–975` — `OutputTokensDetails`, `ServerToolUsage`.
- `/tmp/anthropic-sdk/package/lib/MessageStream.d.ts:26–139` — `MessageStream` class with `controller`, events, `abort()`.
- `/tmp/anthropic-sdk/package/internal/request-options.d.ts:72` — `RequestOptions.signal?: AbortSignal`.
- `/tmp/anthropic-sdk/package/resources/messages/messages.js:35` — HTTP endpoint: `POST /v1/messages`.

### Hono installation (research artifact at `/tmp/hono-inspect/`)
- `/tmp/hono-inspect/node_modules/hono/dist/types/helper/streaming/index.d.ts:1–6` — streaming helper exports: `stream`, `streamSSE`, `streamText`, `SSEMessage`.
- `/tmp/hono-inspect/node_modules/hono/dist/types/helper/streaming/sse.d.ts:1–15` — `SSEMessage` interface, `SSEStreamingApi` class, `writeSSE()`.
- `/tmp/hono-inspect/node_modules/hono/dist/helper/streaming/sse.js:6–52` — `writeSSE()` implementation, `run()` lifecycle orchestrator.
- `/tmp/hono-inspect/node_modules/hono/dist/utils/stream.js:1–61` — `StreamingApi` base class: `write`, `writeln`, `sleep`, `close`, `pipe`, `onAbort`, `abort`.
- `/tmp/hono-inspect/node_modules/hono/dist/types/context.d.ts:167–224` — `c.json()`, `c.header()`, `c.status()`.
- `/tmp/hono-inspect/node_modules/hono/dist/types/hono-base.d.ts:70–86` — `.route()`, `.basePath()`, `.mount()`.
- `/tmp/hono-inspect/node_modules/@hono/node-server/dist/index.d.mts:44–46` — `serve()` for Node.js.

### Sibling project (vitest research at `/home/n3m6/src/zoink/`)
- `/home/n3m6/src/zoink/zoink-cli/node_modules/vitest/package.json:1–4` — vitest v4.1.5 identification.
- `/home/n3m6/src/zoink/zoink-cli/node_modules/@vitest/spy/dist/index.d.ts:140–288` — `fn()`, `spyOn()`, `MockInstance` interface.
- `/home/n3m6/src/zoink/zoink-cli/node_modules/@vitest/mocker/dist/types.d-BjI5eAwu.d.ts:91` — `ModuleMockFactoryWithHelper` for `vi.mock()`.
- `/home/n3m6/src/zoink/zoink-cli/apps/cli/src/adapters/DockerImageManagerAdapter.spec.ts:9–62` — stub creation pattern with `vi.fn()`, `mockResolvedValue`, `mockRejectedValue`.
- `/home/n3m6/src/zoink/zoink-cli/packages/shared/src/severity.spec.ts:1–55` — pure domain-logic test pattern.
- `/home/n3m6/src/zoink/zoink-cli/apps/cli/vitest.config.ts:7–24` — vitest config with `globals: true`, `include: ['src/**/*.spec.ts']`.

### Web sources
- `https://hono.dev/docs/helpers/streaming` — Hono streaming helper documentation.
- `https://hono.dev/docs/api/routing` — Hono routing documentation (grouping, base path, chaining).
- `https://hono.dev/docs/api/context` — Hono context documentation (`c.json()`, `c.text()`).
- `https://hono.dev/docs/getting-started/nodejs` — Node.js setup with `@hono/node-server`.
- MDN: `Promise.allSettled()` — settlement result shapes, never-rejects guarantee.
- MDN: `AggregateError` — constructor, `errors` property, `Promise.any()` relationship.
- TypeScript `lib.es2020.promise.d.ts` — `PromiseFulfilledResult<T>`, `PromiseRejectedResult`, `PromiseSettledResult<T>`.
- Zod v3 documentation — `parse`, `safeParse`, `ZodError` structure, schema definition API.
- `https://registry.npmjs.org/pino/latest` — pino v10.3.1 npm registry metadata.
- `https://raw.githubusercontent.com/pinojs/pino/main/docs/api.md` — pino API reference.
- `https://registry.npmjs.org/winston/latest` — winston v3.19.0 npm registry metadata.
- `https://raw.githubusercontent.com/winstonjs/winston/master/README.md` — winston README.
- `https://registry.npmjs.org/bunyan/latest` — bunyan v1.8.15 npm registry metadata.
- `https://raw.githubusercontent.com/trentm/node-bunyan/master/README.md` — bunyan README.
- TypeScript documentation — strict mode compiler options, `module: "NodeNext"`, ESM configuration.
- Node.js ESM documentation — `"type": "module"`, `.js` extension resolution.
- `tsx` documentation — `tsx` and `tsx watch` execution.
- LiteLLM proxy configuration — model-centric routing pattern (Pattern 3).
- OpenRouter client configurations — flat provider array pattern (Pattern 1).
- `stemmlerjs/ddd-forum`, `afteracademy/nodejs-backend-architecture-typescript`, `talyssonoc/node-api-boilerplate` — hexagonal TypeScript repository README patterns.
- `makeareadme.com`, GitHub "About READMEs" — README section conventions.
- Zheng et al. (2023) — LLM-as-a-Judge with structured rubric.
- Wei et al. (2022) — Comparative Chain-of-Thought prompting.
- Du et al. (2023) — Multi-Agent Debate / Moderator pattern.
- Lewis et al. (2020) — Source-Grounded Synthesis (RAG-style grounding).
- Wang et al. (2024) — Mixture-of-Agents aggregation.
- Bai et al. (2022) — Principle-Guided / Constitutional synthesis.
