FR-1: Dual inbound HTTP API: OpenAI-compatible `/v1/chat/completions` (direct canonical mapping) and Anthropic-compatible `/v1/messages` (request/response translation), both calling the same `FusionService` inbound port.
FR-2: `/v1/models` endpoint returning a stub model list.
FR-3: Ensemble pipeline orchestrated by `RunFusionUseCase`: fan-out to a panel of models (parallel, non-streamed) → judge analysis (buffered) → streamed synthesis.
FR-4: `PanelRunner` executes panel calls via `Promise.allSettled`, collecting `failed_models` details and raising an `all_panels_failed` `FusionError` only when every panel model fails.
FR-5: `JudgeStep` calls a judge model through `ChatModelPort` using a JSON `response_format` to produce a structured `Analysis` (zod schema with `consensus`, `contradictions`, `unique_insights`, `blind_spots`). Judge failure is handled with graceful degradation: analysis is omitted and `SynthesizeStep` falls back to raw panel responses.
FR-6: `SynthesizeStep` produces a final response via `ChatModelPort`, incorporating panel outputs and (when available) the judge analysis.
FR-7: Streaming: only the synthesis stage streams; panel and judge are buffered. The use case yields domain stream events; inbound adapters encode them as provider-specific SSE chunks (`chat.completion.chunk` … `[DONE]` for OpenAI; `message_start`, `content_block_delta`, `message_stop` for Anthropic). Keep-alive/progress comments cover the non-streamed hops.
FR-8: Per-call timeouts surfaced through `ChatModelPort` via `AbortController`.
FR-9: Configurable model backends via `fusion.config.json`, loaded by `JsonFileConfigAdapter` implementing `ConfigPort`. Each provider entry specifies `type` (`openai` | `anthropic`), `baseURL`, and `apiKeyEnv`, covering local (Ollama/LM Studio), OpenRouter, and direct OpenAI/Anthropic backends.
FR-10: `ChatAdapterFactory` selects an outbound adapter by `provider.type`. Concrete adapters:
FR-11: `OpenAiChatAdapter` implementing `ChatModelPort` via the `openai` SDK, selected for `provider.type === 'openai'`.
FR-12: `AnthropicChatAdapter` implementing `ChatModelPort` via the `@anthropic-ai/sdk`, selected for `provider.type === 'anthropic'`.
FR-13: `LoggerPort` (`ConsoleLoggerAdapter`) wired for per-stage cost/latency and richer `failed_models` reporting.
FR-14: Unit tests at the domain and application layers using stubbed ports.
FR-15: README and an example `fusion.config.json` mixing local and remote models.

NFR-1: **Architecture (dependency rule)**: `infrastructure → application → domain`. Domain and application layers must have zero imports from any SDK (`openai`, `@anthropic-ai/sdk`, `@hono/node-server`, `zod` server-side usage) or framework (Hono). Domain must have zero imports from `src/application/` or `src/infrastructure/`.
NFR-2: **Hono confinement**: Hono must appear only in `src/infrastructure/inbound/http/`.
NFR-3: **SDK confinement**: `openai` SDK used only in `OpenAiChatAdapter`; `@anthropic-ai/sdk` used only in `AnthropicChatAdapter`.
NFR-4: **Streaming guarantees**: Only the synthesizer produces streamed content; panel and judge stages must be fully buffered before synthesis begins. SSE keep-alive comments must be emitted during panel and judge phases so the client connection does not time out.
NFR-5: **Graceful degradation**: Panel failure is fatal only when all panel models fail (`all_panels_failed`). Judge failure is never fatal — synthesis proceeds with raw panel responses. Partial panel failures are reported in the stream metadata.
NFR-6: **Config port contract**: `ConfigPort` provides a `getPanelModels()`, `getJudgeModel()`, and `getSynthesizerModel()` interface (exact method names deferred to implementation) so the application layer never reads `fusion.config.json` directly.
NFR-7: **Observability**: Every stage (panel, judge, synthesis) logs cost and latency via `LoggerPort`. `failed_models` arrays include model identifier, error code, and truncated message.

C-1: **Model-role assignment (open question)**: The `fusion.config.json` schema for designating which providers serve as panel members, which as judge, and which as synthesizer is not yet defined in the requirements. Possible approaches include a `role` field per provider entry or separate `panel`/`judge`/`synthesizer` config blocks. This must be resolved during implementation design; `ConfigPort` should abstract the assignment so the application layer is insulated from the schema choice.
C-2: Domain layer must have zero imports from `src/application/` or `src/infrastructure/`.
C-3: Application layer must have zero imports from `src/infrastructure/`.
C-4: `ChatModelPort` is the single outbound port for all LLM calls — no provider-specific ports.
C-5: Anthropic-specific types (`message_start`, `content_block_delta`, `message_stop`) exist only in the inbound/outbound Anthropic adapters.
C-6: Panel and judge calls use `complete()` (non-streaming); only synthesis uses `stream()`.
C-7: All phases must keep the system runnable end-to-end.

AC-1: `package.json` and `tsconfig.json` exist with Node 20+ target, strict TypeScript, and a `tsx` dev script.
AC-2: `src/domain/` contains no imports from `src/application/` or `src/infrastructure/`. `src/application/` contains no imports from `src/infrastructure/`.
AC-3: `ChatModelPort` interface defines `complete()` and `stream()` signatures using only domain types.
AC-4: `FusionService` inbound port defines `runFusion(request) -> AsyncIterable<StreamEvent>`.
AC-5: `OpenAiChatAdapter` implements `ChatModelPort` and is selected by `ChatAdapterFactory` when `provider.type === 'openai'`. A real OpenAI-compatible client (e.g., `curl`) receives a valid chat completion response through the `/v1/chat/completions` route.
AC-6: `JsonFileConfigAdapter` loads `fusion.config.json` and satisfies `ConfigPort`. `/v1/models` returns a JSON array with at least one model entry.
AC-7: `PanelRunner` dispatches calls to all configured panel models in parallel, collects results via `Promise.allSettled`, and surfaces `failed_models` in the result. When every panel model fails, an `all_panels_failed` `FusionError` is thrown.
AC-8: `JudgeStep` calls `ChatModelPort.complete()` with a JSON `response_format` and parses the response against the `Analysis` zod schema. If the judge call fails or the response fails schema validation, the use case continues without analysis and logs the failure via `LoggerPort`.
AC-9: `SynthesizeStep` produces a final response whose content references at least one element from the analysis (when the judge succeeded) and at least one element from the panel outputs, and does not introduce factual claims absent from both sources.
AC-10: The streaming SSE endpoint emits keep-alive comments during panel and judge phases, followed by proper OpenAI-format `chat.completion.chunk` events for synthesis tokens, and terminates with `data: [DONE]`.
AC-11: `AnthropicChatAdapter` implements `ChatModelPort` via `@anthropic-ai/sdk` and is selected by `ChatAdapterFactory` when `provider.type === 'anthropic'`. The inbound `/v1/messages` route translates Anthropic-format requests to canonical, calls `FusionService`, and maps stream events to `message_start`/`content_block_delta`/`message_stop` SSE events.
AC-12: A per-call `AbortController` timeout cancels the upstream LLM call if the configured deadline is exceeded.
AC-13: `ConsoleLoggerAdapter` logs per-stage cost and latency for panel, judge, and synthesis. `failed_models` entries include model identifier, error code, and truncated error message.
AC-14: Domain-layer unit tests exercise `Analysis` schema validation, prompt builder output shapes, and `FusionError` codes using only domain types (no mocks needed). Application-layer unit tests exercise `RunFusionUseCase`, `PanelRunner`, `JudgeStep`, and `SynthesizeStep` with stubbed `ChatModelPort` and `ConfigPort`.
AC-15: README describes architecture, setup, and usage. An example `fusion.config.json` mixes at least one local and one remote provider.
