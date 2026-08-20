# Verification Matrix

Evidence recorded on 2026-08-21 against the current working implementation. Unit tests use explicit timestamps; E2E uses Restate Server 1.7.2 in an isolated Docker Compose project.

## Product acceptance criteria

| # | Requirement | Automated evidence | Status |
| --- | --- | --- | --- |
| 1 | Confirmed start returns `taskId` without blocking conversation | `scripts/e2e.mjs`: response is 202 and under 2 seconds while hold is longer | Verified |
| 2 | Simulator heats toward target and reports current temperature | Compose E2E normal-completion paths | Verified |
| 3 | Hold does not start before first in-range reading | `test/domain/heating-task.test.ts`: `does not start the hold...` | Verified |
| 4 | Outside ±0.5°C pauses; return resumes accumulated time | reducer tests for boundaries and bounded intervals | Verified at domain level |
| 5 | Close succeeds before normal completion and announcement | reducer close test plus E2E completion event | Verified |
| 6 | Cancellation attempts safe close | reducer cancellation test plus E2E repeated cancellation | Verified |
| 7 | Close failure is visible and isolates the device | E2E `closeShouldFail`, `NEEDS_ATTENTION`, later start gets `DEVICE_BUSY` | Verified |
| 8 | Restart does not lose state or skip safety | E2E abruptly kills runtime during HOLDING, resumes and completes | Verified for runtime restart |
| 9 | Same heater has one active task; different heaters run concurrently | E2E busy request and parallel-device cancellation | Verified |
| 10 | Core tests need no real hardware, model or wall-clock hold | Vitest reducer tests and simulator | Verified |

## Extended engineering invariants

| Invariant | Evidence | Result |
| --- | --- | --- |
| ±0.5°C is inclusive | lower and upper boundary unit test | Pass |
| No interval is credited across an observation outage | stale-gap unit test | Pass |
| Runtime downtime is not silently credited | restart waits for `PAUSED_STALE_OBSERVATION` | Pass |
| Readings cannot predate the task | historical-observation unit test | Pass |
| Duplicate or decreasing timestamps fail closed | non-monotonic observation unit test | Pass |
| Cancellation accepted before seal overrides normal close intent | accepted-cancellation reducer test; record is single-writer | Pass |
| Unknown status and cancel do not create phantom workflows | Gateway 404 E2E | Pass |
| Start retry is idempotent; changed input conflicts | E2E same request and modified target | Pass |
| Accepted task is immediately queryable | E2E query immediately after 202 | Pass |
| Terminal state is independent of workflow retention | status reads `HeatingTaskRecord`, updated on every transition | Code-reviewed; E2E terminal query passes |
| Internal Restate handlers cannot bypass Gateway | E2E raw `HeaterDevice` call must fail | Pass |
| Acknowledged events are not listed as pending | E2E list after ack | Pass |
| Physical workflow does not wait indefinitely for voice ack | workflow returns after event publish; TaskRecord is updated by Inbox | Code-reviewed; E2E COMPLETED→NOTIFIED passes |
| `NEEDS_ATTENTION` retains device reservation | E2E second start receives `DEVICE_BUSY` | Pass |

## Commands and latest local result

```text
pnpm check                 PASS
pnpm test                  PASS — 20 tests
pnpm build                 PASS
docker compose config      PASS
pnpm test:e2e              PASS
```

The E2E success line is:

```text
E2E passed: private service boundary, async acceptance, not-found semantics,
idempotency, locking, idempotent cancellation, close failure, restart-gap safety,
durable task projection, and pending delivery.
```

## Deliberately not claimed

| Boundary | Missing evidence |
| --- | --- |
| Real Voice Agent | no STT/VAD/TTS, clarification, interruption or same-session unrelated-turn E2E |
| Audible delivery | acknowledgement endpoint is tested, but no real playout/drain signal |
| Trusted confirmation | receipt is visible in schema but not server-issued or cryptographically trusted |
| Real device | no vendor protocol, credentials, limits, read-back or hardware contract suite |
| Restate server disaster recovery | runtime restart is tested; server restart/volume restore and HA are not |
| Production security | no user auth, tenant authorization, workload identity or rate limiting |
| Laboratory safety | no hazard analysis, emergency procedure or certification |

These rows are release gates for their respective deployment stage, not hidden assumptions.
