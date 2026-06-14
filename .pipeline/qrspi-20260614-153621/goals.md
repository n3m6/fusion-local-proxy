# Goals

## Intent
Build a TypeScript local proxy (Node 20+ with Hono) that exposes OpenAI- and Anthropic-compatible HTTP APIs and internally runs an ensemble pipeline: fan-out to a configurable panel of models, an optional judge analysis, and a streamed synthesis response. The system uses a hexagonal (ports-and-adapters) architecture so the domain and application layers are pure and testable, with all I/O and provider SDKs confined to infrastructure adapters.

## Functional Requirements
- Dual inbound HTTP API: OpenAI-compatible `/v1/chat/completions` (direct canonical mapping) and Anthropic-compatible `/v1/messages` (request/response translation), both calling the same `FusionService` inbound port.
- `/v1/models` endpoint returning a stub model list.
- Ensemble pipeline orchestrated by `RunFusionUseCase`: fan-out to a panel of models (parallel, non-streamed) → judge analysis (buffered) → streamed synthesis.
- `PanelRunner` executes panel calls via `Promise.allSettled`, collecting `failed_models` details and raising an `all_panels_failed` `FusionError` only when every panel model fails.
- `JudgeStep` calls a judge model through `ChatModelPort` using a JSON `response_format` to produce a structured `Analysis` (zod schema with `consensus`, `contradictions`, `unique_insights`, `blind_spots`). Judge failure is handled with graceful degradation: analysis is omitted and `SynthesizeStep` falls back to raw panel responses.
- `SynthesizeStep` produces a final response via `ChatModelPort`, incorporating panel outputs and (when available) the judge analysis.
- Streaming: only the synthesis stage streams; panel and judge are buffered. The use case yields domain stream events; inbound adapters encode them as provider-specific SSE chunks (`chat.completion.chunk` … `[DONE]` for OpenAI; `message_start`, `content_block_delta`, `message_stop` for Anthropic). Keep-alive/progress comments cover the non-streamed hops.
- Per-call timeouts surfaced through `ChatModelPort` via `AbortController`.
- Configurable model backends via `fusion.config.json`, loaded by `JsonFileConfigAdapter` implementing `ConfigPort`. Each provider entry specifies `type` (`openai` | `anthropic`), `baseURL`, and `apiKeyEnv`, covering local (Ollama/LM Studio), OpenRouter, and direct OpenAI/Anthropic backends.
- `ChatAdapterFactory` selects an outbound adapter by `provider.type`. Concrete adapters:
  - `OpenAiChatAdapter` implementing `ChatModelPort` via the `openai` SDK, selected for `provider.type === 'openai'`.
  - `AnthropicChatAdapter` implementing `ChatModelPort` via the `@anthropic-ai/sdk`, selected for `provider.type === 'anthropic'`.
- `LoggerPort` (`ConsoleLoggerAdapter`) wired for per-stage cost/latency and richer `failed_models` reporting.
- Unit tests at the domain and application layers using stubbed ports.
- README and an example `fusion.config.json` mixing local and remote models.

## Non-Functional Requirements
- **Architecture (dependency rule)**: `infrastructure → application → domain`. Domain and application layers must have zero imports from any SDK (`openai`, `@anthropic-ai/sdk`, `@hono/node-server`, `zod` server-side usage) or framework (Hono). Domain must have zero imports from `src/application/` or `src/infrastructure/`.
- **Hono confinement**: Hono must appear only in `src/infrastructure/inbound/http/`.
- **SDK confinement**: `openai` SDK used only in `OpenAiChatAdapter`; `@anthropic-ai/sdk` used only in `AnthropicChatAdapter`.
- **Streaming guarantees**: Only the synthesizer produces streamed content; panel and judge stages must be fully buffered before synthesis begins. SSE keep-alive comments must be emitted during panel and judge phases so the client connection does not time out.
- **Graceful degradation**: Panel failure is fatal only when all panel models fail (`all_panels_failed`). Judge failure is never fatal — synthesis proceeds with raw panel responses. Partial panel failures are reported in the stream metadata.
- **Config port contract**: `ConfigPort` provides a `getPanelModels()`, `getJudgeModel()`, and `getSynthesizerModel()` interface (exact method names deferred to implementation) so the application layer never reads `fusion.config.json` directly.
- **Observability**: Every stage (panel, judge, synthesis) logs cost and latency via `LoggerPort`. `failed_models` arrays include model identifier, error code, and truncated message.

## Technical Specification
- **Runtime**: Node.js 20+.
- **HTTP framework**: Hono with `@hono/node-server`.
- **Streaming format**: Server-Sent Events (SSE).
- **Language**: TypeScript, strict mode.
- **Schema validation**: Zod for the `Analysis` schema and config validation.
- **SDK dependencies**: `openai` (OpenAI-compatible outbound), `@anthropic-ai/sdk` (Anthropic outbound).
- **Dev runner**: `tsx` for development execution.
- **Module layout (hexagonal)**:
  - `src/domain/model/` — `Message`, `PanelResponse`, `Analysis`, `ModelRef`, `FusionError` (pure, no I/O)
  - `src/domain/services/` — judge/synthesis prompt builders, `Analysis` zod schema, synthesis grounding rules
  - `src/domain/ports/` — `ChatModelPort`, `ConfigPort`, `LoggerPort`, `ClockPort`
  - `src/application/ports/` — `FusionService` (`runFusion(request) -> AsyncIterable<StreamEvent>`)
  - `src/application/usecases/` — `RunFusionUseCase`, `PanelRunner`, `JudgeStep`, `SynthesizeStep`
  - `src/infrastructure/inbound/http/` — `server.ts` (Hono), `openai/` route + translator + SSE encoder, `anthropic/` route + translator + SSE encoder, `/v1/models` stub
  - `src/infrastructure/outbound/llm/` — `OpenAiChatAdapter`, `AnthropicChatAdapter`, `ChatAdapterFactory`
  - `src/infrastructure/outbound/config/` — `JsonFileConfigAdapter`
  - `src/infrastructure/outbound/logging/` — `ConsoleLoggerAdapter`
  - `src/infrastructure/di/container.ts` — composition root
  - `src/main.ts` — bootstrap
- **Config file**: `fusion.config.json` at project root.
- **Environment**: `.env.example` for `apiKeyEnv` references.

## Constraints
- **Model-role assignment (open question)**: The `fusion.config.json` schema for designating which providers serve as panel members, which as judge, and which as synthesizer is not yet defined in the requirements. Possible approaches include a `role` field per provider entry or separate `panel`/`judge`/`synthesizer` config blocks. This must be resolved during implementation design; `ConfigPort` should abstract the assignment so the application layer is insulated from the schema choice.
- Domain layer must have zero imports from `src/application/` or `src/infrastructure/`.
- Application layer must have zero imports from `src/infrastructure/`.
- `ChatModelPort` is the single outbound port for all LLM calls — no provider-specific ports.
- Anthropic-specific types (`message_start`, `content_block_delta`, `message_stop`) exist only in the inbound/outbound Anthropic adapters.
- Panel and judge calls use `complete()` (non-streaming); only synthesis uses `stream()`.
- All phases must keep the system runnable end-to-end.

## Non-Goals
- Web-search / tool-use loop per panel member.
- Authentication, rate limiting, or multi-tenant concerns.
- Non-streaming Anthropic batching edge cases beyond basic support.

## Acceptance Criteria
1. `package.json` and `tsconfig.json` exist with Node 20+ target, strict TypeScript, and a `tsx` dev script.
2. `src/domain/` contains no imports from `src/application/` or `src/infrastructure/`. `src/application/` contains no imports from `src/infrastructure/`.
3. `ChatModelPort` interface defines `complete()` and `stream()` signatures using only domain types.
4. `FusionService` inbound port defines `runFusion(request) -> AsyncIterable<StreamEvent>`.
5. `OpenAiChatAdapter` implements `ChatModelPort` and is selected by `ChatAdapterFactory` when `provider.type === 'openai'`. A real OpenAI-compatible client (e.g., `curl`) receives a valid chat completion response through the `/v1/chat/completions` route.
6. `JsonFileConfigAdapter` loads `fusion.config.json` and satisfies `ConfigPort`. `/v1/models` returns a JSON array with at least one model entry.
7. `PanelRunner` dispatches calls to all configured panel models in parallel, collects results via `Promise.allSettled`, and surfaces `failed_models` in the result. When every panel model fails, an `all_panels_failed` `FusionError` is thrown.
8. `JudgeStep` calls `ChatModelPort.complete()` with a JSON `response_format` and parses the response against the `Analysis` zod schema. If the judge call fails or the response fails schema validation, the use case continues without analysis and logs the failure via `LoggerPort`.
9. `SynthesizeStep` produces a final response whose content references at least one element from the analysis (when the judge succeeded) and at least one element from the panel outputs, and does not introduce factual claims absent from both sources.
10. The streaming SSE endpoint emits keep-alive comments during panel and judge phases, followed by proper OpenAI-format `chat.completion.chunk` events for synthesis tokens, and terminates with `data: [DONE]`.
11. `AnthropicChatAdapter` implements `ChatModelPort` via `@anthropic-ai/sdk` and is selected by `ChatAdapterFactory` when `provider.type === 'anthropic'`. The inbound `/v1/messages` route translates Anthropic-format requests to canonical, calls `FusionService`, and maps stream events to `message_start`/`content_block_delta`/`message_stop` SSE events.
12. A per-call `AbortController` timeout cancels the upstream LLM call if the configured deadline is exceeded.
13. `ConsoleLoggerAdapter` logs per-stage cost and latency for panel, judge, and synthesis. `failed_models` entries include model identifier, error code, and truncated error message.
14. Domain-layer unit tests exercise `Analysis` schema validation, prompt builder output shapes, and `FusionError` codes using only domain types (no mocks needed). Application-layer unit tests exercise `RunFusionUseCase`, `PanelRunner`, `JudgeStep`, and `SynthesizeStep` with stubbed `ChatModelPort` and `ConfigPort`.
15. README describes architecture, setup, and usage. An example `fusion.config.json` mixes at least one local and one remote provider.
