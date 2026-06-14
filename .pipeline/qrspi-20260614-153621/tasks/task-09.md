# Task 09: Domain streaming extension

## Metadata
- **Task:** 09
- **Phase:** 3
- **Route:** full
- **Slice:** Streaming Synthesis + Timeouts

## Dependencies
- **Task 08** delivers the complete ensemble pipeline with `RunFusionUseCase` orchestrating `PanelRunner`, `JudgeStep`, and `SynthesizeStep` (non-streamed) through the existing `ChatModelPort.complete()` interface. Task 08 ensures the `ChatModelPort` created in Task 02 is stable, all domain model types (`ChatRequest`, `ChatResponse`, `TokenUsage` from `chat-types.ts`) are in place, and the system is runnable end-to-end before the port is extended with streaming. This task adds `stream()` alongside `complete()` without altering any existing caller since only the synthesizer will adopt `stream()` in Task 10.

## Traceability
- **Acceptance Criteria:** AC-3 (partial — `stream()` signature)
- **NFRs:** NFR-1 (dependency rule: zero SDK/framework imports in domain)
- **Replan Gate Criteria:** Phase 3 Gate 1 (stream() signature available for application and adapter)

## Source Traceability
- **Goals:** AC-3 — `ChatModelPort` interface defines `complete()` and `stream()` signatures using only domain types
- **Plan:** Task 09, Phase 3 — Streaming Synthesis
- **Design:** Streaming Synthesis + Timeouts
- **Structure:** Streaming Synthesis + Timeouts — `src/domain/ports/chat-model-port.ts` (MODIFY)

## Description

Extend the `ChatModelPort` interface in `src/domain/ports/chat-model-port.ts` with a streaming capability. This file was originally created in Task 02 with only the non-streaming `complete()` method. This task adds a `stream()` method and a supporting `ChatStreamEvent` discriminated union type to the same file. The existing `complete()` signature must remain unchanged so that `PanelRunner` and `JudgeStep` (which use non-streamed calls) continue to compile without modification.

### `ChatStreamEvent` discriminated union

Define a new exported type `ChatStreamEvent` that represents raw token-level events yielded by a streaming LLM call through the port. This is the domain-level port event — distinct from `FusionStreamEvent` (the application-level stream event defined in `src/domain/model/stream-types.ts`). The use case (Task 10) will translate `ChatStreamEvent` variants into `FusionStreamEvent` variants: `ChatStreamEvent.token` maps to `FusionStreamEvent.content_delta`, while the use case inserts its own `FusionStreamEvent.progress` and `FusionStreamEvent.done` events that have no port-level equivalent.

`ChatStreamEvent` is a discriminated union with three variants:

- **`token`** — an individual text token from the streaming model. Carries a `text` field containing the raw string delta. This is the payload that the port yields repeatedly as the model generates content.
  - `type: 'token'`
  - `text: string`

- **`done`** — signals that the stream has completed successfully. Carries an optional `usage` field with token counts (`TokenUsage`), present when the upstream provider returns usage information for the streamed call (e.g., OpenAI's final usage chunk with `stream_options.include_usage`, or Anthropic's `message_delta` usage). The `usage` field is optional because not all providers or streaming configurations include token counts.
  - `type: 'done'`
  - `usage?: TokenUsage`

- **`error`** — signals that the stream terminated abnormally. Carries a machine-readable `code` string (e.g., `'timeout'`, `'upstream_error'`) and a human-readable `message`. Unlike the `done` variant, there is no usage information — the stream failed before collecting a complete response.
  - `type: 'error'`
  - `code: string`
  - `message: string`

Every variant uses `readonly` properties to enforce immutability, consistent with the project's domain model conventions.

### `ChatModelPort.stream()` method

Add a second method to the `ChatModelPort` interface:

- `stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>` — initiates a streaming LLM call. Accepts the same `ChatRequest` type as `complete()`, so callers pass the same canonical request shape regardless of streaming mode. The `ChatRequest.options.signal` field (an `AbortSignal`) is the mechanism for timeout cancellation — outbound adapters wire it to the SDK's `AbortSignal` passthrough. Returns an `AsyncIterable<ChatStreamEvent>` that yields token events as the model generates, followed by a terminal `done` event (with optional usage) on success, or an `error` event on failure.

The method must be adjacent to `complete()` in the interface — no reordering of the existing method.

### Imports

The file currently imports `ChatRequest` and `ChatResponse` from `../model/chat-types.js`. This task requires importing `TokenUsage` from the same module for the `ChatStreamEvent.done` variant's `usage` field. The import line should be extended to include `TokenUsage`:

```typescript
import type { ChatRequest, ChatResponse, TokenUsage } from '../model/chat-types.js';
```

No other imports are added. In particular, there must be zero imports from any SDK (`openai`, `@anthropic-ai/sdk`, `hono`, `zod`) or from `src/application/` or `src/infrastructure/`.

### Design rationale

The `ChatStreamEvent` type is intentionally minimal — it captures only what the port can guarantee across providers. There is no `tool_calls`, `finish_reason`, or provider-specific metadata because the single `ChatModelPort` must work uniformly with both OpenAI and Anthropic backends. Any provider-specific enrichment happens inside the outbound adapter, but the port itself yields only the common denominator. The use case (RunFusionUseCase) is responsible for wrapping these raw events into the richer `FusionStreamEvent` structure that includes progress notifications and final metadata.

The return type `AsyncIterable<ChatStreamEvent>` (rather than `ReadableStream` or Node.js `stream.Readable`) keeps the port aligned with the JavaScript async iteration protocol, which integrates naturally with `for await...of` loops in the application layer and is compatible with both provider SDKs' native stream objects after adaptation.

## Files
- `src/domain/ports/chat-model-port.ts` (MODIFY) — Add `ChatStreamEvent` discriminated union type (`token`, `done`, `error`) and `stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>` method to the `ChatModelPort` interface; extend the import line to include `TokenUsage` from `../model/chat-types.js`; preserve the existing `complete()` signature unchanged

## Test Expectations
- **Existing signature preserved**: `ChatModelPort.complete()` retains the exact signature `(request: ChatRequest) => Promise<ChatResponse>` with no changes to parameter types, return type, or method name.
- **New stream method**: `ChatModelPort.stream()` has the signature `(request: ChatRequest) => AsyncIterable<ChatStreamEvent>`. The `request` parameter uses the same `ChatRequest` type as `complete()`.
- **ChatStreamEvent shape — token**: The union includes `{ readonly type: 'token'; readonly text: string }`. The `text` field carries a single string token delta.
- **ChatStreamEvent shape — done**: The union includes `{ readonly type: 'done'; readonly usage?: TokenUsage }`. The `usage` field is optional (not `TokenUsage | undefined` — it can be absent from the object entirely).
- **ChatStreamEvent shape — error**: The union includes `{ readonly type: 'error'; readonly code: string; readonly message: string }`. Both `code` and `message` are required strings.
- **Compilation**: `npx tsc --noEmit` produces zero TypeScript errors from `src/domain/ports/chat-model-port.ts`. The file type-checks against the domain model types imported from `../model/chat-types.js`.
- **Dependency rule — no SDK imports**: `grep -r "from 'openai'" src/domain/ports/chat-model-port.ts` returns empty; `grep -r "from '@anthropic-ai" src/domain/ports/chat-model-port.ts` returns empty; `grep -r "from 'hono'" src/domain/ports/chat-model-port.ts` returns empty; `grep -r "from 'zod'" src/domain/ports/chat-model-port.ts` returns empty.
- **Dependency rule — no layer violations**: `grep -r "from 'src/application/" src/domain/ports/chat-model-port.ts` returns empty; `grep -r "from 'src/infrastructure/" src/domain/ports/chat-model-port.ts` returns empty.
- **No runtime coupling**: The file contains only `import type` declarations, `export type` declarations, and `export interface` declarations. There is zero executable code, no class implementations, no default method bodies, and no references to filesystem, network, or concrete SDK clients.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
