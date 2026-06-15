# Task 07: Domain streaming interface (ChatModelPort.stream() + ChatStreamChunk)

## Metadata
- **Task:** 07
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 4 (Streaming Domain)

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC-3 (ChatModelPort complete() + stream())
- **NFRs:** NFR-1 (domain purity), NFR-4 (streaming interface defined)
- **Replan Gate Criteria:** Phase 3 Gate 1 (streaming interface exists for adapters), Phase 3 Gate 2 (timeout signal passthrough on stream signature)

## Source Traceability
- **Goals:** AC-3 — ChatModelPort interface defines complete() and stream() signatures using only domain types
- **Plan:** Task 07, Phase 3 — Streaming Synthesis
- **Design:** Slice 4 (Streaming Synthesis + Timeouts) — Domain stream events and ChatModelPort.stream() signature added; ChatStreamChunk discriminated union defined
- **Structure:** Slice 4 — `src/domain/ports/chat-model-port.ts (MODIFY)`, `src/domain/model/chat-types.ts (MODIFY)`

## Description

Extend the domain-layer streaming contract with two pure changes:

### 1. Add `stream()` to `ChatModelPort`

The `ChatModelPort` interface (in `src/domain/ports/chat-model-port.ts`) currently defines only `complete(request: ChatRequest): Promise<ChatResponse>`. Add a second method:

```
stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
```

The `stream()` method accepts the same `ChatRequest` as `complete()`, which already carries an optional `options.signal: AbortSignal` for timeout passthrough. This enables downstream adapters (Tasks 08–10) to wire `AbortController`-based cancellation into provider SDK streaming calls.

The existing `complete()` signature is preserved unchanged. All phases call `complete()` for panel and judge (buffered) and `stream()` for synthesis (streamed).

### 2. Define `ChatStreamChunk` discriminated union

In `src/domain/model/chat-types.ts`, append a new exported type:

```typescript
export type ChatStreamChunk =
  | { readonly type: 'content_delta'; readonly delta: string }
  | { readonly type: 'content_stop' }
  | { readonly type: 'usage'; readonly usage: TokenUsage };
```

- **`content_delta`** — carries a single incremental text token from the model (the "delta"). An adapter implementing `stream()` yields one or more of these as tokens arrive, then yields exactly one `content_stop`, and finally yields exactly one `usage` chunk.
- **`content_stop`** — signals that the model has finished producing content. No further `content_delta` chunks follow this.
- **`usage`** — carries the final `TokenUsage` (prompt/completion/total token counts) for the call. This is the stream terminator; no chunks follow it.

The `TokenUsage` interface (`promptTokens`, `completionTokens`, `totalTokens`) already exists in `chat-types.ts` and is reused by the `usage` variant without modification.

This task is a **domain-only** change. No concrete adapter is modified or implemented, no infrastructure file is touched, and no runtime behavior is altered. The `stream()` method and `ChatStreamChunk` type are pure TypeScript declarations that Task 08 implements in `OpenAiChatAdapter` and consumes in `SynthesizeStep` (upgraded from `complete()` to `stream()` in Task 08).

### Timeout passthrough (Phase 3 Gate 2)

The `stream()` method's `ChatRequest` parameter already includes `options?: ChatOptions`, and `ChatOptions` already carries `signal?: AbortSignal`. No changes to `ChatRequest` or `ChatOptions` are needed: the `AbortSignal` passthrough path exists on the signature as-is. Concrete adapter implementations in later tasks forward `request.options?.signal` into the provider SDK's `stream()` call.

### Domain purity (NFR-1)

The `ChatModelPort` interface and `chat-types.ts` module must continue to import only from other domain modules. No imports from `src/application/` or `src/infrastructure/` are permitted. No SDK (`openai`, `@anthropic-ai/sdk`, `hono`, `zod`) may appear in these files.

### Wire compatibility note

The `ChatStreamChunk` type is a minimal domain abstraction. Provider-specific SDK streaming types (OpenAI `ChatCompletionChunk`, Anthropic `RawMessageStreamEvent`, etc.) are mapped into this union inside each outbound adapter and never leak into the domain or application layers.

## Files
- `src/domain/ports/chat-model-port.ts` (MODIFY) — Add `stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>` method to the `ChatModelPort` interface alongside the existing `complete()` method. Extend the import statement to also import `ChatStreamChunk` from `../model/chat-types.js`.
- `src/domain/model/chat-types.ts` (MODIFY) — Append the `ChatStreamChunk` discriminated union type (`content_delta` | `content_stop` | `usage`) reusing the existing `TokenUsage` interface.

## Test Expectations
- **Interface shape — `stream()` exists:** When a TypeScript source file imports `ChatModelPort` and declares a concrete class `implements ChatModelPort`, the compiler must require both `complete(request: ChatRequest): Promise<ChatResponse>` and `stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>` to be present.
- **Interface shape — `complete()` unchanged:** When a concrete adapter that already implements `complete()` (e.g., `OpenAiChatAdapter`) is type-checked, the existing `complete()` method signature must still satisfy the `ChatModelPort` interface without modification.
- **Discriminated union — `content_delta` variant:** When an object `{ type: 'content_delta', delta: 'Hello' }` is assigned to a variable typed `ChatStreamChunk`, TypeScript must accept it and narrow the type so that `delta` is accessible as `string`.
- **Discriminated union — `content_stop` variant:** When an object `{ type: 'content_stop' }` is assigned to a variable typed `ChatStreamChunk`, TypeScript must accept it. The object must not require a `delta` or `usage` property.
- **Discriminated union — `usage` variant:** When an object `{ type: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }` is assigned to a variable typed `ChatStreamChunk`, TypeScript must accept it and narrow the type so that `usage` is accessible as `TokenUsage`.
- **Discriminated union — invalid type rejected:** When an object with `type: 'invalid'` is assigned to a variable typed `ChatStreamChunk`, TypeScript must emit a type error.
- **AbortSignal passthrough — signature support:** When a caller invokes `stream({ messages: [...], model: {...}, options: { signal: someAbortSignal } })`, the TypeScript compiler must accept the call without type errors, confirming the `AbortSignal` passthrough path exists on the `stream()` signature.
- **Domain purity — no outward imports:** When `src/domain/ports/chat-model-port.ts` and `src/domain/model/chat-types.ts` are inspected, every import must resolve to a path under `src/domain/`. Zero imports from `src/application/` or `src/infrastructure/` are permitted. Zero imports from SDK packages (`openai`, `@anthropic-ai/sdk`, `hono`, `zod`) are permitted in `chat-model-port.ts`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.

## Replan Review Status
- **State:** clean (round 1)
- **Outstanding Concerns:** None.
