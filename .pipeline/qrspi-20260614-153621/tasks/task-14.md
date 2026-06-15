# Task 14: README and example fusion.config.json

## Metadata
- **Task:** 14
- **Phase:** 5
- **Route:** full
- **Slice:** Slice 6 (Documentation)

## Dependencies
- **Task 01** — Package.json scripts (`start`, `typecheck`, `dev`) and `@anthropic-ai/sdk` dependency must be present so commands in the README are accurate.
- **Task 02** — Domain service scaffold files (`analysis-schema.ts`, `judge-prompt.ts`, `synthesis-prompt.ts`) must exist so the README's architecture description can reference the domain services layer accurately and the ensemble pipeline can function end-to-end.
- **Tasks 03–06** — The ensemble pipeline (panel fan-out, judge analysis, synthesis, use-case orchestration) must be implemented so the README's architecture description reflects the complete system.
- **Tasks 07–08** — Streaming infrastructure (SSE, keep-alive comments, `[DONE]` termination) must exist so the README's streaming API examples and SSE format description are accurate.
- **Tasks 09–10** — Anthropic inbound/outbound adapters (`/v1/messages` route, `AnthropicChatAdapter`, 6-event SSE sequence) must exist so the README's Anthropic API usage example references correct endpoint behavior and event types.
- **Task 11** — The DI container must be wired for the full ensemble so the README can reference a working bootstrap flow.
- **Tasks 12–13** — Domain and infrastructure tests must exist so `npm test` commands in the README produce meaningful output.

## Traceability
- **Acceptance Criteria:** AC-15
- **NFRs:** None specific
- **Replan Gate Criteria:** Phase 5 Gate 2 (documentation quality)

## Source Traceability
- **Goals:** AC-15 — README describes architecture, setup, and usage. An example `fusion.config.json` mixes at least one local and one remote provider.
- **Plan:** Task 14, Phase 5 — Polish (Wiring, Tests, Documentation)
- **Design:** Slice 6 — Observability, Tests, and Documentation
- **Structure:** Slice 6 — `README.md` (MODIFY), `fusion.config.json` (MODIFY)

## Description

This task produces the project's end-user documentation and a realistic example configuration file. By this point the full system is implemented: dual inbound HTTP APIs (OpenAI `/v1/chat/completions` and Anthropic `/v1/messages`), the ensemble pipeline (fan-out panel → judge analysis → streamed synthesis), streaming SSE infrastructure with keep-alive comments, outbound adapters for both OpenAI and Anthropic backends, a DI container, and a test suite. The README must explain all of this to a developer who has never seen the project before.

### README.md

The current `README.md` contains only a one-line tagline. Replace it entirely with developer-focused documentation covering:

1. **Project title and overview.** A 2–3 sentence description of what the server does: it exposes OpenAI- and Anthropic-compatible HTTP APIs and internally runs an ensemble pipeline — fan-out to a configurable panel of models, an optional judge analysis, and a streamed synthesis response. Mention the hexagonal (ports-and-adapters) architecture and that it supports local (Ollama/LM Studio), OpenRouter, and direct OpenAI/Anthropic backends through configuration alone.

2. **Architecture diagram.** Include a Mermaid `flowchart TD` diagram showing the hexagonal layers:
   - External clients (OpenAI client, Anthropic client)
   - Inbound adapters: `POST /v1/chat/completions`, `POST /v1/messages`, `GET /v1/models`, plus translators and SSE encoders
   - Application layer: `FusionService` inbound port, `RunFusionUseCase`, `PanelRunner`, `JudgeStep`, `SynthesizeStep`
   - Domain layer: `Message`, `PanelResponse`, `Analysis`, `FusionError`, prompt builders, `ChatModelPort`, `ConfigPort`, `LoggerPort`
   - Outbound adapters: `ChatAdapterFactory`, `OpenAiChatAdapter`, `AnthropicChatAdapter`, `JsonFileConfigAdapter`, `ConsoleLoggerAdapter`
   - The composition root (`container.ts` → `main.ts`) and the `fusion.config.json` config file
   The diagram must show data flow: client → inbound route → translator → `FusionService.runFusion()` → ensemble use case → outbound `ChatModelPort` → provider SDKs → upstream LLMs, with the stream returning via SSE encoders back to the client.

3. **Prerequisites.** List requirements: Node.js 20+ (link to nodejs.org), and a package manager (npm). Note that no global install is needed — `tsx` runs as a dev dependency.

4. **Installation and setup.**
   - `git clone` (omit specific URL; use a placeholder)
   - `npm install`
   - Copy `.env.example` to `.env` and populate required API keys (reference the key names: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, plus any local/OpenRouter keys from the example config)
   - Review `fusion.config.json` and adjust provider entries for your backends

5. **Configuration reference.** A table describing each field in `fusion.config.json`:
   | Field | Type | Required | Description |
   |---|---|---|---|
   | `providers` | array | yes | Array of provider objects. Each provider represents a model backend with an assigned role. |
   | `providers[].type` | `"openai" \| "anthropic"` | yes | Protocol/API type of the provider. Determines which outbound adapter is used. |
   | `providers[].role` | `"panel" \| "judge" \| "synthesizer"` | yes | Role this provider serves in the ensemble pipeline. At least one `"synthesizer"` is required. Panel and judge are optional but a panel role should be present for meaningful ensemble behavior. |
   | `providers[].model` | string | yes | Model name passed to the upstream API (e.g., `"llama3"`, `"gpt-4o"`, `"claude-sonnet-4-20250514"`). |
   | `providers[].baseURL` | string | yes | Base URL of the API endpoint, including the path prefix (e.g., `"http://localhost:11434/v1"` for local Ollama, `"https://api.openai.com/v1"` for OpenAI). |
   | `providers[].apiKeyEnv` | string | yes | Name of the environment variable holding the API key for this provider. The adapter reads `process.env[apiKeyEnv]` at startup. |
   | `timeoutMs` | number | no | Per-call timeout in milliseconds (default: 30000). Applies to each outbound LLM call. |
   Briefly explain that multiple providers can share the same `role` (e.g., multiple panel members), and `type` must match the actual API protocol of the backend.

6. **API usage.** Provide concrete `curl` examples for both endpoints. Include both a non-streaming OpenAI example and a streaming OpenAI example with SSE output shown:

   **OpenAI non-streaming:**
   ```bash
   curl -s http://localhost:8787/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"fusion","messages":[{"role":"user","content":"What are the trade-offs between monoliths and microservices?"}]}'
   ```

   **OpenAI streaming:**
   ```bash
   curl -N http://localhost:8787/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"fusion","messages":[{"role":"user","content":"Explain the CAP theorem"}],"stream":true}'
   ```

   Note the expected SSE output pattern: keep-alive comments (`: panel running`, `: judging`) followed by `data:` lines with `object: "chat.completion.chunk"` payloads and a final `data: [DONE]` line.

   **Anthropic streaming:**
   ```bash
   curl -N http://localhost:8787/v1/messages \
     -H "Content-Type: application/json" \
     -H "x-api-key: anthropic-key" \
     -d '{"model":"fusion","max_tokens":1024,"messages":[{"role":"user","content":"Explain the CAP theorem"}]}'
   ```

   Note the expected Anthropic SSE event sequence: `message_start` → `content_block_start` → `content_block_delta` (multiple) → `content_block_stop` → `message_delta` → `message_stop`, each with both `event:` and `data:` SSE fields.

   Also mention `GET /v1/models` which returns a stub model list:
   ```bash
   curl -s http://localhost:8787/v1/models
   ```

7. **Development workflow.**
   - Start the dev server: `npm run dev` (runs `tsx src/main.ts`)
   - Alternative: `npm start` (same behavior)
   - Type-check: `npm run typecheck` (runs `tsc --noEmit`)
   - Run the test suite: `npm test` (uses `node:test` with `node:assert/strict`)
   - Note that the default port is 8787 (set via `PORT` environment variable, or defaults in `main.ts`)

8. **Environment variables.** A table of all environment variables the system reads:
   | Variable | Required | Purpose |
   |---|---|---|
   | `OPENAI_API_KEY` | if any provider has `apiKeyEnv: "OPENAI_API_KEY"` | API key for OpenAI-compatible backends |
   | `ANTHROPIC_API_KEY` | if any provider has `apiKeyEnv: "ANTHROPIC_API_KEY"` | API key for Anthropic backends |
   | `OLLAMA_API_KEY` | if any provider has `apiKeyEnv: "OLLAMA_API_KEY"` | API key for local Ollama (can be any non-empty string) |
   | `OPENROUTER_API_KEY` | if any provider has `apiKeyEnv: "OPENROUTER_API_KEY"` | API key for OpenRouter |
   | `PORT` | no | HTTP server port (default: 8787) |
   | `FUSION_CONFIG_PATH` | no | Path to the config file (default: `fusion.config.json`) |
   Reference the `.env.example` file for a template.

9. **Project structure.** A brief tree or bullet list of the key directories showing the hexagonal layout:
   - `src/domain/model/` — pure domain types
   - `src/domain/ports/` — outbound port interfaces
   - `src/domain/services/` — pure logic (prompt builders, analysis schema)
   - `src/application/ports/` — inbound port (`FusionService`)
   - `src/application/usecases/` — use-case orchestration
   - `src/infrastructure/inbound/http/` — Hono server, OpenAI and Anthropic routes
   - `src/infrastructure/outbound/llm/` — `OpenAiChatAdapter`, `AnthropicChatAdapter`, `ChatAdapterFactory`
   - `src/infrastructure/outbound/config/` — `JsonFileConfigAdapter`
   - `src/infrastructure/outbound/logging/` — `ConsoleLoggerAdapter`
   - `src/infrastructure/di/` — composition root
   - `src/main.ts` — bootstrap

### fusion.config.json

Replace the current single-provider config with a realistic multi-provider example that demonstrates the full ensemble configuration. The file must:

- Define four provider entries in the `providers` array, each with a distinct role:
  1. **Panel provider (local Ollama, openai type):** `type: "openai"`, `role: "panel"`, `model` set to a local model name (e.g., `"llama3:8b"`), `baseURL` pointing to a local Ollama instance (`"http://localhost:11434/v1"`), `apiKeyEnv: "OLLAMA_API_KEY"`.
  2. **Panel provider (OpenRouter, openai type):** `type: "openai"`, `role: "panel"`, `model` using an OpenRouter model identifier (e.g., `"openai/gpt-4.1-mini"`), `baseURL: "https://openrouter.ai/api/v1"`, `apiKeyEnv: "OPENROUTER_API_KEY"`.
  3. **Judge provider (remote OpenAI):** `type: "openai"`, `role: "judge"`, `model: "gpt-4o"`, `baseURL: "https://api.openai.com/v1"`, `apiKeyEnv: "OPENAI_API_KEY"`.
  4. **Synthesizer provider (remote Anthropic):** `type: "anthropic"`, `role: "synthesizer"`, `model: "claude-sonnet-4-20250514"`, `baseURL: "https://api.anthropic.com/v1"`, `apiKeyEnv: "ANTHROPIC_API_KEY"`.
- Retain `timeoutMs: 30000` as the top-level field.
- Every `apiKeyEnv` value must have a corresponding entry in `.env.example` or be a commonly understood variable that the README's environment variables table documents.
- Include a brief JSON comment (if the JSON format permits) or at minimum, ensure the `apiKeyEnv` names are self-documenting so readers can correlate them with the README's environment variable table.

The `.env.example` file must be updated (or verified) to include entries for every `apiKeyEnv` referenced in the example config: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_API_KEY`, and `OPENROUTER_API_KEY`.

## Files
- `README.md` (MODIFY) — Rewrite from the one-line tagline to comprehensive developer documentation covering architecture, setup, configuration, API usage, development workflow, and environment variables. Include a Mermaid architecture diagram, config field reference table, curl examples for both OpenAI and Anthropic endpoints, and an environment variables table.
- `fusion.config.json` (MODIFY) — Replace the single-provider entry with a multi-provider example: two panel providers (local Ollama `openai` type + OpenRouter `openai` type), one judge provider (remote OpenAI), one synthesizer provider (remote Anthropic). All `apiKeyEnv` fields must reference environment variables documented in the README and present in `.env.example`.

## Test Expectations
- **README architecture diagram:** The README contains a Mermaid `flowchart TD` block that includes boxes for External Clients, Inbound Adapters (OpenAI route, Anthropic route, translators, SSE encoders), Application Layer (FusionService, RunFusionUseCase, PanelRunner, JudgeStep, SynthesizeStep), Domain Layer (models, ports, services), Outbound Adapters (ChatAdapterFactory, OpenAiChatAdapter, AnthropicChatAdapter, JsonFileConfigAdapter, ConsoleLoggerAdapter), and the Composition Root (container.ts, main.ts).
- **README configuration table:** The README contains a table with at least the following fields documented: `providers[].type`, `providers[].role`, `providers[].model`, `providers[].baseURL`, `providers[].apiKeyEnv`, and `timeoutMs`.
- **README OpenAI example:** The README includes a `curl` command for `POST /v1/chat/completions` with a JSON body containing `model`, `messages`, and `stream: true`, and describes or shows the expected SSE output with `chat.completion.chunk` objects and `data: [DONE]` termination.
- **README Anthropic example:** The README includes a `curl` command for `POST /v1/messages` with a JSON body containing `model`, `max_tokens`, and `messages`, and describes or shows the expected SSE event sequence (`message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`).
- **README development commands:** The README documents `npm run dev`, `npm run typecheck`, and `npm test` as available scripts with a brief description of each.
- **README environment variables table:** The README documents at least `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_API_KEY`, `OPENROUTER_API_KEY`, `PORT`, and `FUSION_CONFIG_PATH`.
- **Config multi-provider structure:** `fusion.config.json` contains exactly four provider entries in the `providers` array with distinct configurations.
- **Config panel diversity:** At least one provider has `type: "openai"` and `role: "panel"` with a `baseURL` pointing to a local address (e.g., `http://localhost:11434/v1`); at least one other provider has `role: "panel"` with a `baseURL` pointing to a remote address (e.g., `https://openrouter.ai/api/v1`).
- **Config judge role:** Exactly one provider has `role: "judge"` with `type: "openai"` and `apiKeyEnv: "OPENAI_API_KEY"`.
- **Config synthesizer role:** Exactly one provider has `role: "synthesizer"` with `type: "anthropic"` and `apiKeyEnv: "ANTHROPIC_API_KEY"`.
- **Config mixed local/remote:** The example config mixes at least one local provider (localhost baseURL) and at least two remote providers (non-localhost baseURLs), satisfying AC-15's requirement to mix local and remote models.
- **Environment variable consistency:** Every `apiKeyEnv` value in `fusion.config.json` has a corresponding entry in `.env.example` and is documented in the README's environment variables table.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.
