# Backward Loop Analysis — Phase 4

### Severity Analysis
| # | Criterion | Failure Reason | Failure | Local Code Only | File Boundary Change | Interface Change | Architecture Change | Scope Change | Safe To Defer | Classification | Loop-back Target | Rationale |
|---|-----------|----------------|---------|-----------------|----------------------|-------------------|---------------------|-------------|---------------|----------------|-----------------|-----------|
| 1 | NFR-2 | executed_failed | Hono-family imports (`@hono/node-server`, `hono`) in `src/main.ts` and `src/infrastructure/di/container.ts` outside the designated `src/infrastructure/inbound/http/` confinement zone | NO | YES | NO | NO | NO | NO | `LOOP_STRUCTURE` | structure | `serve()` call in `main.ts` and `Hono` type in `container.ts` must be relocated into `src/infrastructure/inbound/http/`; the structure.md file map does not constrain these files' Hono imports |
| 2 | NFR-3 | executed_failed | `openai` SDK client constructor imported in `src/infrastructure/outbound/llm/chat-adapter-factory.ts` (outside `OpenAiChatAdapter`) | NO | NO | YES | NO | NO | NO | `LOOP_STRUCTURE` | structure | Factory imports `OpenAI` to construct client; adapter constructor interface must change to accept config and self-manage SDK instantiation |
| 3 | NFR-3 | executed_failed | `@anthropic-ai/sdk` client constructor imported in `src/infrastructure/outbound/llm/chat-adapter-factory.ts` (outside `AnthropicChatAdapter`) | NO | NO | YES | NO | NO | NO | `LOOP_STRUCTURE` | structure | Same root cause as #2 — factory imports `Anthropic` to construct client; adapter must own its SDK dependency |

### Overall Recommendation
`LOOP_STRUCTURE`

### Rationale
Two independent structural defects share the same classification target. The first (NFR-2) is a file-boundary violation: Hono-family imports (`@hono/node-server` in `main.ts`, `hono` type in `di/container.ts`) sit outside the mandated `src/infrastructure/inbound/http/` confinement zone. The code must be restructured so the `serve()` bootstrap logic and `Hono` app construction live entirely within the HTTP directory. The second (NFR-3) is an interface-boundary defect in the outbound adapters: `chat-adapter-factory.ts` directly imports `OpenAI` and `Anthropic` SDK client constructors to build adapter dependencies, violating the rule that each SDK appears only in its designated adapter file. The adapter constructor signatures must change — from accepting pre-built SDK clients to accepting configuration and self-managing client creation — so the factory can select adapters by `provider.type` without importing any SDK. Neither defect is a design or goals issue; the design and goals documents correctly prescribe both confinement rules. Neither is a plan-only omission because the task specs (Tasks 09–10) followed the structure.md, which itself prescribed the violations (e.g., the structure instructed the factory to call `new Anthropic({...})`). Both require changes to file placement and interface contracts, making `LOOP_STRUCTURE` the correct upstream target.

### Backward Loop Request
**Criteria**: NFR-2, NFR-3  
**Issue**: Structure.md directs SDK client construction inside `chat-adapter-factory.ts` and does not constrain Hono-family imports in `main.ts` or `di/container.ts` to the HTTP directory, causing two non-functional requirement violations that block Phase 4 acceptance.  
**Affected Artifact**: structure  
**Recommendation**: Update structure.md to (a) relocate `serve()` and Hono app creation from `main.ts`/`container.ts` into `src/infrastructure/inbound/http/server.ts` (or a new bootstrap file within that directory), and (b) change `OpenAiChatAdapter` and `AnthropicChatAdapter` constructors to accept provider config (`baseURL`, `apiKey`) and internally construct their own SDK clients, eliminating SDK imports from the factory. The factory then selects and instantiates adapters using only config values, with zero direct SDK dependencies.
