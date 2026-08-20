# Voice Heating Lab Agent

A voice-controlled laboratory assistant that delegates long-running heater control to a deterministic, durable background workflow.

## Status

Requirements and architecture discovery. No application code has been selected or implemented yet.

## Product goal

A laboratory user whose hands are occupied can say a target temperature and hold duration. The agent confirms the side effect, starts an asynchronous heating task, remains available for other work, and announces completion only after the heater is closed.

Example:

> Heat to 80°C and hold for 20 minutes.

## Confirmed behavior

- The device exposes `getTemperature`, `setTemperature`, and `close`.
- `getTemperature` returns the current real-time temperature.
- `setTemperature(target)` makes the heater heat to and maintain the target.
- Target tolerance is ±0.5°C.
- Hold timing starts on the first reading inside the tolerance band.
- Time outside the tolerance band does not count. Timing pauses and resumes after the temperature returns; accumulated valid time is preserved.
- A successful `close` response means the device is closed.
- Completion is announced inside the agent experience. External push, SMS, and email are out of scope.
- One heater can have at most one active heating task. The agent may handle unrelated work concurrently.

## Proposed boundary

The LLM does not call raw device APIs or own timers. It invokes task-level tools:

- `start_heating(target_temperature_c, hold_duration_s, device_id)`
- `get_heating_status(task_id)`
- `cancel_heating(task_id)`

A deterministic workflow owns device locking, temperature polling, accumulated in-range time, cancellation, retries, shutdown, persistence, and the final completion event.

## Documentation

- [Product contract](docs/product-contract.md)
- [Architecture decisions](docs/architecture-decisions.md)

## Repository policy

- This repository is public. Never commit credentials, device addresses, private datasets, or personal information.
- Do not integrate a real heater during architecture discovery. Use a deterministic simulator first.
- No license has been selected yet.
