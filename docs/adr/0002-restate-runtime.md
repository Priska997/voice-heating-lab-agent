# ADR 0002: Use Restate for the Reference Durable Runtime

- Status: Accepted for reference implementation
- Date: 2026-08-21

## Context

The heating lifecycle needs durable timers, restart recovery, per-device exclusivity, signals, queryable state, and a background invocation that outlives the Agent turn. The repository must remain understandable and runnable by an external reviewer.

## Options considered

### PostgreSQL plus an application-owned worker

This is familiar and makes state visible in SQL, but the application would need to implement leases, fencing, due-task scans, timer recovery, retry journals, cancellation signaling, and an outbox. That code would be infrastructure rather than product policy.

### Temporal

Temporal has the strongest maturity and testing ecosystem for long-running workflows. It introduces more deployment and review concepts than this single-device lifecycle needs: server, worker, activities, workflow sandbox, versioning, and separate device-lock design.

### DBOS plus PostgreSQL

DBOS provides lightweight durable workflows and durable sleep. It is a credible fallback, especially when PostgreSQL is already required. Restate's keyed Virtual Object maps the physical-device mutex and session inbox more directly for this reference.

### Restate

Restate provides:

- Workflow instances keyed by `taskId`;
- Virtual Objects with single-writer state keyed by `deviceId`, `requestId`, and `agentSessionId`;
- durable service sends, timers, promises, state, and replay;
- a single local server with an inspection UI;
- TypeScript support matching the Agent Gateway contracts.

## Decision

Pin Node.js 22, Restate Server 1.7.2, and TypeScript SDK 1.16.4. Use a persistent `/restate-data` Docker volume and a fixed node name for local restart recovery.

The source-of-truth mapping is:

- `HeatingRequest(requestId)`: idempotent acceptance and confirmation audit;
- `HeatingTaskRecord(taskId)`: durable query projection and serialized cancellation gate;
- `HeaterCoordinator(deviceId)`: device reservation;
- `HeatingWorkflow(taskId)`: execution and timing journal;
- `AgentInbox(agentSessionId)`: in-Agent completion events.

## Consequences

### Positive

- The code expresses the business lifecycle rather than rebuilding a scheduler.
- The consistency key of each business entity is visible in the service model.
- Different devices run concurrently while each device remains serialized.
- Process restarts do not silently discard timers or task state.
- The runtime is inspectable through the local Restate UI.

### Negative

- Restate is less familiar to many reviewers than PostgreSQL.
- The Restate server uses the Business Source License; legal review is required for a commercial deployment.
- Long sleeps require keeping the compatible workflow deployment revision available.
- Restate durability does not make unknown physical HTTP outcomes exactly-once.

## Guardrails

- Pin server and SDK versions; do not use `latest` in the reference stack.
- Do not enable preview protocol features for this MVP.
- Keep the pure timing reducer independent of Restate.
- Keep the Fastify gateway contract independent of Restate ingress paths.
- Mark every internal service `ingressPrivate`; expose only task-level tools.
- Treat real device calls as uncertain external side effects and implement read-back verification.

## Revisit when

- an organization-standard Temporal or DBOS platform already exists;
- license requirements prohibit the Restate server;
- reporting/search requirements justify a separate PostgreSQL projection;
- workflows span days and deployment-version retention becomes operationally costly.
