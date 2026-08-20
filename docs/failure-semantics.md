# Failure Semantics

This system distinguishes business failure, confirmed safe shutdown, and uncertain physical state. “The workflow stopped” is not equivalent to “the heater stopped.”

## Failure matrix

| Event | Deterministic response | Task state | Device reservation | Agent result |
| --- | --- | --- | --- | --- |
| Invalid tool input | Reject before durable acceptance | no task | unchanged | validation error |
| Duplicate `requestId` | Return stored start result | original task | unchanged | same `taskId` |
| Same `requestId`, changed command | Reject as an idempotency conflict | original task | unchanged | `IDEMPOTENCY_CONFLICT` |
| Device already claimed | Reject new task | no new workflow | held by original task | `DEVICE_BUSY` |
| `setTemperature` rejected | Attempt close | `FAILED` if close succeeds | released after close | alert |
| Temperature read rejected | Stop timing and attempt close | `FAILED` if close succeeds | released after close | alert |
| Invalid/old temperature observation | Stop timing and attempt close | `FAILED` if close succeeds | released after close | alert |
| Observation gap exceeds configured maximum | Preserve accumulated time and resume from a new segment | remains `HOLDING` | retained | no premature completion |
| Heat-up timeout | Attempt close | `FAILED` if close succeeds | released after close | alert |
| User cancellation | Attempt close | `CANCELLED` if close succeeds | released after close | cancellation event |
| Hold satisfied | Attempt close | `COMPLETED` only after close | released after close | completion event |
| `close` reports failure | Never claim success | `NEEDS_ATTENTION` | **retained** | urgent alert |
| Close confirmed but reservation release is inconsistent | Preserve confirmed `closedAtMs`; raise control-plane failure | `FAILED` | retained until operator reconciliation | safe-failure alert |
| Runtime process restarts | Restate replays recorded operations and resumes | previous durable state | preserved | no duplicate normal event |
| Agent voice connection absent | Retain event in session inbox | `COMPLETED` | already released | deliver on next Agent opportunity |
| Restate unavailable before acceptance | Gateway returns upstream unavailable | no accepted task | no claimed success | retry with same `requestId` |

## Physical side effects are not magically exactly-once

Restate can replay the recorded result of a completed durable call, but an HTTP connection can fail after a heater applied a command and before the caller observed the response. No workflow engine can infer the physical outcome from that missing acknowledgement.

The production `HeaterDevice` adapter therefore needs a policy for every side effect:

1. Prefer a device-supported idempotency key based on `taskId` and operation name.
2. Make repeated `setTemperature(sameTarget)` and `close()` safe when the vendor contract permits it.
3. After a timeout, read back target, mode, or closed state before retrying.
4. If physical state cannot be established, return an explicit uncertain outcome.
5. Map uncertain close to `NEEDS_ATTENTION`; do not release the device reservation.

## Retry ownership

| Layer | May retry | Must not retry blindly |
| --- | --- | --- |
| Voice Agent | idempotent start with the same `requestId`; status query | create a new request ID after an ambiguous start |
| Gateway | safe reads and authenticated transport setup | device operations |
| Restate workflow | durable timers, journaled service calls, adapter-declared transient failures | unknown physical side effects without read-back |
| Device adapter | vendor-declared retryable reads and idempotent writes | commands with unknown outcome and no state query |

## Lock recovery

The reference implementation releases `HeaterCoordinator` only after `close` returns `closed: true`. A `NEEDS_ATTENTION` task intentionally blocks subsequent heating on the same device.

A production operator-recovery command must:

- require elevated authorization;
- inspect or physically verify the device;
- record who performed the recovery and why;
- close or isolate the device;
- release the reservation only after safe state is established.

It must not be an unrestricted LLM Tool.

## Measurement failures

The timing reducer requires strictly increasing observation timestamps that do not predate task acceptance. Duplicate or older timestamps are rejected rather than credited. Gaps beyond `MAXIMUM_OBSERVATION_GAP_MS` are treated as unobserved time and are not credited. Production adapters should also define:

- maximum acceptable reading age;
- clock source and synchronization policy;
- treatment of `NaN`, impossible values, and sensor diagnostic codes;
- consecutive read-failure budget before safe shutdown;
- separate heat-up and hold monitoring timeouts.

Those policies are device-specific configuration, not language-model instructions.
