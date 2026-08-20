import { z } from "zod";

export const MAX_REPRESENTABLE_HOLD_DURATION_S = Number.MAX_SAFE_INTEGER / 1_000;

export const confirmationReceiptSchema = z.object({
  confirmedByUser: z.literal(true),
  conversationTurnId: z.string().min(1),
  confirmedAt: z.iso.datetime(),
});

export const startHeatingSchema = z.object({
  requestId: z.string().min(1),
  agentSessionId: z.string().min(1),
  deviceId: z.string().min(1),
  targetTemperatureC: z.number().finite(),
  holdDurationS: z
    .number()
    .positive()
    .finite()
    .max(MAX_REPRESENTABLE_HOLD_DURATION_S, "duration cannot be represented safely in milliseconds"),
  confirmation: confirmationReceiptSchema,
});

export type StartHeatingInput = z.infer<typeof startHeatingSchema>;

export const startHeatingResultSchema = z.discriminatedUnion("accepted", [
  z.object({
    accepted: z.literal(true),
    taskId: z.string(),
    requestId: z.string(),
  }),
  z.object({
    accepted: z.literal(false),
    reason: z.enum(["DEVICE_BUSY", "IDEMPOTENCY_CONFLICT"]),
  }),
]);

export type StartHeatingResult = z.infer<typeof startHeatingResultSchema>;

export function isSameStartHeatingRequest(
  first: StartHeatingInput,
  second: StartHeatingInput,
): boolean {
  return (
    first.requestId === second.requestId &&
    first.agentSessionId === second.agentSessionId &&
    first.deviceId === second.deviceId &&
    first.targetTemperatureC === second.targetTemperatureC &&
    first.holdDurationS === second.holdDurationS &&
    first.confirmation.confirmedByUser === second.confirmation.confirmedByUser &&
    first.confirmation.conversationTurnId === second.confirmation.conversationTurnId &&
    first.confirmation.confirmedAt === second.confirmation.confirmedAt
  );
}

export const getHeatingStatusSchema = z.object({
  taskId: z.string().min(1),
});

export const cancelHeatingSchema = z.object({
  taskId: z.string().min(1),
  requestedBy: z.string().min(1),
  reason: z.string().min(1).default("USER_REQUESTED"),
});

export const sessionIdSchema = z.object({
  agentSessionId: z.string().min(1),
});

export const acknowledgeAnnouncementSchema = z.object({
  agentSessionId: z.string().min(1),
  eventId: z.string().min(1),
});

export interface CompletionEvent {
  eventId: string;
  taskId: string;
  agentSessionId: string;
  deviceId: string;
  kind: "HEATING_COMPLETED" | "HEATING_CANCELLED" | "HEATING_ALERT";
  message: string;
  createdAtMs: number;
  acknowledgedAtMs: number | null;
}
