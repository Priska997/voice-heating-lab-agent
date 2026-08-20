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
  HeatingTaskAcceptanceApi,
  HeatingWorkflowApi,
  HeatingWorkflowInput,
  WorkflowInvokerApi,
} from "./api.js";
import { heatingWorkflow } from "./heating-workflow.js";

type HeatingRequestState = {
  result: StartHeatingResult;
  input: StartHeatingInput;
};

export const workflowInvoker = restate.service({
  name: "WorkflowInvoker",
  handlers: {
    invoke: async (ctx: restate.Context, input: HeatingWorkflowInput) => {
      await ctx.workflowClient(heatingWorkflow, input.taskId).run(input);
    },
  },
});

export const heatingRequest = restate.object({
  name: "HeatingRequest",
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
        .objectClient<HeatingTaskAcceptanceApi>({ name: "HeatingTaskAcceptance" }, taskId)
        .initialize({ task: acceptedTask });

      const accepted: StartHeatingResult = {
        accepted: true,
        taskId,
        requestId: input.requestId,
      };
      ctx.set("result", accepted);
      ctx.set("input", input);

      ctx.serviceSendClient<WorkflowInvokerApi>({ name: "WorkflowInvoker" }).invoke({
        ...input,
        taskId,
        acceptedAtMs,
        pollIntervalMs: runtimeConfig.pollIntervalMs,
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
        const runtimeTask = await ctx
          .workflowClient<HeatingWorkflowApi>({ name: "HeatingWorkflow" }, input.taskId)
          .getStatus();
        if (runtimeTask !== null) {
          return runtimeTask;
        }
        return await ctx
          .objectClient<HeatingTaskAcceptanceApi>({ name: "HeatingTaskAcceptance" }, input.taskId)
          .get();
      },
    ),

    cancelHeating: restate.createServiceHandler(
      { input: restate.serde.schema(cancelHeatingSchema) },
      async (ctx: restate.Context, input) => {
        return await ctx
          .workflowClient<HeatingWorkflowApi>({ name: "HeatingWorkflow" }, input.taskId)
          .cancel({ requestedBy: input.requestedBy, reason: input.reason });
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
