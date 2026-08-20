# Prior Art and Reuse Assessment

Reviewed on 2026-08-21. The goal was to reuse mature boundaries without mistaking an Agent framework or device SDK for the complete safety workflow.

## Finding

No reviewed project provides the whole contract: real-time voice clarification, explicit confirmation, durable per-device ownership, conservative ±0.5°C accumulated hold time, restart recovery, confirmed close, and in-Agent completion acknowledgement.

The system is therefore composed from reusable layers while keeping the small domain state machine application-owned.

## Voice and Agent runtimes

| Option | Reusable capability | Why it is not the heating source of truth |
| --- | --- | --- |
| [OpenAI Agents SDK for TypeScript](https://github.com/openai/openai-agents-js) | Realtime voice sessions, typed tools, guardrails and tracing; the [voice guide](https://openai.github.io/openai-agents-js/guides/voice-agents/build/) documents browser WebRTC and tool execution | Voice sessions are not durable physical workflows; the provider is also unavailable in this keyless repository |
| [LiveKit Agents](https://github.com/livekit/agents) | Provider-neutral voice pipelines, rooms and SIP integration | Stronger communications platform, but more deployment surface and no device-state durability |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Typed tools, plugins, sessions, approvals and background jobs | General developer-preview harness; its local jobs are process-local and it does not supply a real-time audio transport or durable heater workflow |
| [Home Assistant Assist](https://developers.home-assistant.io/docs/voice/pipelines/) | Wake/STT/intent/TTS pipeline and entity-oriented tool exposure | Adopting it would turn the deliverable into a Home Assistant integration, while accumulated hold timing and close semantics remain custom |

Decision: keep a thin provider adapter above a stable task-level API. OpenAI Realtime, LiveKit, or a DeepSeek-based STT/LLM/TTS stack can be added without changing the workflow.

## Durable execution

| Option | Fit | Decision |
| --- | --- | --- |
| [Restate](https://docs.restate.dev/foundations/services) | Keyed Virtual Objects map directly to device, request and session consistency boundaries; workflows provide durable state, signals and [timers](https://docs.restate.dev/develop/ts/durable-timers) | Selected for the reviewable reference; server BSL implications are disclosed in ADR 0002 |
| [Temporal](https://github.com/temporalio/temporal) | Most mature long-running workflow and testing ecosystem | Credible production alternative, but requires more service and lock concepts for this take-home scope |
| PostgreSQL plus a job worker | Familiar storage and operational ownership | Would require application code for leases, fencing, timers, signals, recovery and outbox semantics |

Decision: Restate removes scheduler plumbing while leaving the temperature reducer independent and portable.

## Laboratory device abstractions

| Option | Reusable capability | Adoption condition |
| --- | --- | --- |
| [PyLabRobot](https://github.com/PyLabRobot/pylabrobot) | Temperature-controller abstractions such as set/get/deactivate and multi-vendor laboratory integrations | Use when the real heater is supported or multi-vendor expansion justifies a Python adapter service |
| [Opentrons Temperature Module](https://docs.opentrons.com/python-api/modules/temperature-module/) | Clear current/target/status/deactivate semantics and simulation patterns | Use directly only for Opentrons hardware; otherwise treat its contract as prior art |
| [SiLA 2 Python](https://sila2.gitlab.io/sila_python/) | Standardized laboratory device communication and code generation | Consider when a broader instrument estate requires the standard; current Python package is maintenance-only |

Decision: retain the narrow `HeaterDevice` boundary (`setTemperature`, `getTemperature`, `close`). The simulator implements it now; the real adapter is selected only after the device protocol is known.

## What remains intentionally custom

- explicit confirmation receipt and request-level idempotency conflict;
- per-device active-task policy;
- inclusive ±0.5°C range rule;
- conservative two-bounding-readings timing policy;
- pause and resume without losing accumulated valid time;
- close-confirmed completion and `NEEDS_ATTENTION` isolation;
- Agent-session delivery acknowledgement.

These are product semantics, not generic framework features, so keeping them in a pure, tested reducer makes the boundary reviewable and replaceable.
