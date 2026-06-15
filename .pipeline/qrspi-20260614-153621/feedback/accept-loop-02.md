# Backward Loop Feedback — accept-loop-02

- **Triggering Stage:** accept (Stage 8)
- **Current Phase:** 4
- **Issue:** NFR-2 (Hono confined to http/ directory) and NFR-3 (SDK confined to adapters) failed. Structure.md directs SDK client construction inside `chat-adapter-factory.ts` and does not constrain Hono-family imports. 
- **Affected Artifact:** structure
- **Recommendation:** Update structure.md to (a) relocate `serve()` and Hono app creation into `src/infrastructure/inbound/http/server.ts`, and (b) change adapters to accept provider config and internally construct SDK clients, eliminating SDK imports from factory.
- **Loop Target:** Structure (Stage 5)
- **Decision:** Automated best-effort policy — Affected Artifact "structure" maps to Structure loop-back.
