# Production Readiness Boundary

The repository proves architecture and domain behavior with a deterministic simulator. It is not ready to control a real laboratory heater until the following concerns are resolved.

## Required before real hardware

### Device contract

- exact HTTP/serial/vendor protocol and authentication;
- supported temperature range and precision per device;
- command and read timeouts;
- documented idempotency of repeated set and close operations;
- a readable target/mode/closed state for ambiguous-response recovery;
- vendor error mapping and retry budget;
- emergency stop and manual override behavior.

### Identity and authorization

- authenticated human and Agent runtime identities;
- tenant-scoped device registry;
- authorization for start, cancel, status, and operator recovery;
- server-issued confirmation receipts bound to user, device, target, and duration;
- protection against one tenant learning another tenant's task or device state.

### Operational safety

- device-specific temperature and duration limits;
- heat-up timeout and maximum unattended duration;
- stale sensor and implausible-value detection;
- documented response when the process, network, or device loses power;
- physical validation with a non-hazardous test fixture;
- formal hazard analysis appropriate to the actual chemistry and jurisdiction.

### Reliability

- Restate high-availability topology or an accepted single-node risk;
- durable-volume backup and restore test;
- clock synchronization between runtime, Restate, and devices;
- workflow deployment/version retention while long tasks are sleeping;
- migration strategy for tasks started by old workflow code;
- load and soak tests across the expected number of devices.

### Observability and operations

- structured audit records for proposal, confirmation, start, readings, transitions, close, and announcement;
- metrics for heat-up time, paused hold time, read failures, close failures, and queue latency;
- alerting for `NEEDS_ATTENTION` and stale active tasks;
- operator runbook and protected recovery endpoint;
- retention and privacy policy for voice transcripts and laboratory metadata.

## Voice Agent integration

The first provider adapter should implement:

1. voice activity detection and transcription;
2. extraction of temperature, duration, and safe device identity;
3. clarification when any value is missing or ambiguous;
4. an explicit, audible confirmation turn;
5. server-side creation of a confirmation receipt;
6. task-level Tool calls only;
7. background event consumption while normal conversation continues;
8. acknowledgement only after the completion/alert audio is played.

OpenAI Realtime can provide speech-to-speech interaction and function calling, but it remains an adapter. A DeepSeek-based implementation would additionally need STT, TTS, and a voice transport. Neither provider should contain the heating state machine.

## Scaling path

The current key model already permits independent devices to run concurrently. Scaling work is primarily operational:

- horizontally scale stateless gateway and runtime endpoints;
- keep device consistency keyed by `deviceId`;
- separate query/reporting projections if workflow-state queries become insufficient;
- add rate limits per user, tenant, and device class;
- introduce multi-agent orchestration only for independently authorized laboratory roles, not for background timing.

## Exit criteria for a hardware pilot

A limited pilot should not begin until all of these are true:

- the real adapter passes the same contract tests as the simulator;
- ambiguous `setTemperature` and `close` outcomes have tested recovery behavior;
- authorization and tenant isolation tests pass;
- crash/restart and network-partition tests preserve task and lock state;
- `NEEDS_ATTENTION` triggers an operational alert and runbook;
- a human safety owner approves limits and emergency procedures.
