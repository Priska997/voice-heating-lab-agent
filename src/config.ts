function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

const pollIntervalMs = positiveInteger("POLL_INTERVAL_MS", 1_000);
const maximumObservationGapMs = positiveInteger(
  "MAXIMUM_OBSERVATION_GAP_MS",
  pollIntervalMs * 3,
);

if (maximumObservationGapMs < pollIntervalMs) {
  throw new Error("MAXIMUM_OBSERVATION_GAP_MS must be at least POLL_INTERVAL_MS");
}

export const runtimeConfig = {
  restateEndpointPort: positiveInteger("RESTATE_ENDPOINT_PORT", 9080),
  pollIntervalMs,
  maximumObservationGapMs,
  heatUpTimeoutMs: positiveInteger("HEAT_UP_TIMEOUT_MS", 10 * 60 * 1_000),
};

export const gatewayConfig = {
  port: positiveInteger("GATEWAY_PORT", 3_000),
  restateIngressUrl: process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080",
};
