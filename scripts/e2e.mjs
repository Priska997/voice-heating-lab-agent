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

async function invokeDevice(deviceId, handler, body) {
  const response = await fetchWithTimeout(`${restateUrl}/HeaterDevice/${deviceId}/${handler}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, await response.text());
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

  const primaryInput = startInput("primary", `${runId}-heater-primary`, 4);
  const startedAt = performance.now();
  const primary = await start(primaryInput);
  const acceptanceMs = performance.now() - startedAt;
  assert.equal(primary.status, 202);
  assert.equal(primary.body.accepted, true);
  assert.ok(acceptanceMs < 2_000, `start blocked for ${acceptanceMs}ms`);

  const immediate = await taskStatus(primary.body.taskId);
  assert.notEqual(immediate, null, "an accepted task must be immediately queryable");

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
  await waitForTask(parallel.body.taskId, (task) => task.status === "CANCELLED");

  await waitForTask(primary.body.taskId, (task) => task.status === "COMPLETED");
  const eventsResponse = await request(
    `/v1/agent/sessions/${primaryInput.agentSessionId}/events`,
  );
  const primaryEvents = eventsResponse.body.filter((event) => event.taskId === primary.body.taskId);
  assert.equal(primaryEvents.length, 1);
  const acknowledgement = await request(
    `/v1/agent/sessions/${primaryInput.agentSessionId}/events/${primaryEvents[0].eventId}/acknowledge`,
    { method: "POST" },
  );
  assert.equal(acknowledgement.status, 200, JSON.stringify(acknowledgement.body));
  assert.equal(acknowledgement.body.acknowledged, true);
  await waitForTask(primary.body.taskId, (task) => task.status === "NOTIFIED");

  const failingDevice = `${runId}-heater-close-failure`;
  await invokeDevice(failingDevice, "configureSimulator", { closeShouldFail: true });
  const failing = await start(startInput("close-failure", failingDevice, 1, 20));
  assert.equal(failing.status, 202);
  await waitForTask(failing.body.taskId, (task) => task.status === "NEEDS_ATTENTION");
  const retainedLock = await start(startInput("after-close-failure", failingDevice, 1, 20));
  assert.equal(retainedLock.status, 409);
  assert.equal(retainedLock.body.reason, "DEVICE_BUSY");

  const restartInput = startInput("restart", `${runId}-heater-restart`, 4, 20);
  const restartTask = await start(restartInput);
  assert.equal(restartTask.status, 202);
  await waitForTask(restartTask.body.taskId, (task) => task.status === "HOLDING");
  compose("restart", "runtime");
  await waitForTask(restartTask.body.taskId, (task) => task.status === "COMPLETED", 30_000);
  const restartEvents = await request(
    `/v1/agent/sessions/${restartInput.agentSessionId}/events`,
  );
  assert.equal(
    restartEvents.body.filter((event) => event.taskId === restartTask.body.taskId).length,
    1,
  );

  process.stdout.write(
    "E2E passed: async acceptance, idempotency, locking, cancellation, close failure, restart, and single delivery.\n",
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
    compose("down", "--remove-orphans");
  } catch {
    // Compose startup may have failed before creating resources.
  }
}
