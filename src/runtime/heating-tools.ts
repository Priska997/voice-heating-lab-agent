import * as restate from "@restatedev/restate-sdk";

import {
  acknowledgeAnnouncementSchema,
  cancelHeatingSchema,
  getHeatingStatusSchema,
  isSameStartHeatingRequest,
  sessionIdSchema,
  startHeatingSchema,
  type StartHeatingInput,
  type StartHeatingResult,
} from "../contracts/heating-tools.js";
import { runtimeConfig } from "../config.js";
import { createHeatingTask } from "../domain/heating-task.js";
import type {
  AgentInboxApi,
  HeaterCoordinatorApi,
  HeatingRequestApi,
  HeatingTaskRecordApi,
  HeatingWorkflowApi,
} from "./api.js";
import { heatingWorkflow } from "./heating-workflow.js";

type HeatingRequestState = {
  result: StartHeatingResult;
  input: StartHeatingInput;
};

export const heatingRequest = restate.object({
  name: "HeatingRequest",
  options: { ingressPrivate: true },
  handlers: {
    start: async (
      ctx: restate.ObjectContext<HeatingRequestState>,
      unparsedInput: StartHeatingInput,
    ): Promise<StartHeatingResult> => {
      const input = startHeatingSchema.parse(unparsedInput);
      if (ctx.key !== input.requestId) {
        throw new restate.TerminalError("request ID does not match idempotency key", {
          errorCode: 400,
        });
      }

      const previous = await ctx.get("result");
      if (previous !== null) {
        const previousInput = await ctx.get("input");
        if (previousInput !== null && !isSameStartHeatingRequest(previousInput, input)) {
          return { accepted: false, reason: "IDEMPOTENCY_CONFLICT" };
        }
        return previous;
      }

      const taskId = ctx.rand.uuidv4();
      const reservation = await ctx
        .objectClient<HeaterCoordinatorApi>({ name: "HeaterCoordinator" }, input.deviceId)
        .claim({ taskId });

      if (!reservation.acquired) {
        const busy: StartHeatingResult = { accepted: false, reason: "DEVICE_BUSY" };
        ctx.set("result", busy);
        ctx.set("input", input);
        return busy;
      }

      const acceptedAtMs = await ctx.date.now();
      const acceptedTask = createHeatingTask({
        taskId,
        requestId: input.requestId,
        deviceId: input.deviceId,
        agentSessionId: input.agentSessionId,
        targetTemperatureC: input.targetTemperatureC,
        holdDurationMs: input.holdDurationS * 1_000,
        startedAtMs: acceptedAtMs,
      });
      await ctx
        .objectClient<HeatingTaskRecordApi>({ name: "HeatingTaskRecord" }, taskId)
        .initialize({ task: acceptedTask });

      const accepted: StartHeatingResult = {
        accepted: true,
        taskId,
        requestId: input.requestId,
      };
      ctx.set("result", accepted);
      ctx.set("input", input);

      ctx.workflowSendClient(heatingWorkflow, taskId).run({
        ...input,
        taskId,
        acceptedAtMs,
        pollIntervalMs: runtimeConfig.pollIntervalMs,
        maximumObservationGapMs: runtimeConfig.maximumObservationGapMs,
        heatUpTimeoutMs: runtimeConfig.heatUpTimeoutMs,
      });

      return accepted;
    },
  },
});

export const heatingTools = restate.service({
  name: "HeatingTools",
  handlers: {
    startHeating: restate.createServiceHandler(
      { input: restate.serde.schema(startHeatingSchema) },
      async (ctx: restate.Context, input) => {
        return await ctx
          .objectClient<HeatingRequestApi>({ name: "HeatingRequest" }, input.requestId)
          .start(input);
      },
    ),

    getHeatingStatus: restate.createServiceHandler(
      { input: restate.serde.schema(getHeatingStatusSchema) },
      async (ctx: restate.Context, input) => {
        const acceptedTask = await ctx
          .objectClient<HeatingTaskRecordApi>({ name: "HeatingTaskRecord" }, input.taskId)
          .get();
        return acceptedTask;
      },
    ),

    cancelHeating: restate.createServiceHandler(
      { input: restate.serde.schema(cancelHeatingSchema) },
      async (ctx: restate.Context, input) => {
        const cancellation = { requestedBy: input.requestedBy, reason: input.reason };
        const result = await ctx
          .objectClient<HeatingTaskRecordApi>({ name: "HeatingTaskRecord" }, input.taskId)
          .requestCancellation(cancellation);
        if (result.shouldSignal) {
          await ctx
            .workflowClient<HeatingWorkflowApi>({ name: "HeatingWorkflow" }, input.taskId)
            .signalCancellation(cancellation);
        }
        return { accepted: result.accepted, status: result.status };
      },
    ),

    getSessionEvents: restate.createServiceHandler(
      { input: restate.serde.schema(sessionIdSchema) },
      async (ctx: restate.Context, input) => {
        return await ctx
          .objectClient<AgentInboxApi>({ name: "AgentInbox" }, input.agentSessionId)
          .list();
      },
    ),

    acknowledgeAnnouncement: restate.createServiceHandler(
      { input: restate.serde.schema(acknowledgeAnnouncementSchema) },
      async (ctx: restate.Context, input) => {
        return await ctx
          .objectClient<AgentInboxApi>({ name: "AgentInbox" }, input.agentSessionId)
          .acknowledge({ eventId: input.eventId });
      },
    ),
  },
});
