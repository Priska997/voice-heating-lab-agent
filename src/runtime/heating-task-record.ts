import * as restate from "@restatedev/restate-sdk";

import { recordAnnouncement, type HeatingTask } from "../domain/heating-task.js";
import type { CancellationRequest } from "./api.js";

type TaskRecordState = {
  task: HeatingTask;
  cancellation: CancellationRequest;
  cancellationSealed: boolean;
  completionEventId: string;
};

const CANCELLABLE_STATUSES: HeatingTask["status"][] = ["STARTING", "HEATING", "HOLDING"];

/**
 * Durable task projection and command arbiter keyed by taskId.
 *
 * HeatingWorkflow remains the execution owner. This object keeps terminal
 * status queryable beyond workflow retention and serializes cancellation
 * against the workflow's final close decision.
 */
export const heatingTaskRecord = restate.object({
  name: "HeatingTaskRecord",
  options: { ingressPrivate: true },
  handlers: {
    initialize: async (
      ctx: restate.ObjectContext<TaskRecordState>,
      input: { task: HeatingTask },
    ) => {
      const existing = await ctx.get("task");
      if (existing !== null && !sameIdentity(existing, input.task)) {
        throw new restate.TerminalError("task record key is already in use");
      }
      if (existing === null) {
        ctx.set("task", input.task);
      }
      return { initialized: existing === null };
    },

    update: async (
      ctx: restate.ObjectContext<TaskRecordState>,
      input: { task: HeatingTask },
    ) => {
      const existing = await ctx.get("task");
      if (existing === null || !sameIdentity(existing, input.task)) {
        throw new restate.TerminalError("cannot update an unknown or different task record");
      }
      ctx.set("task", input.task);
    },

    get: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext<TaskRecordState>) => await ctx.get("task"),
    ),

    getCancellation: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext<TaskRecordState>) =>
        await ctx.get("cancellation"),
    ),

    requestCancellation: async (
      ctx: restate.ObjectContext<TaskRecordState>,
      input: CancellationRequest,
    ) => {
      const task = await ctx.get("task");
      if (task === null) {
        return { accepted: false, status: "NOT_FOUND" as const, shouldSignal: false };
      }
      const existing = await ctx.get("cancellation");
      if (existing !== null) {
        return { accepted: true, status: task.status, shouldSignal: false };
      }
      if (
        (await ctx.get("cancellationSealed")) === true ||
        !CANCELLABLE_STATUSES.includes(task.status)
      ) {
        return { accepted: false, status: task.status, shouldSignal: false };
      }

      ctx.set("cancellation", input);
      return { accepted: true, status: task.status, shouldSignal: true };
    },

    sealCancellation: async (ctx: restate.ObjectContext<TaskRecordState>) => {
      ctx.set("cancellationSealed", true);
      return { cancellation: await ctx.get("cancellation") };
    },

    recordCompletionEvent: async (
      ctx: restate.ObjectContext<TaskRecordState>,
      input: { eventId: string },
    ) => {
      const existing = await ctx.get("completionEventId");
      if (existing !== null && existing !== input.eventId) {
        throw new restate.TerminalError("task already has a different completion event");
      }
      if (existing === null) {
        ctx.set("completionEventId", input.eventId);
      }
    },

    acknowledgeAnnouncement: async (
      ctx: restate.ObjectContext<TaskRecordState>,
      input: { eventId: string; notifiedAtMs: number },
    ) => {
      const task = await ctx.get("task");
      const completionEventId = await ctx.get("completionEventId");
      if (task?.status === "NOTIFIED" && completionEventId === input.eventId) {
        return { accepted: true };
      }
      if (task === null || task.status !== "COMPLETED" || completionEventId !== input.eventId) {
        return { accepted: false };
      }

      ctx.set("task", recordAnnouncement(task, input.notifiedAtMs));
      return { accepted: true };
    },
  },
});

function sameIdentity(first: HeatingTask, second: HeatingTask): boolean {
  return (
    first.taskId === second.taskId &&
    first.requestId === second.requestId &&
    first.deviceId === second.deviceId &&
    first.agentSessionId === second.agentSessionId
  );
}
