import * as restate from "@restatedev/restate-sdk";

import type { CompletionEvent } from "../contracts/heating-tools.js";
import type { HeatingTaskRecordApi } from "./api.js";

type InboxState = {
  events: CompletionEvent[];
};

export const agentInbox = restate.object({
  name: "AgentInbox",
  options: { ingressPrivate: true },
  handlers: {
    publish: async (ctx: restate.ObjectContext<InboxState>, event: CompletionEvent) => {
      const events = (await ctx.get("events")) ?? [];
      if (!events.some((existing) => existing.eventId === event.eventId)) {
        ctx.set("events", [...events, event]);
      }
    },

    list: restate.handlers.object.shared(async (ctx: restate.ObjectSharedContext<InboxState>) => {
      const events = (await ctx.get("events")) ?? [];
      return events.filter((event) => event.acknowledgedAtMs === null);
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

      const notifiedAtMs = await ctx.date.now();
      const acknowledged: CompletionEvent = {
        ...existing,
        acknowledgedAtMs: notifiedAtMs,
      };

      if (acknowledged.kind === "HEATING_COMPLETED") {
        const result = await ctx
          .objectClient<HeatingTaskRecordApi>(
            { name: "HeatingTaskRecord" },
            acknowledged.taskId,
          )
          .acknowledgeAnnouncement({
            eventId: acknowledged.eventId,
            notifiedAtMs,
          });
        if (!result.accepted) {
          throw new restate.TerminalError("completion acknowledgement did not match its task");
        }
      }

      const updated = [...events];
      updated[index] = acknowledged;
      ctx.set("events", updated);

      return { acknowledged: true, event: acknowledged };
    },
  },
});
