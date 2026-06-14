Now I have all the evidence needed for a thorough review. Let me compile the findings.

---

### Status — FAIL

**Mutated:** yes
**Task:** 01
**Round:** 1

### Review Findings
| Area | Status | Notes |
|------|--------|-------|
| Outline fidelity | FAIL | The outline’s `fusion.config.json` entry says `role: "panel"`; the spec says `role: "synthesizer"` in its Files section, Description, and example config. The outline also omits `timeoutMs`, which is safe elaboration, but the role field is a direct contradiction. |
| Structure-slice fidelity | FAIL | Two deviations: (1) `fusion.config.json` role is `"panel"` in the structure map but `"synthesizer"` in the spec; (2) `fusionStreamToOpenAiResponse` is declared in structure.md as `(events: AsyncIterable<FusionStreamEvent>): Promise<Record<string, unknown>>` but the spec defines it as `(events: FusionStreamEvent[]): Record<string, unknown>`. |
| Source-traceability completeness | PASS | Goals, Plan, Design, and Structure citations are present and reference the correct labels and slices. |
| Acceptance-criteria and NFR fidelity | PASS | AC-1 through AC-6 are listed with the `(complete signature)` qualifier on AC-3. NFR-1, NFR-2, NFR-3 (with SDK-scope note), and NFR-6 are all listed. Phase 1 Gate 1 and Gate 2 are quoted verbatim. |
| Dependency correctness | PASS | Dependencies are `None`, matching the outline. |
| Self-containment | PASS | The Description covers architecture, layers, config, every file’s behavior, DI wiring, and bootstrap. No “see Task N” or external-only references. |
| Test expectation quality | PASS | Every expectation states a concrete trigger and observable outcome. All are feasible with this task’s output plus `npm install`. No expectation requires future-task files or undeclared harnesses. Minor vagueness in the missing-API-key expectation (“may start… or a clear startup warning”) is acceptable because it reflects SDK behavior variability. |
| Placeholder-free quality | PASS | No TBD, TODO, or “details omitted” language remains. Forward references to future slices (e.g., “The stream() method is added in Slice 4”) are informational, not placeholders. |
| AGENTS compliance | N/A | No AGENTS guidance was provided. |
| Cross-task consistency | PASS | Task 01 has no sibling tasks to conflict with. |

### Mutations Applied
1. **Align `fusion.config.json` role with outline and structure.md.** In the `## Files` section, change `role: "synthesizer"` to `role: "panel"`. In the Description section, change the passthrough-mode paragraph: instead of “the single entry must have `role: "synthesizer"` because `RunFusionUseCase` calls `ConfigPort.getSynthesizerModel()`”, state that the entry has `role: "panel"` and the use case selects the model from `configPort.getPanelModels()[0]`. Update the example config block accordingly (role → `"panel"`). In the `RunFusionUseCase` description, change step 2 from `configPort.getSynthesizerModel()` to `configPort.getPanelModels()[0]` (throwing a descriptive error if the panel array is empty). In the DI container description, change step 5 to obtain the model via `getPanelModels()[0]` instead of `getSynthesizerModel()`. In the `JsonFileConfigAdapter` description, update the `getSynthesizerModel()` notes to reflect that it returns `null` when no synthesizer is configured (which is expected in Slice 1). In the models route, ensure the panel-model entry is included (it already reads from all three accessors, so this is fine). In test expectations, adjust the `/v1/models` curl check to expect the panel-model entry (no synthesizer model exists in the config).

2. **Align `fusionStreamToOpenAiResponse` signature with structure.md.** Change the translator function signature from `(events: FusionStreamEvent[]): Record<string, unknown>` to `(events: AsyncIterable<FusionStreamEvent>): Promise<Record<string, unknown>>`. Update the route description so it no longer collects events into an intermediate array but instead passes the async iterable directly to `fusionStreamToOpenAiResponse` and `await`s the result. (The route’s error-event detection logic must iterate the async iterable inside the response builder instead of scanning a pre-collected array.)

### Unresolved Cross-Task Conflicts
None. (The two failures are local to task-01.md and can be repaired by mutating only the task spec. No sibling task files exist to create a multi-file conflict.)

### Summary
FAIL — the spec contradicts the outline and structure.md on the config role (`"panel"` vs `"synthesizer"`) and on the `fusionStreamToOpenAiResponse` function signature. Both can be resolved by editing task-01.md alone; the mutations above describe the needed changes. No cross-task conflicts exist. After these corrections the spec will pass all review areas.
