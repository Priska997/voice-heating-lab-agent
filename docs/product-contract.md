# Product Contract

## 1. Problem

During a chemistry experiment, the user's hands may be occupied or unsafe to remove from the current procedure. The user needs to control a heating platform through speech without physically operating the instrument.

## 2. Primary user action

The user provides:

- a target temperature in degrees Celsius;
- a hold duration;
- a device identity when it cannot be inferred safely.

Example: “Heat to 80°C and hold for 20 minutes.”

The desired business result is not merely setting a temperature. It is completing a supervised lifecycle: confirm, heat, accumulate valid hold time, close, and announce the outcome.

## 3. Device contract

The available device API has three capabilities:

| Capability | Meaning |
| --- | --- |
| `getTemperature()` | Returns the current real-time temperature. |
| `setTemperature(target)` | Causes the device to heat to and maintain the target. |
| `close()` | Closes the heater. A successful response means it is closed. |

Authentication, error payloads, retryability, temperature limits, and network timeout behavior are not yet specified. They belong to the device-adapter contract.

## 4. Temperature and timing semantics

- A reading is in range when `abs(current - target) <= 0.5°C`.
- The hold period begins on the first in-range reading.
- Hold duration means accumulated in-range time.
- When a later reading is out of range, the hold timer pauses.
- When temperature returns to range, the timer resumes from the accumulated value.
- Previously accumulated valid time is not reset.
- Polling cadence and measurement timestamp semantics must be explicit and testable.

## 5. Completion semantics

Normal completion requires all of the following:

1. The configured hold duration has been accumulated in range.
2. `close()` succeeds.
3. The workflow records the terminal state.
4. A completion event is delivered to the agent.
5. The agent announces that the task is complete.

The system must not report `COMPLETED` before `close()` succeeds.

External push, SMS, email, or a separate notification product is out of scope. The completion event remains inside the agent experience. If a voice connection is temporarily absent, the agent-owned conversation may retain the event for its next available delivery opportunity, but no external proactive-delivery guarantee is required.

## 6. Concurrency

- The agent may continue answering questions or invoking unrelated tools while heating runs.
- A physical heater may have at most one active heating task.
- Duplicate user requests and retrying clients must not create duplicate device side effects.

## 7. Proposed lifecycle

```text
AWAITING_CONFIRMATION
  -> STARTING
  -> HEATING
  -> HOLDING
  -> CLOSING
  -> COMPLETED
  -> NOTIFIED
```

Alternative terminal states:

- `CANCELLED`: cancellation requested and close succeeded;
- `FAILED`: workflow failed and safe shutdown was confirmed;
- `NEEDS_ATTENTION`: close did not succeed or shutdown cannot be confirmed.

`HOLDING` contains an in-range/range-paused condition, or equivalent explicit timing state, so accumulated time is deterministic and observable.

## 8. Agent-facing tools

```text
start_heating(target_temperature_c, hold_duration_s, device_id?) -> task_id
get_heating_status(task_id) -> task status
cancel_heating(task_id) -> cancellation accepted
```

The LLM must not receive credentials or raw, arbitrary device endpoints.

## 9. MVP acceptance criteria

1. A valid confirmed request returns a task ID without blocking the conversation.
2. The simulated device heats toward the target and exposes real-time temperature.
3. Timing does not start before the first in-range reading.
4. Timing pauses outside ±0.5°C and resumes without resetting accumulated valid time.
5. Completion closes the heater before the agent announces success.
6. Cancellation after heating may have started still attempts close.
7. A close failure produces a visible non-success state and an agent alert.
8. Restart or recovery does not silently lose task state or skip required shutdown.
9. The same heater rejects or serializes a second active task.
10. Tests run deterministically without real waiting or real hardware.

## 10. Non-blocking configuration decisions

These do not block architecture analysis and should not be hard-coded into domain logic:

- supported temperature range per device;
- maximum hold duration;
- heat-up timeout;
- polling cadence;
- retry budgets and backoff;
- device API authentication and error mapping.
