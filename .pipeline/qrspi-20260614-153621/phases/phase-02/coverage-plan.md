| Criterion | Action | Planned Test File | Rationale |
|-----------|--------|-------------------|-----------|
| AC-4 | reuse | `src/infrastructure/inbound/http/server.test.ts` | FusionService port exercised through HTTP endpoint; `tsc --noEmit` enforces signature |
| AC-7 | revise | `src/infrastructure/inbound/http/server.test.ts` | Added FusionError `all_panels_failed` HTTP 500 acceptance test |
| AC-8 | reuse | `src/application/usecases/judge-step.test.ts` | 12 tests cover all failure modes; orchestration tests (#7, #8) verify cross-component degradation |
| AC-9 | reuse | `src/application/usecases/synthesize-step.test.ts` | 13 tests verify prompt grounding and event contract; hallucination check deferred to Phase 5 |
| NFR-5 | reuse | `src/application/usecases/run-fusion-use-case.test.ts` | 13 tests cover all three graceful-degradation legs; stream metadata deferred to Phase 4 |
