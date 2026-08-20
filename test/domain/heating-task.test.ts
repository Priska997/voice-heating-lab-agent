import { describe, expect, it } from "vitest";

import {
  createHeatingTask,
  hasHeatUpTimedOut,
  InvalidTemperatureObservationError,
  markHeatingStarted,
  observeTemperature,
  observeTemperatureOrRequestShutdown,
  recordAnnouncement,
  recordCloseFailed,
  recordCloseSucceeded,
  requestCancellation,
  requestFailureShutdown,
} from "../../src/domain/heating-task.js";

function startedTask(holdDurationMs = 10_000) {
  return markHeatingStarted(
    createHeatingTask({
      taskId: "task-1",
      requestId: "request-1",
      deviceId: "heater-1",
      agentSessionId: "session-1",
      targetTemperatureC: 80,
      holdDurationMs,
      startedAtMs: 0,
    }),
  );
}

describe("heating task state machine", () => {
  it("does not start the hold before the first in-range reading", () => {
    const task = observeTemperature(startedTask(), 79.49, 1_000);

    expect(task.status).toBe("HEATING");
    expect(task.holdCondition).toBe("NOT_STARTED");
    expect(task.accumulatedInRangeMs).toBe(0);
    expect(task.firstInRangeAtMs).toBeNull();
  });

  it("treats both tolerance boundaries as in range", () => {
    const lower = observeTemperature(startedTask(), 79.5, 1_000);
    const upper = observeTemperature(startedTask(), 80.5, 1_000);

    expect(lower.holdCondition).toBe("IN_RANGE");
    expect(upper.holdCondition).toBe("IN_RANGE");
  });

  it("counts only intervals bounded by two in-range observations", () => {
    let task = observeTemperature(startedTask(), 80, 1_000);
    task = observeTemperature(task, 80.1, 4_000);

    expect(task.accumulatedInRangeMs).toBe(3_000);

    task = observeTemperature(task, 81, 6_000);
    expect(task.holdCondition).toBe("PAUSED_OUT_OF_RANGE");
    expect(task.accumulatedInRangeMs).toBe(3_000);

    task = observeTemperature(task, 80, 8_000);
    expect(task.holdCondition).toBe("IN_RANGE");
    expect(task.accumulatedInRangeMs).toBe(3_000);

    task = observeTemperature(task, 79.8, 10_000);
    expect(task.accumulatedInRangeMs).toBe(5_000);
  });

  it("clamps accumulated time and requests close when the hold is satisfied", () => {
    let task = observeTemperature(startedTask(5_000), 80, 1_000);
    task = observeTemperature(task, 80, 7_000);

    expect(task.status).toBe("CLOSING");
    expect(task.holdCondition).toBe("SATISFIED");
    expect(task.accumulatedInRangeMs).toBe(5_000);
    expect(task.closeIntent).toBe("NORMAL_COMPLETION");
  });

  it("does not report completion until close succeeds", () => {
    let task = observeTemperature(startedTask(1_000), 80, 1_000);
    task = observeTemperature(task, 80, 2_000);

    expect(task.status).toBe("CLOSING");

    task = recordCloseSucceeded(task, 2_100);
    expect(task.status).toBe("COMPLETED");
    expect(task.closedAtMs).toBe(2_100);

    task = recordAnnouncement(task, 2_200);
    expect(task.status).toBe("NOTIFIED");
  });

  it("classifies cancellation only after safe close", () => {
    let task = requestCancellation(startedTask());
    expect(task.status).toBe("CLOSING");

    task = recordCloseSucceeded(task, 500);
    expect(task.status).toBe("CANCELLED");
  });

  it("classifies a safely closed workflow failure separately from unsafe shutdown", () => {
    const closing = requestFailureShutdown(startedTask(), "HEAT_UP_TIMEOUT");

    expect(recordCloseSucceeded(closing, 1_000).status).toBe("FAILED");
    expect(recordCloseFailed(closing, "CLOSE_UNCONFIRMED").status).toBe("NEEDS_ATTENTION");
  });

  it("rejects non-monotonic device timestamps", () => {
    const task = observeTemperature(startedTask(), 80, 1_000);

    expect(() => observeTemperature(task, 80, 1_000)).toThrow(
      "strictly increasing timestamps",
    );
  });

  it("classifies non-finite readings as invalid observations", () => {
    expect(() => observeTemperature(startedTask(), Number.NaN, 1_000)).toThrow(
      InvalidTemperatureObservationError,
    );
  });

  it("turns an invalid observation into a failure shutdown request", () => {
    const task = observeTemperatureOrRequestShutdown(startedTask(), Number.NaN, 1_000);

    expect(task.status).toBe("CLOSING");
    expect(task.closeIntent).toBe("FAILURE");
    expect(task.terminalReason).toBe("INVALID_TEMPERATURE_OBSERVATION");
  });

  it("rejects a first in-range observation at or after the heat-up deadline", () => {
    const task = startedTask();

    expect(hasHeatUpTimedOut(task, 9_999, 10_000)).toBe(false);
    expect(hasHeatUpTimedOut(task, 10_000, 10_000)).toBe(true);
    expect(hasHeatUpTimedOut(task, 10_001, 10_000)).toBe(true);
  });
});
