# Task 01: Project scaffold and domain model types

## Metadata
- **Task:** 01
- **Phase:** 1
- **Route:** full
- **Slice:** Passthrough Chat Completion (OpenAI)

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC-1
- **NFRs:** NFR-1
- **Replan Gate Criteria:** Phase 1 Gate 2 (zero SDK/framework imports in domain)

## Source Traceability
- **Goals:** AC-1
- **Plan:** Task 01, Phase 1 — Core Passthrough
- **Design:** Slice 1 — Passthrough Chat Completion (OpenAI)
- **Structure:** Slice 1 — Passthrough Chat Completion (OpenAI); `package.json`, `tsconfig.json`, `.env.example`, `src/domain/model/message.ts`, `src/domain/model/chat-types.ts`, `src/domain/model/fusion-types.ts`, `src/domain/model/stream-types.ts`

## Description

Create the Node 20+ ESM TypeScript project skeleton and define every canonical domain model type that serves as the shared vocabulary for all ports, use cases, and adapters built in later tasks. The domain types must be pure: zero imports from `src/application/`, `src/infrastructure/`, or any framework/SDK package (`hono`, `@hono/node-server`, `openai`, `zod`, `@anthropic-ai/sdk`).

### Project scaffold

**`package.json`** — sets `"type": "module"` for ESM, declares `"engines": { "node": ">=20.0.0" }`, and includes a `"dev": "tsx src/main.ts"` script (the `src/main.ts` entrypoint does not yet exist; the script is defined here so it is ready when the bootstrap file is created in Task 05). Dependencies: `hono`, `@hono/node-server`, `openai`, `zod`. Dev dependencies: `tsx`, `typescript`, `@types/node`. No `@anthropic-ai/sdk` dependency yet (not needed until Phase 4).

**`tsconfig.json`** — strict TypeScript configuration with `"strict": true`, `"target": "ES2023"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"resolveJsonModule": true`, `"esModuleInterop": true`, `"skipLibCheck": true`, `"isolatedModules": true`, and `"include": ["src/**/*.ts"]`. Do not set `rootDir` — omitting it lets TypeScript infer the root from the `include` glob, which works correctly when later tasks add files in `src/domain/`, `src/application/`, and `src/infrastructure/`.

**`.env.example`** — documents the `apiKeyEnv` variable names that `fusion.config.json` supports. Include at minimum `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` as commented examples, with a note that local backends (Ollama, LM Studio) typically use a dummy value.

### Domain model types

Every file below lives in `src/domain/model/` and contains only pure TypeScript type/interface/class definitions. The exact exports are:

---

**`src/domain/model/message.ts`** — foundational message shape used everywhere:
```typescript
export interface Message {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}
```

---

**`src/domain/model/fusion-types.ts`** — types for the fusion pipeline and error handling. Imports `Message` from `./message`:
```typescript
import type { Message } from './message.js';

export type ProviderType = 'openai' | 'anthropic';

export interface ModelRef {
  readonly provider: ProviderType;
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
}

export class FusionError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FusionError';
    this.code = code;
    this.details = details;
  }
}

export interface FusionRequest {
  readonly messages: Message[];
  readonly stream?: boolean;
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}
```
`FusionError` must extend `Error`, set `this.name = 'FusionError'`, and accept an optional `details` record for structured error metadata. `FusionRequest` is the canonical inbound request shape used by the `FusionService` port defined in Task 03.

---

**`src/domain/model/chat-types.ts`** — types for individual LLM calls through `ChatModelPort`. Imports `Message` from `./message` and `ModelRef` from `./fusion-types`:
```typescript
import type { Message } from './message.js';
import type { ModelRef } from './fusion-types.js';

export interface ChatRequest {
  readonly messages: Message[];
  readonly model: ModelRef;
  readonly options?: ChatOptions;
}

export interface ChatOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly responseFormat?: ResponseFormat;
  readonly signal?: AbortSignal;
}

export type ResponseFormat =
  | { readonly type: 'text' }
  | { readonly type: 'json_object' }
  | { readonly type: 'json_schema'; readonly schema: Record<string, unknown> };

export interface ChatResponse {
  readonly content: string;
  readonly usage: TokenUsage;
  readonly model: string;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}
```
`ChatRequest` pairs messages with a specific `ModelRef` (including provider credentials) and optional `ChatOptions`. `ChatOptions.signal` carries an `AbortSignal` for timeout cancellation (wired in Phase 3). `ResponseFormat` mirrors the structured-output shapes supported by both OpenAI and Anthropic SDKs. `ChatResponse` wraps the model's text output with token usage metadata.

---

**`src/domain/model/stream-types.ts`** — the discriminated union of events yielded by the fusion pipeline, plus the `FailedModelInfo` metadata type. Imports `TokenUsage` from `./chat-types`:
```typescript
import type { TokenUsage } from './chat-types.js';

export type FusionStreamEvent =
  | { readonly type: 'progress'; readonly stage: string; readonly message: string }
  | { readonly type: 'content_delta'; readonly delta: string }
  | { readonly type: 'content_stop' }
  | { readonly type: 'done'; readonly usage?: TokenUsage; readonly failedModels?: FailedModelInfo[] }
  | { readonly type: 'error'; readonly code: string; readonly message: string; readonly details?: unknown };

export interface FailedModelInfo {
  readonly modelId: string;
  readonly errorCode: string;
  readonly errorMessage: string;
}
```
The full event set is defined here even though `progress` events are not emitted until Phase 3 and `failedModels` is not populated until Phase 2. Defining them all now prevents breaking changes to downstream consumers. `FusionStreamEvent` is the return element type of `FusionService.runFusion()` (defined in Task 03).

---

All four `.ts` files must have zero imports from `src/application/`, `src/infrastructure/`, or any third-party package. The only permitted imports are between the four domain model files themselves (e.g., `./message`, `./fusion-types`, `./chat-types`).

## Files
- `package.json` (CREATE) — Node 20+ ESM project manifest with `hono`, `@hono/node-server`, `openai`, `zod` dependencies, `tsx`/`typescript`/`@types/node` dev dependencies, and `"dev": "tsx src/main.ts"` script
- `tsconfig.json` (CREATE) — strict TypeScript config: `target ES2023`, `module NodeNext`, `moduleResolution NodeNext`, `resolveJsonModule true`, `include ["src/**/*.ts"]`, no `rootDir`
- `.env.example` (CREATE) — template documenting `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` as commented examples, with a note that local backends use a dummy value
- `src/domain/model/message.ts` (CREATE) — `Message` interface with `role` and `content`
- `src/domain/model/chat-types.ts` (CREATE) — `ChatRequest`, `ChatOptions`, `ResponseFormat`, `ChatResponse`, `TokenUsage` types; imports `Message` and `ModelRef`
- `src/domain/model/fusion-types.ts` (CREATE) — `ProviderType`, `ModelRef`, `FusionError` class, `FusionRequest` interface; imports `Message`
- `src/domain/model/stream-types.ts` (CREATE) — `FusionStreamEvent` discriminated union (5 variants) and `FailedModelInfo` interface; imports `TokenUsage`

## Test Expectations
- **Project files exist:** `package.json`, `tsconfig.json`, and `.env.example` are present at the repository root with non-zero content.
- **package.json ESM and engine:** `package.json` contains `"type": "module"` and an `"engines"` block requiring `node >= 20.0.0`.
- **package.json scripts:** `package.json` has a `"dev"` script that runs `tsx src/main.ts`.
- **package.json dependencies:** `dependencies` includes `hono`, `@hono/node-server`, `openai`, and `zod`. `devDependencies` includes `tsx`, `typescript`, and `@types/node`.
- **tsconfig.json strictness:** `tsconfig.json` sets `"strict": true`, `"target": "ES2023"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"resolveJsonModule": true`, and `"include": ["src/**/*.ts"]`.
- **.env.example coverage:** `.env.example` contains the strings `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.
- **Domain model files exist:** All four `src/domain/model/*.ts` files exist with non-zero content.
- **Domain purity — no SDK imports:** Running `grep -r "from 'openai'" src/domain/` and `grep -r "from '@anthropic-ai/sdk'" src/domain/` and `grep -r "from 'hono'" src/domain/` and `grep -r "from 'zod'" src/domain/` all return empty (zero matches).
- **Domain purity — no application imports:** Running `grep -r "from '.*application.*'" src/domain/` returns empty.
- **Domain purity — no infrastructure imports:** Running `grep -r "from '.*infrastructure.*'" src/domain/` returns empty.
- **FusionError class:** `src/domain/model/fusion-types.ts` exports a `FusionError` class that extends `Error`, has a `code: string` property and optional `details` property, and sets `this.name = 'FusionError'` in its constructor.
- **FusionStreamEvent variants:** `src/domain/model/stream-types.ts` exports a `FusionStreamEvent` type with exactly five variants: `progress`, `content_delta`, `content_stop`, `done`, and `error`.
- **TypeScript compilation:** After `npm install`, running `npx tsc --noEmit` exits with code 0 and no errors (the four domain model files are self-contained and import only from each other).
