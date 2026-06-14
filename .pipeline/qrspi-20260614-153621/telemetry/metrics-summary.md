# Metrics Summary — qrspi-20260614-153621

## Run

- **Route:** full
- **Final status:** stopped-partial
- **Total duration:** 17942 s
- **Stages completed:** 5 of 10
- **Resume count:** 1
- **Backward loop count:** 0

## Stage Durations

| Stage | Phase | Duration (s) | Status |
| ----- | ----- | ------------ | ------ |
| goals | 1 | 256 | PASS |
| research | 1 | 2703 | PASS |
| design | 1 | 162 | PASS |
| structure | 1 | 514 | PASS |
| plan | 1 | 937 | PARTIAL |
| implement | 1 | 1624 | FAIL |
| plan | 1 | 2615 | PARTIAL |
| implement | 1 | 3417 | FAIL |

## Child Agent Calls

| Stage | Child Agent | Calls | Pass | Fail |
| ----- | ----------- | ----- | ---- | ---- |
| research | qrspi-question-generator | 1 | 1 | 0 |
| research | qrspi-question-leakage-reviewer | 1 | 1 | 0 |
| research | qrspi-question-quality-reviewer | 1 | 1 | 0 |
| research | qrspi-codebase-researcher | 1 | 1 | 0 |
| research | qrspi-web-researcher | 1 | 1 | 0 |
| research | qrspi-research-synthesizer | 1 | 1 | 0 |
| research | qrspi-research-reviewer | 2 | 2 | 0 |
| plan | qrspi-plan-writer | 1 | 1 | 0 |
| plan | qrspi-plan-reviewer | 1 | 1 | 0 |
| implement | qrspi-integration-checker | 1 | 1 | 0 |
| plan | qrspi-plan-writer | 1 | 1 | 0 |
| plan | qrspi-plan-reviewer | 1 | 1 | 0 |
| implement | generic-coding | 3 | 3 | 0 |

## Review Rounds

| Stage | Type | Rounds |
| ----- | ---- | ------ |
| goals | reviewer | 2 |
| research | reviewer | 2 |
| design | reviewer | 1 |
| structure | reviewer | 1 |
| plan | reviewer | 1 |
| plan | reviewer | 1 |

## Retry and Loop Counts

- **Stage retries:** 0
- **E2E remediation rounds:** 0
- **Regression remediation rounds:** 0
- **Acceptance loop rounds:** 0
- **Review round cap hits:** 2
- **Backward loops:** 0

## Human Gate Outcomes

| Stage | Presentations | Rejections | Approvals |
| ----- | ------------- | ---------- | --------- |
| plan | 0 | 0 | 2 |

## Test Evidence Quality

| Phase | Deterministic | Flaky | Harness Noisy | Ambiguous | Redundant | No-Test Tasks | No-Test Audit Overrides |
| ----- | ------------- | ----- | ------------- | --------- | --------- | ------------- | ----------------------- |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Code Health

- **Coverage status:** SKIPPED
- **Plan/Replan terminal review states:** plan:unclean-cap, replan:unclean-cap
