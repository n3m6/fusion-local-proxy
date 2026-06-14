# Task 18: Documentation and example config

## Metadata
- **Task:** 18
- **Phase:** 5
- **Route:** full
- **Slice:** Observability, Tests, and Documentation

## Dependencies
- **17** — Application-layer unit tests complete and passing. The README references `npm test` in the development setup section, which must work. The `fusion.config.json` example must reflect the config schema (`providers` array with `type`, `role`, `model`, `baseURL`, `apiKeyEnv` fields) that the application-layer tests exercise through `ConfigPort` stubs.

## Traceability
- **Acceptance Criteria:** AC-15
- **NFRs:** NFR-1
- **Replan Gate Criteria:** Phase 5 Gate 2 (documentation complete)

## Source Traceability
- **Goals:** AC-15 (README describes architecture, setup, and usage; example `fusion.config.json` mixes at least one local and one remote provider)
- **Plan:** Task 18, Phase 5 — Polish
- **Design:** Slice 6: Observability, Tests, and Documentation
- **Structure:** Slice 6 — `README.md` (MODIFY), `fusion.config.json` (MODIFY)

## Description

Replace the single-line `README.md` with comprehensive documentation covering all five sections described below. Replace the single-provider `fusion.config.json` with a realistic multi-provider example mixing local and remote backends.

### README.md — Section 1: Title and Overview

Replace the current one-liner (`fusion-local-proxy` + single sentence) with a project title, a 2-3 sentence summary explaining what Fusion Local Proxy does (exposes OpenAI- and Anthropic-compatible APIs while internally running a fan-out-to-panel → judge → streamed-synthesis ensemble pipeline against configurable backends), and a brief list of key capabilities:
- Dual API surface: OpenAI `/v1/chat/completions` and Anthropic `/v1/messages`
- Ensemble pipeline: parallel panel → structured judge analysis → streamed synthesis
- Configurable model backends: local (Ollama/LM Studio), OpenRouter, direct OpenAI/Anthropic
- Hexagonal architecture with pure domain and application layers

### README.md — Section 2: Architecture

Include a Mermaid `flowchart TD` diagram showing the system architecture. The diagram must show:
- **External Clients** subgraph: OpenAI client and Anthropic client
- **Inbound Adapters** subgraph: HTTP routes (`POST /v1/chat/completions`, `POST /v1/messages`, `GET /v1/models`), request translators, SSE encoders
- **Application Layer** subgraph: `FusionService` inbound port, `RunFusionUseCase`, `PanelRunner`, `JudgeStep`, `SynthesizeStep`
- **Domain Layer** subgraph: pure types (`Message`, `PanelResponse`, `Analysis`, `FusionError`), services (prompt builders, analysis schema), outbound ports (`ChatModelPort`, `ConfigPort`, `LoggerPort`)
- **Outbound Adapters** subgraph: `ChatAdapterFactory`, `OpenAiChatAdapter`, `AnthropicChatAdapter`, `JsonFileConfigAdapter`, `ConsoleLoggerAdapter`
- **Composition Root**: `container.ts`, `main.ts`
- Flow arrows showing: client → inbound route → translator → `FusionService.runFusion()` → `RunFusionUseCase` orchestrates panel/judge/synthesis via `ChatModelPort` → stream events back to client

Follow the diagram with a **port inventory table** listing every port interface, its layer (domain or application), the adapter(s) that implement it, and a one-line description of what it provides:

| Port | Layer | Implemented By | Purpose |
|------|-------|---------------|---------|
| `ChatModelPort` | Domain | `OpenAiChatAdapter`, `AnthropicChatAdapter` | LLM completion and streaming via `complete()` and `stream()` |
| `ConfigPort` | Domain | `JsonFileConfigAdapter` | Provider configuration: panel, judge, synthesizer models and timeout |
| `LoggerPort` | Domain | `ConsoleLoggerAdapter` | Structured per-stage logging with latency and token counts |
| `ClockPort` | Domain | `DateClockAdapter` | Wall-clock time for latency measurement |
| `FusionService` | Application | `RunFusionUseCase` | Ensemble pipeline entry point: `runFusion(request) → AsyncIterable<StreamEvent>` |

### README.md — Section 3: Local Development Setup

Provide step-by-step instructions:

**Prerequisites:** Node.js 20+, npm 9+, a `.env` file with API keys for any remote providers you configure.

**Clone and install:**
```bash
git clone <repo-url>
cd fusion-local-proxy
npm install
```

**Environment:** Copy `.env.example` to `.env`. Populate `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` for the providers in your `fusion.config.json`. Local providers (Ollama with `baseURL: "http://localhost:11434/v1"`) can use a dummy key value.

**Dev server:**
```bash
npm run dev
```
Starts the proxy on `http://localhost:3000` (or the port set by the `PORT` environment variable).

**Verify:**
```bash
curl http://localhost:3000/v1/models
```
Returns a JSON array of model entries configured in `fusion.config.json`.

**Tests:**
```bash
npm test
```
Runs vitest with the configured spec files. Domain-layer tests exercise pure types and schemas without mocks; application-layer tests exercise use cases with stubbed ports.

### README.md — Section 4: Usage Examples

Provide concrete curl commands for both API surfaces:

**OpenAI-compatible endpoint (non-streaming):**
```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fusion",
    "messages": [{"role": "user", "content": "What are the trade-offs between microservices and monoliths?"}]
  }' | jq .
```
Returns a `ChatCompletion` JSON object with the synthesized response from the ensemble pipeline.

**OpenAI-compatible endpoint (streaming):**
```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fusion",
    "messages": [{"role": "user", "content": "Explain quantum computing in simple terms"}],
    "stream": true
  }'
```
Returns SSE `data:` lines with `chat.completion.chunk` payloads, keep-alive comments (`: panel running`, `: judging`) during the non-streamed phases, and `data: [DONE]` termination.

**Anthropic-compatible endpoint (streaming):**
```bash
curl -N http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Summarize the key ideas in hexagonal architecture"}]
  }'
```
Returns SSE `event:` + `data:` lines in the documented sequence: `message_start` → `content_block_start` → `content_block_delta` (multiple) → `content_block_stop` → `message_delta` → `message_stop`.

### README.md — Section 5: Configuration Reference

Document the `fusion.config.json` schema:

**Top-level fields:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `providers` | `Provider[]` | Yes | — | Array of provider configuration objects |
| `timeoutMs` | number | No | 30000 | Per-call timeout in milliseconds for each LLM request |

**Provider object fields:**
| Field | Type | Required | Values | Description |
|-------|------|----------|--------|-------------|
| `type` | string | Yes | `"openai"`, `"anthropic"` | Provider type — determines which outbound adapter is selected |
| `role` | string | Yes | `"panel"`, `"judge"`, `"synthesizer"` | Role in the ensemble pipeline. Multiple providers can share the `"panel"` role. Only one provider should be assigned `"judge"` and one `"synthesizer"` |
| `model` | string | Yes | e.g., `"gpt-4o"`, `"claude-sonnet-4-20250514"`, `"llama3.1:8b"` | Model identifier sent to the provider's API |
| `baseURL` | string | Yes | e.g., `"https://api.openai.com/v1"`, `"http://localhost:11434/v1"` | Base URL for the provider's API endpoint |
| `apiKeyEnv` | string | Yes | e.g., `"OPENAI_API_KEY"`, `"ANTHROPIC_API_KEY"` | Name of the environment variable holding the API key. Local providers (Ollama) can use any value |

**Roles explained:**
- **panel**: Models queried in parallel. All panel responses are collected and fed to the judge and synthesizer. Multiple providers with `"role": "panel"` are supported and run concurrently via `Promise.allSettled`.
- **judge**: Model that analyzes panel responses, producing a structured analysis with consensus, contradictions, unique insights, and blind spots. Optional (set to `null` in config or omit). On failure, the pipeline degrades gracefully — synthesis proceeds with raw panel responses.
- **synthesizer**: Model that produces the final streamed response, incorporating panel outputs and (when available) judge analysis. Exactly one synthesizer is required.

### fusion.config.json — Replace with multi-provider example

Replace the current single-provider config (one `openai` panel entry) with an example that demonstrates a realistic local + remote setup. The config must include:

1. **At least two panel providers**: one local (e.g., `ollama` with `baseURL: "http://localhost:11434/v1"` and `model: "llama3.1:8b"`) and one remote (e.g., `"gpt-4o"` with `baseURL: "https://api.openai.com/v1"`). Both must have `"role": "panel"`.
2. **One judge provider**: a remote model (e.g., `"claude-sonnet-4-20250514"` with `type: "anthropic"`, `baseURL: "https://api.anthropic.com"`, and `"role": "judge"`).
3. **One synthesizer provider**: a remote model (e.g., `"gpt-4o"` with `type: "openai"`, `baseURL: "https://api.openai.com/v1"`, and `"role": "synthesizer"`).
4. **`timeoutMs`** set to `30000`.

Use `apiKeyEnv` values that match the environment variable names documented in `.env.example` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and a dummy `OLLAMA_API_KEY` for the local provider). Ensure the JSON is valid and the structure matches the schema the `JsonFileConfigAdapter` expects (flat `providers` array with inline `role` fields).

## Files
- `README.md` (MODIFY) — Replace the current one-line description with comprehensive documentation covering all five sections: title and overview, architecture diagram (Mermaid + port inventory table), local development setup (prerequisites, clone, install, env, dev server, verify, tests), usage examples (curl commands for OpenAI non-streaming, OpenAI streaming, Anthropic streaming), and configuration reference (annotated `fusion.config.json` example with field reference tables for top-level and provider fields, plus role explanations).
- `fusion.config.json` (MODIFY) — Replace the single-provider config with a realistic multi-provider example: two panel providers (one local Ollama at `http://localhost:11434/v1` with model `llama3.1:8b`, one remote OpenAI at `https://api.openai.com/v1` with model `gpt-4o`), one judge provider (remote Anthropic at `https://api.anthropic.com` with model `claude-sonnet-4-20250514`), one synthesizer provider (remote OpenAI at `https://api.openai.com/v1` with model `gpt-4o`), and `timeoutMs: 30000`.

## Test Expectations
- **README architecture section**: The rendered README contains a Mermaid `flowchart TD` diagram with subgraphs for External Clients, Inbound Adapters (Hono routes and translators), Application Layer (`FusionService`, `RunFusionUseCase`, `PanelRunner`, `JudgeStep`, `SynthesizeStep`), Domain Layer (pure types, services, ports), Outbound Adapters (factory, adapters, config, logging), and Composition Root — with directed edges showing the request flow from client to stream events.
- **README port inventory**: The README contains a table listing all five port interfaces (`ChatModelPort`, `ConfigPort`, `LoggerPort`, `ClockPort`, `FusionService`) with the layer each belongs to, the adapter(s) that implement each, and a one-line purpose description.
- **README setup section**: The README includes step-by-step instructions for: prerequisites (Node 20+, npm 9+, .env), clone and install (`git clone`, `npm install`), environment setup (copy `.env.example` to `.env`, populate keys), dev server (`npm run dev` on port 3000), verification (`curl /v1/models` returns model array), and tests (`npm test` runs vitest).
- **README usage examples**: The README includes three complete curl examples: (1) OpenAI non-streaming request with `jq` output, (2) OpenAI streaming request with `stream: true` showing expected SSE format, (3) Anthropic streaming request with `x-api-key` header and `max_tokens` showing expected SSE event sequence.
- **README config reference**: The README includes a top-level fields table (`providers`, `timeoutMs` with types, required/optional, defaults, descriptions) and a provider fields table (`type`, `role`, `model`, `baseURL`, `apiKeyEnv` with accepted values and descriptions), plus a subsection explaining what each role (`panel`, `judge`, `synthesizer`) does in the ensemble pipeline.
- **fusion.config.json multi-provider**: The JSON file contains a `providers` array with exactly four entries: two with `"role": "panel"` (one `type: "openai"` with `baseURL` pointing to `api.openai.com`, one local `type: "openai"` with `baseURL` pointing to `http://localhost:11434/v1` for Ollama), one with `"role": "judge"` and `type: "anthropic"`, and one with `"role": "synthesizer"` and `type: "openai"`.
- **fusion.config.json local provider**: At least one provider entry uses `"baseURL": "http://localhost:11434/v1"` with a local model name (e.g., `"llama3.1:8b"`) and a dummy `apiKeyEnv` (e.g., `"OLLAMA_API_KEY"`).
- **fusion.config.json valid JSON**: The file is valid JSON, parsable by `JSON.parse`, with no trailing commas or syntax errors. Every provider entry has all five required fields (`type`, `role`, `model`, `baseURL`, `apiKeyEnv`).
- **README replaces one-liner**: The original one-line README content (`# fusion-local-proxy` + single sentence) is fully replaced — none of the old content remains.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
