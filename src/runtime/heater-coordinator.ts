import * as restate from "@restatedev/restate-sdk";

type CoordinatorState = {
  activeTaskId: string;
};

export const heaterCoordinator = restate.object({
  name: "HeaterCoordinator",
  handlers: {
    claim: async (
      ctx: restate.ObjectContext<CoordinatorState>,
      input: { taskId: string },
    ) => {
      const activeTaskId = await ctx.get("activeTaskId");
      if (activeTaskId !== null && activeTaskId !== input.taskId) {
        return { acquired: false };
      }

      ctx.set("activeTaskId", input.taskId);
      return { acquired: true };
    },

    release: async (
      ctx: restate.ObjectContext<CoordinatorState>,
      input: { taskId: string },
    ) => {
      const activeTaskId = await ctx.get("activeTaskId");
      if (activeTaskId !== input.taskId) {
        return { released: false };
      }

      ctx.clear("activeTaskId");
      return { released: true };
    },

    getReservation: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext<CoordinatorState>) => ({
        activeTaskId: await ctx.get("activeTaskId"),
      }),
    ),
  },
});
