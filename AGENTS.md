# Agent Instructions

## Current phase

This repository is in read-only requirements and architecture analysis. Do not implement application code until the user explicitly approves implementation.

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
3. Separate take-home MVP needs from production-hardening concerns.
4. Prefer the smallest stack that demonstrates durable orchestration, concurrency, testability, and safety boundaries.
5. Include a deterministic fake clock and simulated heater in the test strategy.
6. Treat device API details, limits, polling cadence, and retry budgets as configuration or adapter contracts unless confirmed otherwise.
7. Do not introduce infrastructure that cannot be run and reviewed easily by an external evaluator.

## Safety

- Never commit secrets or real device endpoints.
- Never claim physical shutdown before the `close` contract reports success.
- A close failure must remain visible as `NEEDS_ATTENTION` or an equivalent non-success state.
