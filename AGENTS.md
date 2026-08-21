# Agent Instructions

## Current phase

The user approved implementation on 2026-08-21. The repository is an architecture reference implementation: preserve the deterministic core and explicit boundaries before adding presentation features.

## Facts to preserve

- The agent parses, clarifies, confirms, delegates, and announces.
- The LLM must not directly own the temperature-control state machine.
- The heater workflow is asynchronous and must not block the agent from other work.
- Temperature tolerance is ±0.5°C.
- Hold time is accumulated only while the temperature is in range; leaving the range pauses timing and returning resumes it.
- A successful `close` response means the heater is closed.
- The agent announces completion only after `close` succeeds.
- No external push channel is required.
- One active heating task per physical heater.

## Analysis expectations

When proposing a technical stack:

1. Start from the product contract in `docs/product-contract.md`.
2. Compare at least two credible implementation options.
3. Separate the current runnable scope from production-hardening concerns.
4. Prefer the smallest stack that demonstrates durable orchestration, concurrency, testability, and safety boundaries.
5. Include a deterministic fake clock and simulated heater in the test strategy.
6. Treat device API details, limits, polling cadence, and retry budgets as configuration or adapter contracts unless confirmed otherwise.
7. Do not introduce infrastructure that cannot be run and maintained easily by a new developer.

## Implementation constraints

- Keep the Voice Agent provider replaceable. Agent SDK types must not leak into domain or workflow code.
- Public Agent tools operate on task-level commands; never expose raw heater methods to an LLM.
- Changes to timing or terminal-state semantics require deterministic unit tests.
- `HeatingRequest` owns request idempotency, `HeatingTaskRecord` owns the durable query projection and cancel/complete arbitration, `HeaterCoordinator` owns device exclusivity, `HeatingWorkflow` owns execution, and `AgentInbox` owns in-agent delivery.
- A device stays reserved after `NEEDS_ATTENTION`; only an explicit operator recovery flow may release it.
- Do not describe an inbox acknowledgement as proof of audible playback unless the Agent provider sends it after playback completes.

## Safety

- Never commit secrets or real device endpoints.
- Never claim physical shutdown before the `close` contract reports success.
- A close failure must remain visible as `NEEDS_ATTENTION` or an equivalent non-success state.
