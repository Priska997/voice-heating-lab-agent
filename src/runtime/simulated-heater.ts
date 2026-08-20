import * as restate from "@restatedev/restate-sdk";

export interface SimulatorState {
  currentTemperatureC: number;
  targetTemperatureC: number | null;
  activeTaskId: string | null;
  closed: boolean;
  lastUpdatedAtMs: number;
  ambientTemperatureC: number;
  heatRateCPerSecond: number;
  coolRateCPerSecond: number;
  closeShouldFail: boolean;
}

const DEFAULT_STATE: Omit<SimulatorState, "lastUpdatedAtMs"> = {
  currentTemperatureC: 20,
  targetTemperatureC: null,
  activeTaskId: null,
  closed: true,
  ambientTemperatureC: 20,
  heatRateCPerSecond: 5,
  coolRateCPerSecond: 0.25,
  closeShouldFail: false,
};

export const heaterDevice = restate.object({
  name: "HeaterDevice",
  handlers: {
    setTemperature: async (
      ctx: restate.ObjectContext<SimulatorState>,
      input: { taskId: string; targetTemperatureC: number },
    ) => {
      if (!Number.isFinite(input.targetTemperatureC)) {
        return { accepted: false, reason: "INVALID_TARGET" };
      }

      const now = await ctx.date.now();
      const state = await loadAndEvolve(ctx, now);
      if (state.activeTaskId !== null && state.activeTaskId !== input.taskId) {
        return { accepted: false, reason: "DEVICE_OWNED_BY_ANOTHER_TASK" };
      }

      save(ctx, {
        ...state,
        activeTaskId: input.taskId,
        targetTemperatureC: input.targetTemperatureC,
        closed: false,
      });
      return { accepted: true };
    },

    getTemperature: async (
      ctx: restate.ObjectContext<SimulatorState>,
      input: { taskId: string },
    ) => {
      const now = await ctx.date.now();
      const state = await loadAndEvolve(ctx, now);
      save(ctx, state);

      if (state.activeTaskId !== input.taskId) {
        return { ok: false, reason: "TASK_DOES_NOT_OWN_DEVICE" };
      }

      return {
        ok: true,
        temperatureC: state.currentTemperatureC,
        observedAtMs: now,
      };
    },

    close: async (
      ctx: restate.ObjectContext<SimulatorState>,
      input: { taskId: string },
    ) => {
      const now = await ctx.date.now();
      const state = await loadAndEvolve(ctx, now);

      if (state.activeTaskId !== input.taskId) {
        return { closed: false, reason: "TASK_DOES_NOT_OWN_DEVICE" };
      }
      if (state.closeShouldFail) {
        save(ctx, state);
        return { closed: false, reason: "SIMULATED_CLOSE_FAILURE" };
      }

      save(ctx, {
        ...state,
        activeTaskId: null,
        targetTemperatureC: null,
        closed: true,
      });
      return { closed: true };
    },

    configureSimulator: async (
      ctx: restate.ObjectContext<SimulatorState>,
      input: {
        currentTemperatureC?: number;
        heatRateCPerSecond?: number;
        coolRateCPerSecond?: number;
        closeShouldFail?: boolean;
      },
    ) => {
      const now = await ctx.date.now();
      const state = await loadAndEvolve(ctx, now);
      save(ctx, {
        ...state,
        ...(input.currentTemperatureC === undefined
          ? {}
          : { currentTemperatureC: input.currentTemperatureC }),
        ...(input.heatRateCPerSecond === undefined
          ? {}
          : { heatRateCPerSecond: input.heatRateCPerSecond }),
        ...(input.coolRateCPerSecond === undefined
          ? {}
          : { coolRateCPerSecond: input.coolRateCPerSecond }),
        ...(input.closeShouldFail === undefined
          ? {}
          : { closeShouldFail: input.closeShouldFail }),
      });
    },
  },
});

async function loadAndEvolve(
  ctx: restate.ObjectContext<SimulatorState>,
  now: number,
): Promise<SimulatorState> {
  const state: SimulatorState = {
    currentTemperatureC: (await ctx.get("currentTemperatureC")) ?? DEFAULT_STATE.currentTemperatureC,
    targetTemperatureC: (await ctx.get("targetTemperatureC")) ?? null,
    activeTaskId: (await ctx.get("activeTaskId")) ?? null,
    closed: (await ctx.get("closed")) ?? DEFAULT_STATE.closed,
    lastUpdatedAtMs: (await ctx.get("lastUpdatedAtMs")) ?? now,
    ambientTemperatureC:
      (await ctx.get("ambientTemperatureC")) ?? DEFAULT_STATE.ambientTemperatureC,
    heatRateCPerSecond: (await ctx.get("heatRateCPerSecond")) ?? DEFAULT_STATE.heatRateCPerSecond,
    coolRateCPerSecond: (await ctx.get("coolRateCPerSecond")) ?? DEFAULT_STATE.coolRateCPerSecond,
    closeShouldFail: (await ctx.get("closeShouldFail")) ?? DEFAULT_STATE.closeShouldFail,
  };

  const elapsedSeconds = Math.max(0, now - state.lastUpdatedAtMs) / 1_000;
  const destination =
    state.closed || state.targetTemperatureC === null
      ? state.ambientTemperatureC
      : state.targetTemperatureC;
  const rate = state.closed ? state.coolRateCPerSecond : state.heatRateCPerSecond;
  const maximumChange = rate * elapsedSeconds;
  const difference = destination - state.currentTemperatureC;
  const change = Math.sign(difference) * Math.min(Math.abs(difference), maximumChange);

  return {
    ...state,
    currentTemperatureC: round(state.currentTemperatureC + change),
    lastUpdatedAtMs: now,
  };
}

function save(ctx: restate.ObjectContext<SimulatorState>, state: SimulatorState): void {
  for (const [key, value] of Object.entries(state) as [keyof SimulatorState, SimulatorState[keyof SimulatorState]][]) {
    ctx.set(key, value);
  }
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
