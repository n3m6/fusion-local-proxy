# Backward Loop Feedback — implement-loop-01

- **Triggering Stage:** implement (Stage 7)
- **Current Phase:** 1
- **Issue:** `package.json` scripts were unintentionally stripped during Phase 1 implementation. The baseline recorded `"dev"`, `"start"`, and `"typecheck"` as available scripts; the current file has only `"dev"`. This regresses the ability to run `tsc --noEmit` and `node --import tsx src/main.ts` via npm.
- **Affected Artifact:** structure (package.json)
- **Recommendation:** Restore `"start": "tsx src/main.ts"` and `"typecheck": "tsc --noEmit"` to `package.json` scripts, then re-run the baseline typecheck and re-verify.
- **Loop Target:** Structure (Stage 5)
- **Decision:** Automated best-effort policy — Affected Artifact "structure" maps to Structure loop-back.
