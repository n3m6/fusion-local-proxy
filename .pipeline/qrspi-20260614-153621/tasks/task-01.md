# Task 01: Package.json regression fix and Anthropic SDK dependency

## Metadata
- **Task:** 01
- **Phase:** 1
- **Route:** full
- **Slice:** Slice 1 (Foundation Fix)

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC-1
- **NFRs:** NFR-1 (maintain dependency rule — no new SDK imports in domain/app)
- **Replan Gate Criteria:** Phase 1 Gate 1 (package.json scripts + @anthropic-ai/sdk dependency), Phase 1 Gate 2 (typecheck passes), Phase 1 Gate 3 (system remains runnable)

## Source Traceability
- **Goals:** AC-1
- **Plan:** Task 01, Phase 1 — Foundation Fix and Domain Services
- **Design:** Slice 1 (Passthrough Chat Completion — OpenAI)
- **Structure:** Slice 1 — `package.json` (MODIFY)

## Description

The current `package.json` contains only the `"dev": "tsx src/main.ts"` script. During a prior Phase 1 implementation, the `"start"` and `"typecheck"` scripts were lost — a regression. This task restores the complete three-script set mandated by the project structure and adds the Anthropic SDK dependency required by a later phase (Slice 5 / Phase 4).

**What to change in `package.json`:**

1. **Restore the `"start"` script** — add `"start": "tsx src/main.ts"` to the `scripts` object. This provides an explicit production-start alias (semantically distinct from `"dev"`, even though both run the same entry point).

2. **Restore the `"typecheck"` script** — add `"typecheck": "tsc --noEmit"` to the `scripts` object. The `tsconfig.json` already exists with `"strict": true`, Node 20+ target (`ES2023`, `NodeNext` module), and `"include": ["src/**/*.ts"]`, so `tsc --noEmit` performs full type checking without emitting compiled output.

3. **Add `@anthropic-ai/sdk` dependency** — add `"@anthropic-ai/sdk": "^0.104.1"` to `dependencies`. Version `0.104.1` is the version researched and confirmed to expose the required APIs (`stream()`, `output_config.format`, `AbortSignal` passthrough, and the 6-event `RawMessageStreamEvent` union). The SDK will be consumed later by `AnthropicChatAdapter` in Phase 4 (Slice 5); this task only installs the package.

After modifying `package.json`, run `npm install` to install the new dependency and ensure `node_modules` reflects the updated `package.json` and `package-lock.json`.

**Constraint — NFR-1 compliance:** This is a MODIFY-only task on `package.json`. No source files in `src/domain/` or `src/application/` are created or changed. The `@anthropic-ai/sdk` is added as a dependency but must not be imported anywhere in domain or application layers at this stage. Reviewers should verify that no `import from '@anthropic-ai/sdk'` or `require('@anthropic-ai/sdk')` appears in `src/domain/` or `src/application/` as a result of this task.

**Verification steps (manual):**

After completing the changes:

1. Confirm the `scripts` object has exactly three entries with the exact values:
   - `"dev": "tsx src/main.ts"`
   - `"start": "tsx src/main.ts"`
   - `"typecheck": "tsc --noEmit"`

2. Confirm `dependencies` includes `"@anthropic-ai/sdk": "^0.104.1"`.

3. Run `npm run typecheck` — must exit with code 0 and produce zero TypeScript errors.

4. Run `npm run dev` (or `npm run start`) — the Hono server boots on the configured port (default from existing code). Send a `curl` request to the existing passthrough endpoint and confirm a valid `ChatCompletion` JSON response:
   ```
   curl -s -X POST http://localhost:<port>/v1/chat/completions \
     -H 'Content-Type: application/json' \
     -d '{"model":"test","messages":[{"role":"user","content":"hello"}]}'
   ```
   Expected: HTTP 200 with JSON body containing `"choices"` array and `"model"` field.

5. Verify NFR-1: `grep -r "@anthropic-ai/sdk" src/domain/ src/application/` returns no matches.

## Files
- `package.json` (MODIFY) — Restore `"start": "tsx src/main.ts"` and `"typecheck": "tsc --noEmit"` to the `scripts` object. Add `"@anthropic-ai/sdk": "^0.104.1"` to `dependencies`. Run `npm install` to materialize the dependency in `node_modules` and update `package-lock.json`.

## Test Expectations
- **Scripts completeness:** After modification, the `scripts` object in `package.json` contains exactly three entries: `"dev": "tsx src/main.ts"`, `"start": "tsx src/main.ts"`, and `"typecheck": "tsc --noEmit"`. No additional scripts are present and none of the three are missing.
- **Dependency presence:** After `npm install`, the `@anthropic-ai/sdk` package is installed in `node_modules` and listed in `dependencies` with version `^0.104.1`.
- **Typecheck passes:** `npm run typecheck` exits with code 0 and produces zero errors on stdout/stderr.
- **Server boots and serves passthrough:** Starting the server with `npm run dev` (or `npm run start`) binds to the expected port. A `curl POST /v1/chat/completions` with a valid JSON body (`{"model":"...","messages":[...]}`) returns HTTP 200 with a JSON response containing `"object": "chat.completion"` (or equivalent `"choices"` array with a `"message"` object) — the existing passthrough behavior remains intact.
- **NFR-1 holds:** No file under `src/domain/` or `src/application/` imports `@anthropic-ai/sdk`. The grep `grep -r '@anthropic-ai/sdk' src/domain/ src/application/` returns zero matches.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 1)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 2)
- **Outstanding Concerns:** None.
