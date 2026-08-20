import { describe, expect, it } from "vitest";

import {
  isSameStartHeatingRequest,
  startHeatingSchema,
} from "../../src/contracts/heating-tools.js";

const validRequest = {
  requestId: "request-1",
  agentSessionId: "session-1",
  deviceId: "heater-1",
  targetTemperatureC: 80,
  holdDurationS: 1_200,
  confirmation: {
    confirmedByUser: true,
    conversationTurnId: "turn-1",
    confirmedAt: "2026-08-21T00:00:00Z",
  },
} as const;

describe("start heating contract", () => {
  it("accepts a complete confirmed task-level command", () => {
    expect(startHeatingSchema.parse(validRequest)).toEqual(validRequest);
  });

  it("rejects a side effect without explicit confirmation", () => {
    expect(() =>
      startHeatingSchema.parse({
        ...validRequest,
        confirmation: { ...validRequest.confirmation, confirmedByUser: false },
      }),
    ).toThrow();
  });

  it("rejects missing or non-positive duration", () => {
    expect(() => startHeatingSchema.parse({ ...validRequest, holdDurationS: 0 })).toThrow();
  });

  it("rejects a duration that would overflow when converted to milliseconds", () => {
    expect(() =>
      startHeatingSchema.parse({ ...validRequest, holdDurationS: Number.MAX_VALUE }),
    ).toThrow("represented safely in milliseconds");
  });

  it("does not hard-code device-specific temperature limits", () => {
    expect(
      startHeatingSchema.parse({ ...validRequest, targetTemperatureC: -20 }).targetTemperatureC,
    ).toBe(-20);
  });

  it("distinguishes a true retry from request ID reuse with changed parameters", () => {
    const parsed = startHeatingSchema.parse(validRequest);

    expect(isSameStartHeatingRequest(parsed, { ...parsed })).toBe(true);
    expect(
      isSameStartHeatingRequest(parsed, { ...parsed, targetTemperatureC: 81 }),
    ).toBe(false);
    expect(
      isSameStartHeatingRequest(parsed, {
        ...parsed,
        confirmation: { ...parsed.confirmation, conversationTurnId: "turn-2" },
      }),
    ).toBe(false);
  });
});
