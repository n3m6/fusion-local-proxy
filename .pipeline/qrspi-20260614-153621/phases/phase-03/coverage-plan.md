| # | Criterion | Action | Planned Test File |
|---|-----------|--------|-------------------|
| 1 | AC-3: `ChatModelPort` interface defines `complete()` and `stream()` signatures using only domain types. | reuse | `src/domain/ports/task-02-ports.test.ts` |
| 2 | AC-10: The streaming SSE endpoint emits keep-alive comments during panel and judge phases, followed by proper OpenAI-format `chat.completion.chunk` events for synthesis tokens, and terminates with `data: [DONE]`. | reuse | `src/infrastructure/inbound/http/openai/sse-encoder.test.ts` |
| 3 | AC-12: A per-call `AbortController` timeout cancels the upstream LLM call if the configured deadline is exceeded. | reuse | `src/application/usecases/synthesize-step.test.ts` |
| 4 | NFR-4: Streaming guarantees — Only the synthesizer produces streamed content; panel and judge stages must be fully buffered before synthesis begins. SSE keep-alive comments must be emitted during panel and judge phases so the client connection does not time out. | reuse | `src/application/usecases/run-fusion-use-case.test.ts` |
