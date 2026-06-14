# Research Questions

### Q1: What is the complete request and response schema for the OpenAI `/v1/chat/completions` HTTP endpoint, and what is the Server-Sent Events (SSE) streaming format including its termination signal?
**Tag**: `web`
**Covers**: `FR-1 [OpenAI inbound API]; FR-7 [OpenAI SSE chunk format]; FR-11 [OpenAiChatAdapter compliance]; AC-5 [real client receives valid response]; AC-10 [chat.completion.chunk + [DONE]]`
**Answer shape**: A structured reference table listing all request fields (required and optional), response object fields, and the exact SSE event format (`data:` payloads, `[DONE]` sentinel, event types). Scope is the OpenAI REST API documentation for `/v1/chat/completions` (streaming and non-streaming). Stop when every request field, response field, and SSE event structure is catalogued.
**Decision unblocked**: Designing the inbound HTTP adapter's request parsing and SSE response encoding to be wire-compatible with OpenAI clients.

### Q2: What is the complete request and response schema for the Anthropic `/v1/messages` HTTP endpoint, and what SSE event types (`message_start`, `content_block_delta`, `message_stop`) does it use for streaming responses?
**Tag**: `web`
**Covers**: `FR-1 [Anthropic inbound API]; FR-7 [Anthropic SSE events]; FR-12 [AnthropicChatAdapter compliance]; C-5 [Anthropic types confined to adapters]; AC-11 [Anthropic route + SSE mapping]`
**Answer shape**: A structured reference table listing all request fields, response object fields, and the exact SSE event sequence (event types, payload shapes, ordering constraints). Scope is the Anthropic Messages API documentation. Stop when every request field, response field, and SSE event type is catalogued with its payload structure.
**Decision unblocked**: Designing the inbound Anthropic adapter's request-to-canonical translation and SSE event mapping to be wire-compatible with Anthropic clients.

### Q3: How does the Hono web framework support Server-Sent Events streaming — including keep-alive/progress comment emission, stream lifecycle management — and what patterns exist for organizing routes and returning JSON responses?
**Tag**: `web`
**Covers**: `FR-1 [Hono HTTP routing]; FR-2 [/v1/models JSON endpoint]; FR-7 [SSE streaming in Hono]; NFR-2 [Hono confined to inbound/http]; NFR-4 [SSE keep-alive during non-streamed phases]; AC-6 [/v1/models returns JSON array]; AC-10 [keep-alive comments during panel + judge phases]`
**Answer shape**: A summary of Hono's SSE API surface (e.g., `stream()`, `streamSSE()`, or equivalent), keep-alive mechanisms, route organization conventions, and JSON response helpers. Scope is the Hono v4 documentation. Stop when SSE streaming, keep-alive/progress comment emission, JSON responses, and route mounting patterns are understood.
**Decision unblocked**: Structuring the Hono-based inbound HTTP server, including SSE endpoints and the `/v1/models` JSON route, while confining Hono imports to the infrastructure layer.

### Q4: What TypeScript method signatures, types, and capabilities do the `openai` npm SDK (chat completions) and `@anthropic-ai/sdk` (messages) expose for: (a) non-streaming calls, (b) streaming calls, (c) structured JSON output / `response_format` constraints, and (d) request cancellation via `AbortSignal`?
**Tag**: `web`
**Covers**: `FR-5 [JSON response_format via ChatModelPort]; FR-8 [AbortController timeout surfaced through port]; FR-11 [openai SDK usage]; FR-12 [anthropic SDK usage]; C-4 [single ChatModelPort for all LLM calls]; C-6 [complete() vs stream()]; AC-3 [ChatModelPort signatures using domain types]; AC-5 [OpenAiChatAdapter via openai SDK]; AC-8 [JudgeStep calls complete() with JSON response_format]; AC-11 [AnthropicChatAdapter via @anthropic-ai/sdk]; AC-12 [AbortController cancels upstream call]`
**Answer shape**: A comparison table of TypeScript method signatures for both SDKs covering: non-streaming call signature and return type, streaming call signature and return type, `response_format` / structured output option shape, and `AbortSignal` parameter. Scope is the latest published types/SDK documentation for both packages. Stop when all four capability areas are documented for both SDKs.
**Decision unblocked**: Designing the `ChatModelPort` interface with `complete()` and `stream()` method signatures that can be satisfied by both SDKs, and wiring `AbortController` timeouts through those signatures.

### Q5: What are established patterns for implementing a ports-and-adapters (hexagonal) architecture in TypeScript — including directory layout conventions, port interface definition and dependency inversion, adapter wiring strategies, and enforcement of the `infrastructure → application → domain` import direction rule?
**Tag**: `web`
**Covers**: `FR-3 [pipeline orchestration structure]; FR-10 [ChatAdapterFactory wiring]; NFR-1 [dependency rule enforcement]; NFR-2 [Hono import boundaries]; NFR-3 [SDK import boundaries]; NFR-6 [ConfigPort abstraction]; C-2 [domain zero imports from application/infrastructure]; C-3 [application zero imports from infrastructure]; C-4 [single ChatModelPort as outbound port]; C-5 [Anthropic types only in adapters]; C-7 [system runnable end-to-end]; AC-2 [import constraint verification]; AC-3 [ChatModelPort uses only domain types]; AC-4 [FusionService inbound port signature]`
**Answer shape**: A summary of directory structure conventions, port interface patterns (inbound and outbound), adapter registration/wiring approaches (manual DI, tsyringe, etc.), and import rule enforcement techniques (eslint rules, dependency-cruiser, tsconfig paths). Scope is published hexagonal/clean architecture literature and TypeScript example repositories. Stop when port definition patterns, adapter wiring approaches, and at least two import-enforcement techniques are identified.
**Decision unblocked**: Establishing the project's directory layout, port interface conventions, and dependency rule enforcement so all layers remain decoupled from SDKs and frameworks.

### Q6: What patterns exist for designing JSON configuration files that specify multiple remote API providers — each identified by a type discriminator, base URL, and API key environment variable reference — and what trade-offs arise between embedding call-site assignment as a per-provider attribute versus organizing providers into separate named groups for different call contexts?
**Tag**: `web`
**Covers**: `FR-9 [fusion.config.json with type/baseURL/apiKeyEnv]; FR-10 [ChatAdapterFactory selection by provider.type]; FR-15 [example config mixing local + remote]; C-1 [model-role assignment schema design]; NFR-6 [ConfigPort insulates application from config file]; AC-6 [JsonFileConfigAdapter satisfies ConfigPort]; AC-15 [example config with local and remote providers]`
**Answer shape**: A summary of at least three distinct config-schema approaches drawn from existing multi-provider LLM tools and generic multi-backend TypeScript projects, with trade-offs for each. Scope includes tools like LiteLLM, OpenRouter, and general Node.js config patterns. Stop when at least three approaches are identified with documented trade-offs (complexity, extensibility, discoverability).
**Decision unblocked**: Choosing the `fusion.config.json` schema design and defining the `ConfigPort` interface methods so the application layer never reads the config file directly.

### Q7: In Node.js 20+, what result shapes does `Promise.allSettled` return for fulfilled and rejected promises, and what patterns exist for aggregating multiple errors into a structured error report that distinguishes partial failures from a total failure where every promise rejected?
**Tag**: `web`
**Covers**: `FR-4 [PanelRunner Promise.allSettled + failed_models]; NFR-4 [panel stage buffered before synthesis]; NFR-5 [all_panels_failed fatal, partial failures non-fatal]; AC-7 [failed_models surfaced, all_panels_failed FusionError]`
**Answer shape**: A quick-reference on `Promise.allSettled` result types (`fulfilled` vs `rejected` shapes), plus catalogued error-aggregation patterns from Node.js best-practice sources. Scope is MDN documentation and Node.js error-handling guides. Stop when the result shape discrimination and at least two aggregation patterns are documented.
**Decision unblocked**: Implementing the parallel dispatch and result collection logic so that partial panel failures are reported in metadata and only total panel failure stops the pipeline.

### Q8: How does the Zod TypeScript library parse and validate JSON objects against a schema with specific nested fields, and what error information does it provide when validation fails?
**Tag**: `web`
**Covers**: `FR-5 [Analysis zod schema validation]; AC-8 [JudgeStep parses response against Analysis schema, graceful degradation on validation failure]`
**Answer shape**: A code-level summary of Zod's `parse` / `safeParse` methods, schema definition for nested objects with typed fields, and the structure of `ZodError` (field paths, messages). Scope is Zod v3 documentation. Stop when the parse, safeParse, error formatting, and nested schema APIs are documented.
**Decision unblocked**: Defining the `Analysis` zod schema and implementing the parse/validation logic so that validation failures trigger graceful degradation rather than crashing the pipeline.

### Q9: What response fields do the OpenAI and Anthropic chat APIs return for token usage counts and timing information, and how are these fields structured in their SDK response types?
**Tag**: `web`
**Covers**: `FR-13 [per-stage cost/latency logging]; NFR-5 [failed_models include identifier, error code, truncated message]; NFR-7 [every stage logs cost and latency]; AC-13 [ConsoleLoggerAdapter logs per-stage cost/latency, failed_models entries]`
**Answer shape**: A table of token-usage and timing fields for both APIs (e.g., `usage.prompt_tokens`, `usage.completion_tokens`, latency fields if any), alongside the TypeScript type paths in each SDK. Scope is OpenAI and Anthropic API reference docs and SDK type definitions. Stop when all usage-related and timing-related response fields are catalogued for both APIs.
**Decision unblocked**: Extracting cost and latency data from SDK responses for structured per-stage logging through `LoggerPort`.

### Q10: What `tsconfig.json` settings are required for strict TypeScript mode targeting Node.js 20+ with ESM modules, and what `package.json` fields and scripts are conventional for a project executed via the `tsx` dev runner?
**Tag**: `web`
**Covers**: `AC-1 [package.json + tsconfig.json with Node 20+, strict TS, tsx dev script]; FR-15 [project scaffolding]; C-7 [system runnable end-to-end]`
**Answer shape**: A checklist of `tsconfig.json` compiler options for strict mode + ESM + Node 20 target, and `package.json` fields (`type`, `scripts`, `engines`, `devDependencies`). Scope is TypeScript documentation, Node.js ESM docs, and `tsx` documentation. Stop when a minimal working `tsconfig.json` and `package.json` can be specified.
**Decision unblocked**: Scaffolding the project with correct TypeScript strict-mode configuration and a working `tsx` dev execution script.

### Q11: What testing frameworks and patterns are commonly used for unit testing TypeScript applications built with a hexagonal architecture — particularly for testing pure domain logic and for testing application-layer orchestrators with stubbed port interfaces (no real SDKs or HTTP servers involved)?
**Tag**: `web`
**Covers**: `FR-14 [unit tests at domain and application layers]; NFR-1 [dependency rule enables pure testability]; AC-14 [domain tests exercise Analysis schema, prompt builders, FusionError; application tests exercise use cases with stubbed ChatModelPort and ConfigPort]`
**Answer shape**: A summary of recommended testing framework (e.g., vitest, jest), stubbing/mocking patterns for port interfaces, and test directory organization conventions. Scope is testing-framework documentation and hexagonal-architecture testing literature. Stop when framework choice, stub creation patterns, and test layout conventions are identified.
**Decision unblocked**: Setting up the test harness and writing domain-layer tests (no mocks needed) and application-layer tests (stubbed ports) that validate the core business logic independently of infrastructure.

### Q12: What prompt engineering patterns exist for: (a) comparing multiple LLM responses to identify areas of consensus, contradictions, unique insights, and blind spots, and (b) merging multiple LLM responses into a single coherent final answer that is grounded in the source responses without introducing unsupported claims?
**Tag**: `web`
**Covers**: `FR-3 [pipeline stages: panel → judge → synthesis]; FR-5 [Analysis schema fields: consensus, contradictions, unique_insights, blind_spots]; FR-6 [SynthesizeStep incorporates panel outputs and judge analysis]; AC-8 [judge produces structured Analysis]; AC-9 [synthesis references analysis + panel outputs, no unsourced claims]`
**Answer shape**: A catalog of published prompt techniques for comparative evaluation of LLM outputs and for multi-source response synthesis, each with a brief description and example template. Scope is prompt engineering guides, research papers, and practitioner blogs. Stop when at least 2–3 distinct patterns for evaluation prompts and 2–3 patterns for synthesis prompts are identified.
**Decision unblocked**: Designing the judge prompt template and the synthesis prompt template so that the analysis captures the four required fields and the final response stays grounded in source material.

### Q13: What patterns and libraries exist for structured logging in Node.js/TypeScript applications, particularly for capturing per-operation latency, error details (including error codes and truncated error messages), and structured metadata attached to log entries?
**Tag**: `web`
**Covers**: `FR-13 [ConsoleLoggerAdapter wired for per-stage cost/latency + failed_models]; NFR-7 [observability: every stage logs cost/latency, failed_models include identifier/error code/truncated message]; AC-13 [ConsoleLoggerAdapter: per-stage cost/latency, failed_models entries with model identifier, error code, truncated message]`
**Answer shape**: A summary of popular structured-logging libraries (e.g., pino, winston) with their API for attaching structured metadata, measuring latency, and recording error details. Scope is npm library documentation and structured-logging best-practice guides. Stop when a recommended library and pattern for per-operation structured logs with latency and error metadata is identified.
**Decision unblocked**: Implementing `ConsoleLoggerAdapter` with structured log entries that capture per-stage cost, latency, and detailed `failed_models` information.

### Q14: What content and structure do effective README files include for TypeScript projects using a ports-and-adapters (hexagonal) architecture — particularly regarding architecture diagrams, local development setup instructions, and configuration examples?
**Tag**: `web`
**Covers**: `FR-15 [README describes architecture, setup, usage]; AC-15 [README with architecture description, setup instructions, usage guide]`
**Answer shape**: A checklist of recommended README sections drawn from popular hexagonal/clean-architecture TypeScript repositories and README best-practice guides. Scope is open-source TypeScript projects using ports-and-adapters and general README-writing guides. Stop when a section checklist with examples is compiled.
**Decision unblocked**: Writing a README that communicates the architecture, setup steps, and usage instructions to users and contributors.

---

**Coverage verification**: All 44 normalized inventory IDs (`FR-1`–`FR-15`, `NFR-1`–`NFR-7`, `C-1`–`C-7`, `AC-1`–`AC-15`) appear in at least one `Covers` field. No question references the intended change, proposed feature names, desired outcomes, or prescriptive implementation direction. All questions are tagged `web` because the repository contains no source code to research; the three existing files (README.md, LICENSE, .gitignore) provide only Node.js project intent and standard ignore patterns, insufficient for a material `codebase` question. No `hybrid` situations exist since codebase evidence is absent.
