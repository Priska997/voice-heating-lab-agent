# ADR 0001: Use a Thin Agent over a Deterministic Workflow

- Status: Accepted
- Date: 2026-08-21

## Context

The product must accept a natural-language heating request while the user's hands are occupied. Heating and holding may last minutes or hours, and the Agent must remain available for unrelated work.

An LLM Agent is good at language understanding, clarification, and conversational output. It is not an appropriate clock, device mutex, or source of truth for physical shutdown.

## Decision

Use one thin conversational Agent with task-level tools:

- `start_heating`
- `get_heating_status`
- `cancel_heating`
- internal session-event acknowledgement

The start tool returns after durable acceptance. A deterministic background workflow owns every physical and temporal rule.

The Agent provider is replaceable and is not required to run domain tests or the simulator.

## Why not no Agent

A form or text-only API can prove the control core, but it does not solve the user's hands-free interaction problem. The user-visible product needs a voice Agent even though implementation begins with the deterministic core.

## Why not a general or multi-agent harness in V1

The current command has one intent, three business parameters, and three task-level operations. Multiple agents would not create useful concurrency: the background workflow already frees the conversation immediately.

A general harness adds model routing, delegation, session policy, and tool-planning behavior without replacing the required device workflow. It also expands the probabilistic surface around a physical side effect.

DeepSeek Harness was evaluated specifically. It provides typed tools, plugins, sessions, background jobs, and subagents, but it is a developer-preview general Agent harness rather than a real-time voice or durable physical-workflow engine. Its default local background-job provider is process-local. Using the DeepSeek model through its function-calling API remains compatible with this design.

## Consequences

### Positive

- The Agent can continue other work after receiving `taskId`.
- Language-provider changes do not alter the safety-control loop.
- Core behavior is deterministic and keyless to test.
- Raw device APIs and credentials are never exposed to the model.
- Multi-agent can be added later at a higher orchestration level if distinct laboratory roles emerge.

### Negative

- The Agent provider must bridge completion events back into a live or resumed conversation.
- Confirmation integrity needs a trusted server-side adapter; a boolean Tool argument is insufficient in production.
- Voice-provider end-to-end behavior is not exercised by this keyless reference implementation.

## Revisit when

- there are independently authorized instrument specialists with separate tools and context;
- a provider-neutral Agent platform offers material operational value beyond one voice session;
- the product needs cross-experiment planning rather than a single delegated device task.
