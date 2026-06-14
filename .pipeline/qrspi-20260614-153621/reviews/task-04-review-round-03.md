Now I have all the information needed. Let me perform the systematic review.

---

## Review Analysis

**1. Outline fidelity — Metadata/Dependencies/Traceability/Files**

The metadata (Task 04, Phase 1, Route full, Slice), Dependencies (01, 02 with explanations), Traceability (AC-5 partial, AC-6 partial, NFR-3, NFR-6, Gate Phase 1 Gate 2), and Files (all four paths matching the outline exactly) all align. The file purpose descriptions in `## Files` match the outline's descriptions.

However, the **Outline Scope** states: *"The openai SDK is confined to OpenAiChatAdapter per NFR-3."* The task spec's `ChatAdapterFactory` section (item 4) says: *"The factory must import `OpenAI` from `'openai'`... keeping NFR-3 satisfied — the factory's use of the SDK is limited to client construction."* This directly contradicts the outline's scope statement that the SDK is confined to the single adapter file. The spec attempts to justify the deviation, but the outline is the authoritative source. **FAIL** for outline fidelity.

**2. Structure-slice fidelity**

All four file paths match structure.md Slice 1 exactly: `src/infrastructure/outbound/config/json-file-config-adapter.ts`, `src/infrastructure/outbound/logging/console-logger-adapter.ts`, `src/infrastructure/outbound/llm/openai-chat-adapter.ts`, `src/infrastructure/outbound/llm/chat-adapter-factory.ts`. All paths are repository-relative with no escaping or absolute paths. **PASS**.

**3. Source-traceability completeness**

Goals citations (AC-5 partial, AC-6 partial) reference real acceptance criteria that indeed have adapter/factory and config-adapter portions. Plan citation matches Task 04 / Phase 1. Design citation names the correct Slice 1. Structure citation names the correct Slice 1 and lists all 4 files. **PASS**.

**4. Acceptance-criteria and NFR fidelity**

The `## Traceability` section matches the outline exactly: AC-5 (partial — adapter and factory), AC-6 (partial — config adapter), NFR-3, NFR-6, and Phase 1 Gate 2. No criteria dropped, added, or relabeled. However, the spec body's ChatAdapterFactory section effectively reinterprets NFR-3 (SDK confinement) in a way that contradicts the outline scope. This is captured under Outline fidelity. **PASS** for the traceability labels themselves.

**5. Dependency correctness**

Both dependencies (01, 02) point to lower task numbers, and each entry explains what this task needs (domain types from 01, port interfaces from 02). Task 04 does not depend on Task 03, which is correct per the wave analysis (Wave 3: Tasks 03 and 04 are parallel). **PASS**.

**6. Self-containment**

The `## Description` provides complete implementation detail for all four adapters including constructor signatures, method behaviors, request/response mappings, validation rules, and error handling. No "see Task N" or "see design.md" shortcuts. An implementer can proceed without consulting other documents. **PASS**.

**7. Test expectation quality**

All 22 test expectations state concrete triggers and observable outcomes (e.g., "Calling `logStageStart('panel')` on `ConsoleLoggerAdapter` causes `console.log` to be called with a JSON string whose parsed object contains..."). None references internal functions, helpers, or intermediate states. None is phrased as an implementation step. No new test infrastructure is introduced. All expectations are feasible using only Task 04's declared files plus existing repository files (domain types from Task 01, port interfaces from Task 02, and npm packages declared in Task 01). **PASS**.

**8. Placeholder-free quality**

No TBD, TODO, "details omitted", or similar placeholder language appears. The note about `ClockPort` being added in a later phase describes current state (no dependencies) while acknowledging future evolution without leaving anything undefined for the current task. **PASS**.

**9. AGENTS compliance**

AGENTS Guidance is not provided. **N/A**.

**10. Cross-task consistency**

- No file path in Task 04's `## Files` appears as CREATE in any active sibling task (01, 02, 03). Task 04's files are all in `src/infrastructure/outbound/`, while siblings handle `src/domain/model/`, `src/domain/ports/`, and `src/application/`.
- Dependency references are consistent: Task 01 provides the domain types Task 04 imports; Task 02 provides the port interfaces Task 04 implements.
- No overlapping scope: Task 04 implements infrastructure adapters; Task 03 implements the application use case. They operate at different layers and don't double-implement the same behavior.
- Test expectations for shared behaviors (e.g., `complete()` contract, `ConfigPort` methods) are consistent with sibling specs. Task 03's `RunFusionUseCase` calls `loggerPort.logStageStart('synthesis')`; Task 04's `ConsoleLoggerAdapter` is a generic implementation that handles any stage string. No conflict.

**PASS** for cross-task consistency (the NFR-3 issue is a design/doc consistency problem, not a sibling conflict).

---

### Status — FAIL

**Mutated:** yes
**Task:** 04
**Round:** 3

### Review Findings
| Area | Status | Notes |
|------|--------|-------|
| Outline fidelity | FAIL | Outline scope says "openai SDK is confined to OpenAiChatAdapter per NFR-3." Spec section 4 (ChatAdapterFactory) says "The factory must import OpenAI from 'openai'", contradicting the confinement rule. |
| Structure-slice fidelity | PASS | All 4 file paths match structure.md Slice 1 exactly; all are repository-relative. |
| Source-traceability completeness | PASS | Goals citations reference real AC labels; Plan/Design/Structure citations are correct. |
| Acceptance-criteria and NFR fidelity | PASS | AC-5/AC-6/NFR-3/NFR-6/Gate labels match outline; traceability section unchanged. |
| Dependency correctness | PASS | Depends on lower tasks 01 and 02 with explained needs; no mutual dependency with Task 03. |
| Self-containment | PASS | Full implementation detail for all four adapters; no cross-references needed. |
| Test expectation quality | PASS | 22 concrete trigger+outcome expectations; no implementation steps or internal references. |
| Placeholder-free quality | PASS | No TBD/TODO/placeholder language; forward-looking ClockPort note describes current state. |
| AGENTS compliance | N/A | No AGENTS guidance provided. |
| Cross-task consistency | PASS | No file path overlaps with active siblings 01–03; no scope double-implementation; dependency references consistent. |

### Mutations Applied
1. **ChatAdapterFactory must not import `OpenAI` from `"openai"`.** The outline scope explicitly confines the `openai` SDK to `OpenAiChatAdapter`. Revise section 4 (`ChatAdapterFactory`) to eliminate the direct `import OpenAI from "openai"` in the factory. The recommended alternative: add a static factory method to `OpenAiChatAdapter` (e.g., `static create(modelRef: ModelRef): OpenAiChatAdapter`) that constructs the `OpenAI` client internally, and have `ChatAdapterFactory.create()` delegate to that static method. This keeps all `"openai"` imports confined to `OpenAiChatAdapter` while preserving the factory's ability to produce adapters by provider type.

### Unresolved Cross-Task Conflicts
None.

### Summary
FAIL — ChatAdapterFactory spec contradicts outline scope that confines the `openai` SDK to `OpenAiChatAdapter`; mutation needed to relocate client construction into the adapter file via a static factory method.
