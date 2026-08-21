import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const portOffset = process.pid % 1_000;
const composeEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `voice_heating_e2e_${process.pid}`,
  GATEWAY_HOST_PORT: String(32_000 + portOffset),
  RESTATE_INGRESS_HOST_PORT: String(34_000 + portOffset),
  RESTATE_ADMIN_HOST_PORT: String(36_000 + portOffset),
  POLL_INTERVAL_MS: "500",
  MAXIMUM_OBSERVATION_GAP_MS: "1000",
};
const gatewayUrl = `http://127.0.0.1:${composeEnvironment.GATEWAY_HOST_PORT}`;
const restateUrl = `http://127.0.0.1:${composeEnvironment.RESTATE_INGRESS_HOST_PORT}`;
const runId = randomUUID();

function compose(...arguments_) {
  return execFileSync("docker", ["compose", ...arguments_], {
    cwd: process.cwd(),
    env: composeEnvironment,
    encoding: "utf8",
    stdio: arguments_.includes("logs") ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

async function request(path, init = {}) {
  const response = await fetchWithTimeout(`${gatewayUrl}${path}`, {
    ...init,
    headers:
      init.body === undefined
        ? init.headers
        : { "content-type": "application/json", ...init.headers },
  });
  const bodyText = await response.text();
  return {
    status: response.status,
    body: bodyText === "" ? null : JSON.parse(bodyText),
  };
}

async function configureSimulator(deviceId, configuration) {
  const response = await fetchWithTimeout(`${restateUrl}/SimulatorAdmin/configure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, ...configuration }),
  });
  assert.equal(response.ok, true, await response.text());
}

async function assertInternalServiceIsPrivate(deviceId) {
  const response = await fetchWithTimeout(
    `${restateUrl}/HeaterDevice/${deviceId}/getTemperature`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "bypass-attempt" }),
    },
  );
  assert.equal(response.ok, false, "raw device handlers must reject public ingress calls");
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function startInput(name, deviceId, holdDurationS, targetTemperatureC = 30) {
  return {
    requestId: `${runId}-${name}`,
    agentSessionId: `${runId}-session`,
    deviceId,
    targetTemperatureC,
    holdDurationS,
    confirmation: {
      confirmedByUser: true,
      conversationTurnId: `${runId}-${name}-turn`,
      confirmedAt: new Date().toISOString(),
    },
  };
}

async function start(input) {
  return await request("/v1/agent/tools/start-heating", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function taskStatus(taskId) {
  const response = await request(`/v1/agent/tools/heating-status/${taskId}`);
  assert.equal(response.status, 200);
  return response.body;
}

async function pendingEvents(agentSessionId) {
  const response = await request(`/v1/agent/sessions/${agentSessionId}/events`);
  assert.equal(response.status, 200);
  return response.body;
}

async function waitForPendingEvent(agentSessionId, taskId, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matchingEvents = (await pendingEvents(agentSessionId)).filter(
      (event) => event.taskId === taskId,
    );
    if (matchingEvents.length > 0) {
      assert.equal(matchingEvents.length, 1, "a task must publish exactly one pending event");
      return matchingEvents[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for completion event for task ${taskId}`);
}

async function waitForTask(taskId, predicate, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await taskStatus(taskId);
    if (task !== null && predicate(task)) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for task ${taskId}`);
}

async function waitForGateway() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await request("/health");
      if (response.status === 200) return;
    } catch {
      // The registration sidecar and gateway can still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("gateway did not become ready");
}

async function main() {
  compose("up", "--build", "-d");
  await waitForGateway();
  await assertInternalServiceIsPrivate(`${runId}-private-boundary`);

  const primaryInput = startInput("primary", `${runId}-heater-primary`, 4);
  const startedAt = performance.now();
  const primary = await start(primaryInput);
  const acceptanceMs = performance.now() - startedAt;
  assert.equal(primary.status, 202);
  assert.equal(primary.body.accepted, true);
  assert.ok(acceptanceMs < 2_000, `start blocked for ${acceptanceMs}ms`);

  const immediate = await taskStatus(primary.body.taskId);
  assert.notEqual(immediate, null, "an accepted task must be immediately queryable");

  const missingStatus = await request(`/v1/agent/tools/heating-status/${randomUUID()}`);
  assert.equal(missingStatus.status, 404);
  assert.equal(missingStatus.body.error, "TASK_NOT_FOUND");

  const missingCancellation = await request(
    `/v1/agent/tools/cancel-heating/${randomUUID()}`,
    {
      method: "POST",
      body: JSON.stringify({ requestedBy: "e2e-agent", reason: "UNKNOWN_TASK" }),
    },
  );
  assert.equal(missingCancellation.status, 404);
  assert.equal(missingCancellation.body.status, "NOT_FOUND");

  const retry = await start(primaryInput);
  assert.equal(retry.status, 202);
  assert.equal(retry.body.taskId, primary.body.taskId);

  const conflict = await start({ ...primaryInput, targetTemperatureC: 31 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.reason, "IDEMPOTENCY_CONFLICT");

  const busy = await start(startInput("busy", primaryInput.deviceId, 2));
  assert.equal(busy.status, 409);
  assert.equal(busy.body.reason, "DEVICE_BUSY");

  const parallelInput = startInput("parallel", `${runId}-heater-parallel`, 60, 20);
  const parallel = await start(parallelInput);
  assert.equal(parallel.status, 202, "a different device must run concurrently");
  const cancelled = await request(`/v1/agent/tools/cancel-heating/${parallel.body.taskId}`, {
    method: "POST",
    body: JSON.stringify({ requestedBy: "e2e-agent", reason: "E2E_IMMEDIATE_CANCEL" }),
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.accepted, true);
  const repeatedCancellation = await request(
    `/v1/agent/tools/cancel-heating/${parallel.body.taskId}`,
    {
      method: "POST",
      body: JSON.stringify({ requestedBy: "e2e-agent", reason: "E2E_IMMEDIATE_CANCEL" }),
    },
  );
  assert.equal(repeatedCancellation.status, 200);
  assert.equal(repeatedCancellation.body.accepted, true);
  await waitForTask(parallel.body.taskId, (task) => task.status === "CANCELLED");

  await waitForTask(primary.body.taskId, (task) => task.status === "COMPLETED");
  const primaryEvent = await waitForPendingEvent(
    primaryInput.agentSessionId,
    primary.body.taskId,
  );
  const acknowledgement = await request(
    `/v1/agent/sessions/${primaryInput.agentSessionId}/events/${primaryEvent.eventId}/acknowledge`,
    { method: "POST" },
  );
  assert.equal(acknowledgement.status, 200, JSON.stringify(acknowledgement.body));
  assert.equal(acknowledgement.body.acknowledged, true);
  await waitForTask(primary.body.taskId, (task) => task.status === "NOTIFIED");
  assert.equal(
    (await pendingEvents(primaryInput.agentSessionId)).some(
      (event) => event.taskId === primary.body.taskId,
    ),
    false,
    "acknowledged events must not be replayed as pending",
  );

  const failingDevice = `${runId}-heater-close-failure`;
  await configureSimulator(failingDevice, { closeShouldFail: true });
  const failing = await start(startInput("close-failure", failingDevice, 1, 20));
  assert.equal(failing.status, 202);
  await waitForTask(failing.body.taskId, (task) => task.status === "NEEDS_ATTENTION");
  const retainedLock = await start(startInput("after-close-failure", failingDevice, 1, 20));
  assert.equal(retainedLock.status, 409);
  assert.equal(retainedLock.body.reason, "DEVICE_BUSY");

  const restartInput = startInput("restart", `${runId}-heater-restart`, 4, 20);
  const restartTask = await start(restartInput);
  assert.equal(restartTask.status, 202);
  const beforeRestart = await waitForTask(
    restartTask.body.taskId,
    (task) => task.status === "HOLDING" && task.lastObservation !== null,
  );
  // Use an abrupt kill: `compose stop` waits for its graceful timeout, which
  // can let a short hold finish before the container actually stops on CI.
  compose("kill", "-s", "SIGKILL", "runtime");
  const restartDowntimeMs = 1_500;
  await new Promise((resolve) => setTimeout(resolve, restartDowntimeMs));
  compose("start", "runtime");
  const runtimeRestartedAtMs = Date.now();
  const afterRestart = await waitForTask(
    restartTask.body.taskId,
    (task) =>
      task.status === "HOLDING" &&
      task.lastObservation?.observedAtMs >= runtimeRestartedAtMs,
    30_000,
  );
  assert.ok(
    afterRestart.lastObservation.observedAtMs - beforeRestart.lastObservation.observedAtMs >
      Number(composeEnvironment.MAXIMUM_OBSERVATION_GAP_MS),
    "the restart must create an observation gap larger than the creditable threshold",
  );
  assert.ok(
    afterRestart.accumulatedInRangeMs - beforeRestart.accumulatedInRangeMs < restartDowntimeMs,
    "runtime downtime must not be credited as in-range hold time",
  );
  await waitForTask(restartTask.body.taskId, (task) => task.status === "COMPLETED", 30_000);
  await waitForPendingEvent(restartInput.agentSessionId, restartTask.body.taskId);

  process.stdout.write(
    "E2E passed: private service boundary, async acceptance, not-found semantics, idempotency, locking, idempotent cancellation, close failure, restart-gap safety, durable task projection, and pending delivery.\n",
  );
}

try {
  await main();
} catch (error) {
  try {
    compose("logs", "--no-color");
  } catch {
    // Preserve the original test failure.
  }
  throw error;
} finally {
  try {
    compose("down", "--volumes", "--remove-orphans");
  } catch {
    // Compose startup may have failed before creating resources.
  }
}
