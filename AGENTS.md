# AGENTS.md

Guidance for AI agents working in **fusion-local-proxy** (package name `fusion-chat`).

## What this is

A locally deployed LLM proxy that exposes OpenAI-compatible
(`POST /v1/chat/completions`) and Anthropic-compatible (`POST /v1/messages`)
HTTP APIs. Internally it runs an ensemble pipeline: fan out to a panel of
models → optional judge model produces a structured analysis → synthesize one
streamed response. Backends (local Ollama/LM Studio, OpenRouter, OpenAI,
Anthropic) are selected via `fusion.config.json`, not code.

TypeScript, ESM, Node.js 20+. No build step — everything runs through `tsx`.

## Commands

| Task              | Command                                             |
| ----------------- | --------------------------------------------------- |
| Dev server        | `npm run dev` (alias: `npm start`)                  |
| Type-check        | `npm run typecheck`                                 |
| Run tests         | `node --import tsx --test "src/**/*.test.ts"`       |
| Run one test file | `node --import tsx --test src/path/to/file.test.ts` |
| Lint              | `npm run lint`                                      |
| Lint + fix        | `npm run lint:fix`                                  |
| Format            | `npm run format`                                    |
| Format check      | `npm run format:check`                              |

Always run `npm run typecheck`, the test suite, `npm run lint`, and
`npm run format:check` before considering a change done. There is no
separate build step.

## Architecture (hexagonal / ports-and-adapters)

Dependency rule — dependencies point **inward only**:

```
infrastructure  →  application  →  domain
```

- `src/domain/` — pure types, prompt builders, schemas, and **port interfaces**
  (`ChatModelPort`, `ConfigPort`, `LoggerPort`, `ClockPort`). No framework, SDK,
  or I/O imports here. Keep it pure.
- `src/application/` — use-case orchestration (`RunFusionUseCase`, `PanelRunner`,
  `JudgeStep`, `SynthesizeStep`) and the inbound port (`FusionService`). Depends
  only on domain.
- `src/infrastructure/` — adapters that implement ports: inbound HTTP (Hono
  routes, translators, SSE encoders), outbound LLM/config/logging adapters, and
  the composition root `di/container.ts`.
- `src/main.ts` — bootstrap; wiring lives in `container.ts`.

## Hard boundaries (enforced by tests)

`src/infrastructure/architectural-boundaries.test.ts` uses grep-based static
analysis to fail the build on violations:

- `hono` / `@hono/*` imports may appear **only** in
  `src/infrastructure/inbound/http/`.
- `openai` SDK may be imported **only** in `outbound/llm/openai-chat-adapter.ts`.
- `@anthropic-ai/sdk` may be imported **only** in
  `outbound/llm/anthropic-chat-adapter.ts`.

Because detection is grep-based, **use single-line ESM `import … from …`
statements** — no multi-line imports, dynamic `import()`, or `require()` for
these packages.

## Conventions

- **ESM import paths must end in `.js`** even when importing a `.ts` file
  (NodeNext resolution), e.g. `import { foo } from './bar.js'`.
- Use `import type { … }` for type-only imports (`isolatedModules` is on).
- TypeScript runs in `strict` mode — keep it clean, no `any` escape hatches.
- Constructor dependency injection: pass ports into use-case constructors as
  `private readonly` params; wire concrete adapters only in `container.ts`.
- Domain errors use `FusionError` (`src/domain/model/fusion-types.ts`) with a
  stable `code` string.
- Tests are colocated `*.test.ts` files using `node:test` + `node:assert/strict`.

## Adding things

- **New provider/backend protocol**: add a `ChatModelPort` adapter under
  `outbound/llm/`, register it in `ChatAdapterFactory`, keep the SDK import
  confined to that one adapter file.
- **New inbound API**: add routes/translators/SSE encoders under
  `inbound/http/`; translate to/from domain types and call `FusionService`.
- **New config field**: extend `ConfigPort` (domain) and
  `JsonFileConfigAdapter`, and update the config docs in `README.md`.
