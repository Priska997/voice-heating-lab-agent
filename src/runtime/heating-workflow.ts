import * as restate from "@restatedev/restate-sdk";

import type { CompletionEvent } from "../contracts/heating-tools.js";
import {
  applyAcceptedCancellationBeforeClose,
  createHeatingTask,
  hasHeatUpTimedOut,
  markHeatingStarted,
  observeTemperatureOrRequestShutdown,
  recordCloseFailed,
  recordCloseSucceeded,
  requestCancellation,
  requestFailureShutdown,
  type HeatingTask,
} from "../domain/heating-task.js";
import type {
  AgentInboxApi,
  CancellationRequest,
  HeaterCoordinatorApi,
  HeaterDeviceApi,
  HeatingTaskRecordApi,
  HeatingWorkflowInput,
} from "./api.js";

type WorkflowState = {
  task: HeatingTask;
};

const CANCELLATION_PROMISE = "cancellation-requested";

type LoopOutcome =
  | { kind: "POLL" }
  | { kind: "CANCEL"; request: CancellationRequest };

export const heatingWorkflow = restate.workflow({
  name: "HeatingWorkflow",
  options: { ingressPrivate: true },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<WorkflowState>,
      input: HeatingWorkflowInput,
    ): Promise<HeatingTask> => {
      const startedAtMs = input.acceptedAtMs;
      let task = createHeatingTask({
        taskId: ctx.key,
        requestId: input.requestId,
        deviceId: input.deviceId,
        agentSessionId: input.agentSessionId,
        targetTemperatureC: input.targetTemperatureC,
        holdDurationMs: input.holdDurationS * 1_000,
        startedAtMs,
      });
      await persistTask(ctx, task);

      const taskRecord = ctx.objectClient<HeatingTaskRecordApi>(
        { name: "HeatingTaskRecord" },
        task.taskId,
      );

      const cancellationSignal = ctx.promise<CancellationRequest>(CANCELLATION_PROMISE);
      const cancellationBeforeStart = await taskRecord.getCancellation();
      const device = ctx.objectClient<HeaterDeviceApi>(
        { name: "HeaterDevice" },
        input.deviceId,
      );

      if (cancellationBeforeStart !== null) {
        task = requestCancellation(task, cancellationBeforeStart.reason);
      } else {
        const setResult = await device.setTemperature({
          taskId: task.taskId,
          targetTemperatureC: task.targetTemperatureC,
        });

        if (setResult.accepted) {
          task = markHeatingStarted(task);
        } else {
          task = requestFailureShutdown(task, setResult.reason ?? "SET_TEMPERATURE_REJECTED");
        }
      }
      await persistTask(ctx, task);

      const cancellation = cancellationSignal.get();

      while (task.status === "HEATING" || task.status === "HOLDING") {
        const outcome = await restate.RestatePromise.race([
          ctx.sleep({ milliseconds: input.pollIntervalMs }).map((): LoopOutcome => ({ kind: "POLL" })),
          cancellation.map((request): LoopOutcome => {
            if (request === undefined) {
              throw new restate.TerminalError("cancellation signal had no payload");
            }
            return { kind: "CANCEL", request };
          }),
        ]);

        if (outcome.kind === "CANCEL") {
          task = requestCancellation(task, outcome.request.reason);
          await persistTask(ctx, task);
          break;
        }

        const reading = await device.getTemperature({ taskId: task.taskId });
        if (!reading.ok || reading.temperatureC === undefined || reading.observedAtMs === undefined) {
          task = requestFailureShutdown(task, reading.reason ?? "TEMPERATURE_READ_FAILED");
          await persistTask(ctx, task);
          break;
        }

        if (hasHeatUpTimedOut(task, reading.observedAtMs, input.heatUpTimeoutMs)) {
          task = requestFailureShutdown(task, "HEAT_UP_TIMEOUT");
          await persistTask(ctx, task);
          break;
        }

        task = observeTemperatureOrRequestShutdown(
          task,
          reading.temperatureC,
          reading.observedAtMs,
          input.maximumObservationGapMs,
        );
        await persistTask(ctx, task);
      }

      const cancellationDecision = await taskRecord.sealCancellation();
      if (cancellationDecision.cancellation !== null) {
        task = applyAcceptedCancellationBeforeClose(
          task,
          cancellationDecision.cancellation.reason,
        );
        await persistTask(ctx, task);
      }

      const closeResult = await device.close({ taskId: task.taskId });
      const closeObservedAtMs = await ctx.date.now();
      task = closeResult.closed
        ? recordCloseSucceeded(task, closeObservedAtMs)
        : recordCloseFailed(task, closeResult.reason ?? "CLOSE_UNCONFIRMED");
      await persistTask(ctx, task);

      if (closeResult.closed) {
        const release = await ctx
          .objectClient<HeaterCoordinatorApi>({ name: "HeaterCoordinator" }, task.deviceId)
          .release({ taskId: task.taskId });
        if (!release.released) {
          task = {
            ...task,
            status: "FAILED",
            terminalReason: "DEVICE_RESERVATION_RELEASE_FAILED",
          };
          await persistTask(ctx, task);
        }
      }

      const event = completionEvent(ctx, task, closeObservedAtMs);
      await taskRecord.recordCompletionEvent({ eventId: event.eventId });
      await ctx
        .objectClient<AgentInboxApi>({ name: "AgentInbox" }, task.agentSessionId)
        .publish(event);

      return task;
    },

    signalCancellation: async (
      ctx: restate.WorkflowSharedContext<WorkflowState>,
      input: CancellationRequest,
    ) => {
      const cancellation = ctx.promise<CancellationRequest>(CANCELLATION_PROMISE);
      if ((await cancellation.peek()) === undefined) {
        await cancellation.resolve(input);
      }
    },
  },
});

async function persistTask(
  ctx: restate.WorkflowContext<WorkflowState>,
  task: HeatingTask,
): Promise<void> {
  ctx.set("task", task);
  await ctx
    .objectClient<HeatingTaskRecordApi>({ name: "HeatingTaskRecord" }, task.taskId)
    .update({ task });
}

function completionEvent(
  ctx: restate.WorkflowContext<WorkflowState>,
  task: HeatingTask,
  createdAtMs: number,
): CompletionEvent {
  const details = {
    eventId: ctx.rand.uuidv4(),
    taskId: task.taskId,
    agentSessionId: task.agentSessionId,
    deviceId: task.deviceId,
    createdAtMs,
    acknowledgedAtMs: null,
  };

  switch (task.status) {
    case "COMPLETED":
      return {
        ...details,
        kind: "HEATING_COMPLETED",
        message: `Heating task ${task.taskId} completed and heater ${task.deviceId} is closed.`,
      };
    case "CANCELLED":
      return {
        ...details,
        kind: "HEATING_CANCELLED",
        message: `Heating task ${task.taskId} was cancelled and heater ${task.deviceId} is closed.`,
      };
    case "FAILED":
      return {
        ...details,
        kind: "HEATING_ALERT",
        message: `Heating task ${task.taskId} failed safely: ${task.terminalReason ?? "unknown reason"}.`,
      };
    case "NEEDS_ATTENTION":
      return {
        ...details,
        kind: "HEATING_ALERT",
        message: `Heating task ${task.taskId} needs attention: ${task.terminalReason ?? "safe state is uncertain"}.`,
      };
    default:
      throw new Error(`cannot publish a completion event for ${task.status}`);
  }
}
