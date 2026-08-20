import * as restate from "@restatedev/restate-sdk";

import type { HeatingTask } from "../domain/heating-task.js";

type AcceptanceState = {
  task: HeatingTask;
};

/**
 * Immutable acceptance record keyed by taskId. It closes the short interval
 * between returning 202 and the workflow's first state write. Runtime state
 * remains owned by HeatingWorkflow once that state exists.
 */
export const heatingTaskAcceptance = restate.object({
  name: "HeatingTaskAcceptance",
  handlers: {
    initialize: async (
      ctx: restate.ObjectContext<AcceptanceState>,
      input: { task: HeatingTask },
    ) => {
      const existing = await ctx.get("task");
      if (existing !== null && existing.requestId !== input.task.requestId) {
        throw new restate.TerminalError("task acceptance key is already in use");
      }
      if (existing === null) {
        ctx.set("task", input.task);
      }
      return { initialized: existing === null };
    },

    get: restate.handlers.object.shared(async (ctx: restate.ObjectSharedContext<AcceptanceState>) => {
      return await ctx.get("task");
    }),
  },
});
