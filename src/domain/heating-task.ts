export const DEFAULT_TOLERANCE_C = 0.5;

export type HeatingStatus =
  | "STARTING"
  | "HEATING"
  | "HOLDING"
  | "CLOSING"
  | "COMPLETED"
  | "NOTIFIED"
  | "CANCELLED"
  | "FAILED"
  | "NEEDS_ATTENTION";

export type HoldCondition =
  | "NOT_STARTED"
  | "IN_RANGE"
  | "PAUSED_OUT_OF_RANGE"
  | "PAUSED_STALE_OBSERVATION"
  | "SATISFIED";

export type CloseIntent = "NORMAL_COMPLETION" | "CANCELLATION" | "FAILURE";

export interface TemperatureObservation {
  temperatureC: number;
  observedAtMs: number;
  inRange: boolean;
}

export interface HeatingTask {
  taskId: string;
  requestId: string;
  deviceId: string;
  agentSessionId: string;
  targetTemperatureC: number;
  holdDurationMs: number;
  toleranceC: number;
  status: HeatingStatus;
  holdCondition: HoldCondition;
  accumulatedInRangeMs: number;
  startedAtMs: number;
  firstInRangeAtMs: number | null;
  lastObservation: TemperatureObservation | null;
  closeIntent: CloseIntent | null;
  closedAtMs: number | null;
  notifiedAtMs: number | null;
  terminalReason: string | null;
}

export interface CreateHeatingTaskInput {
  taskId: string;
  requestId: string;
  deviceId: string;
  agentSessionId: string;
  targetTemperatureC: number;
  holdDurationMs: number;
  startedAtMs: number;
  toleranceC?: number;
}

export class InvalidTemperatureObservationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidTemperatureObservationError";
  }
}

export function createHeatingTask(input: CreateHeatingTaskInput): HeatingTask {
  assertFinite("targetTemperatureC", input.targetTemperatureC);
  assertSafeDuration("holdDurationMs", input.holdDurationMs);
  assertFinite("startedAtMs", input.startedAtMs);

  const toleranceC = input.toleranceC ?? DEFAULT_TOLERANCE_C;
  assertPositive("toleranceC", toleranceC);

  return {
    taskId: input.taskId,
    requestId: input.requestId,
    deviceId: input.deviceId,
    agentSessionId: input.agentSessionId,
    targetTemperatureC: input.targetTemperatureC,
    holdDurationMs: input.holdDurationMs,
    toleranceC,
    status: "STARTING",
    holdCondition: "NOT_STARTED",
    accumulatedInRangeMs: 0,
    startedAtMs: input.startedAtMs,
    firstInRangeAtMs: null,
    lastObservation: null,
    closeIntent: null,
    closedAtMs: null,
    notifiedAtMs: null,
    terminalReason: null,
  };
}

export function markHeatingStarted(task: HeatingTask): HeatingTask {
  assertStatus(task, ["STARTING"]);
  return { ...task, status: "HEATING" };
}

/**
 * Counts an interval only when both its bounding observations are in range.
 * This conservative rule never credits the interval that discovers a departure
 * or a return. The maximum timing uncertainty is therefore the polling cadence.
 */
export function observeTemperature(
  task: HeatingTask,
  temperatureC: number,
  observedAtMs: number,
  maximumCreditableGapMs = Number.POSITIVE_INFINITY,
): HeatingTask {
  assertStatus(task, ["HEATING", "HOLDING"]);
  assertValidObservationNumber("temperatureC", temperatureC);
  assertValidObservationNumber("observedAtMs", observedAtMs);

  if (observedAtMs < task.startedAtMs) {
    throw new InvalidTemperatureObservationError(
      "temperature observations cannot predate the task",
    );
  }

  const previous = task.lastObservation;
  if (previous !== null && observedAtMs <= previous.observedAtMs) {
    throw new InvalidTemperatureObservationError(
      "temperature observations must have strictly increasing timestamps",
    );
  }
  if (
    maximumCreditableGapMs !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(maximumCreditableGapMs) || maximumCreditableGapMs <= 0)
  ) {
    throw new InvalidTemperatureObservationError(
      "maximumCreditableGapMs must be positive and finite",
    );
  }

  const inRange = Math.abs(temperatureC - task.targetTemperatureC) <= task.toleranceC;
  const observation: TemperatureObservation = { temperatureC, observedAtMs, inRange };
  let accumulatedInRangeMs = task.accumulatedInRangeMs;
  const observationGapMs = previous === null ? 0 : observedAtMs - previous.observedAtMs;
  const staleObservationGap = observationGapMs > maximumCreditableGapMs;

  if (previous?.inRange === true && inRange && !staleObservationGap) {
    accumulatedInRangeMs = Math.min(
      task.holdDurationMs,
      accumulatedInRangeMs + observedAtMs - previous.observedAtMs,
    );
  }

  const firstInRangeAtMs = task.firstInRangeAtMs ?? (inRange ? observedAtMs : null);
  const satisfied = accumulatedInRangeMs >= task.holdDurationMs;

  if (satisfied) {
    return {
      ...task,
      status: "CLOSING",
      holdCondition: "SATISFIED",
      accumulatedInRangeMs,
      firstInRangeAtMs,
      lastObservation: observation,
      closeIntent: "NORMAL_COMPLETION",
    };
  }

  if (firstInRangeAtMs === null) {
    return {
      ...task,
      status: "HEATING",
      holdCondition: "NOT_STARTED",
      accumulatedInRangeMs,
      lastObservation: observation,
    };
  }

  return {
    ...task,
    status: "HOLDING",
    holdCondition: !inRange
      ? "PAUSED_OUT_OF_RANGE"
      : staleObservationGap
        ? "PAUSED_STALE_OBSERVATION"
        : "IN_RANGE",
    accumulatedInRangeMs,
    firstInRangeAtMs,
    lastObservation: observation,
  };
}

export function observeTemperatureOrRequestShutdown(
  task: HeatingTask,
  temperatureC: number,
  observedAtMs: number,
  maximumCreditableGapMs = Number.POSITIVE_INFINITY,
): HeatingTask {
  try {
    return observeTemperature(task, temperatureC, observedAtMs, maximumCreditableGapMs);
  } catch (error) {
    if (!(error instanceof InvalidTemperatureObservationError)) {
      throw error;
    }
    return requestFailureShutdown(task, "INVALID_TEMPERATURE_OBSERVATION");
  }
}

export function hasHeatUpTimedOut(
  task: HeatingTask,
  observedAtMs: number,
  heatUpTimeoutMs: number,
): boolean {
  return (
    task.firstInRangeAtMs === null &&
    observedAtMs - task.startedAtMs >= heatUpTimeoutMs
  );
}

export function requestCancellation(task: HeatingTask, reason = "USER_REQUESTED"): HeatingTask {
  assertStatus(task, ["STARTING", "HEATING", "HOLDING"]);
  return {
    ...task,
    status: "CLOSING",
    closeIntent: "CANCELLATION",
    terminalReason: reason,
  };
}

/**
 * Resolves the narrow race between the final qualifying observation and an
 * already-accepted cancellation. The serialized task record decides whether
 * cancellation was accepted before the workflow sealed the close decision.
 */
export function applyAcceptedCancellationBeforeClose(
  task: HeatingTask,
  reason = "USER_REQUESTED",
): HeatingTask {
  assertStatus(task, ["CLOSING"]);
  if (task.closeIntent !== "NORMAL_COMPLETION") {
    return task;
  }
  return {
    ...task,
    closeIntent: "CANCELLATION",
    terminalReason: reason,
  };
}

export function requestFailureShutdown(task: HeatingTask, reason: string): HeatingTask {
  assertStatus(task, ["STARTING", "HEATING", "HOLDING"]);
  return {
    ...task,
    status: "CLOSING",
    closeIntent: "FAILURE",
    terminalReason: reason,
  };
}

export function recordCloseSucceeded(task: HeatingTask, closedAtMs: number): HeatingTask {
  assertStatus(task, ["CLOSING"]);
  assertFinite("closedAtMs", closedAtMs);

  switch (task.closeIntent) {
    case "NORMAL_COMPLETION":
      return { ...task, status: "COMPLETED", closedAtMs };
    case "CANCELLATION":
      return { ...task, status: "CANCELLED", closedAtMs };
    case "FAILURE":
      return { ...task, status: "FAILED", closedAtMs };
    case null:
      throw new Error("close intent must be recorded before closing");
  }
}

export function recordCloseFailed(task: HeatingTask, reason: string): HeatingTask {
  assertStatus(task, ["CLOSING"]);
  return {
    ...task,
    status: "NEEDS_ATTENTION",
    terminalReason: reason,
  };
}

export function recordAnnouncement(task: HeatingTask, notifiedAtMs: number): HeatingTask {
  assertStatus(task, ["COMPLETED"]);
  assertFinite("notifiedAtMs", notifiedAtMs);
  return { ...task, status: "NOTIFIED", notifiedAtMs };
}

export function remainingHoldMs(task: HeatingTask): number {
  return Math.max(0, task.holdDurationMs - task.accumulatedInRangeMs);
}

function assertStatus(task: HeatingTask, allowed: HeatingStatus[]): void {
  if (!allowed.includes(task.status)) {
    throw new Error(`cannot apply transition from ${task.status}`);
  }
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
}

function assertSafeDuration(name: string, value: number): void {
  assertPositive(name, value);
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${name} must not exceed Number.MAX_SAFE_INTEGER`);
  }
}

function assertValidObservationNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new InvalidTemperatureObservationError(`${name} must be finite`);
  }
}
