import * as restate from "@restatedev/restate-sdk";

import type { CompletionEvent } from "../contracts/heating-tools.js";
import type { HeatingWorkflowApi } from "./api.js";

type InboxState = {
  events: CompletionEvent[];
};

export const agentInbox = restate.object({
  name: "AgentInbox",
  handlers: {
    publish: async (ctx: restate.ObjectContext<InboxState>, event: CompletionEvent) => {
      const events = (await ctx.get("events")) ?? [];
      if (!events.some((existing) => existing.eventId === event.eventId)) {
        ctx.set("events", [...events, event]);
      }
    },

    list: restate.handlers.object.shared(async (ctx: restate.ObjectSharedContext<InboxState>) => {
      return (await ctx.get("events")) ?? [];
    }),

    acknowledge: async (
      ctx: restate.ObjectContext<InboxState>,
      input: { eventId: string },
    ) => {
      const events = (await ctx.get("events")) ?? [];
      const index = events.findIndex((event) => event.eventId === input.eventId);
      if (index < 0) {
        return { acknowledged: false, event: null };
      }

      const existing = events[index];
      if (existing === undefined) {
        return { acknowledged: false, event: null };
      }
      if (existing.acknowledgedAtMs !== null) {
        return { acknowledged: true, event: existing };
      }

      const acknowledged: CompletionEvent = {
        ...existing,
        acknowledgedAtMs: await ctx.date.now(),
      };
      const updated = [...events];
      updated[index] = acknowledged;
      ctx.set("events", updated);

      if (acknowledged.kind === "HEATING_COMPLETED") {
        await ctx
          .workflowClient<HeatingWorkflowApi>({ name: "HeatingWorkflow" }, acknowledged.taskId)
          .acknowledgeAnnouncement({ eventId: acknowledged.eventId });
      }

      return { acknowledged: true, event: acknowledged };
    },
  },
});
