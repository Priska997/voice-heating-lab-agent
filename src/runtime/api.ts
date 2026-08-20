import type { CompletionEvent, StartHeatingInput, StartHeatingResult } from "../contracts/heating-tools.js";
import type { HeatingTask } from "../domain/heating-task.js";

export interface HeatingWorkflowInput extends StartHeatingInput {
  taskId: string;
  acceptedAtMs: number;
  pollIntervalMs: number;
  heatUpTimeoutMs: number;
}

export interface CancellationRequest {
  requestedBy: string;
  reason: string;
}

export interface HeatingWorkflowApi {
  run(context: unknown, input: HeatingWorkflowInput): Promise<HeatingTask>;
  getStatus(context: unknown): Promise<HeatingTask | null>;
  cancel(
    context: unknown,
    input: CancellationRequest,
  ): Promise<{ accepted: boolean; status: HeatingTask["status"] }>;
  acknowledgeAnnouncement(
    context: unknown,
    input: { eventId: string },
  ): Promise<{ accepted: boolean }>;
}

export interface HeaterCoordinatorApi {
  claim(context: unknown, input: { taskId: string }): Promise<{ acquired: boolean }>;
  release(context: unknown, input: { taskId: string }): Promise<{ released: boolean }>;
  getReservation(context: unknown): Promise<{ activeTaskId: string | null }>;
}

export interface HeaterDeviceApi {
  setTemperature(
    context: unknown,
    input: { taskId: string; targetTemperatureC: number },
  ): Promise<{ accepted: boolean; reason?: string }>;
  getTemperature(
    context: unknown,
    input: { taskId: string },
  ): Promise<{ ok: boolean; temperatureC?: number; observedAtMs?: number; reason?: string }>;
  close(
    context: unknown,
    input: { taskId: string },
  ): Promise<{ closed: boolean; reason?: string }>;
  configureSimulator(
    context: unknown,
    input: {
      currentTemperatureC?: number;
      heatRateCPerSecond?: number;
      coolRateCPerSecond?: number;
      closeShouldFail?: boolean;
    },
  ): Promise<void>;
}

export interface AgentInboxApi {
  publish(context: unknown, event: CompletionEvent): Promise<void>;
  list(context: unknown): Promise<CompletionEvent[]>;
  acknowledge(
    context: unknown,
    input: { eventId: string },
  ): Promise<{ acknowledged: boolean; event: CompletionEvent | null }>;
}

export interface HeatingRequestApi {
  start(context: unknown, input: StartHeatingInput): Promise<StartHeatingResult>;
}

export interface HeatingTaskAcceptanceApi {
  initialize(context: unknown, input: { task: HeatingTask }): Promise<{ initialized: boolean }>;
  get(context: unknown): Promise<HeatingTask | null>;
}

export interface WorkflowInvokerApi {
  invoke(context: unknown, input: HeatingWorkflowInput): Promise<void>;
}
