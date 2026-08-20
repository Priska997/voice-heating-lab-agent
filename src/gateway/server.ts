import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import {
  acknowledgeAnnouncementSchema,
  cancelHeatingSchema,
  getHeatingStatusSchema,
  sessionIdSchema,
  startHeatingSchema,
  type CompletionEvent,
  type StartHeatingResult,
} from "../contracts/heating-tools.js";
import type { HeatingTask } from "../domain/heating-task.js";
import { RestateIngressClient, RestateIngressError } from "./restate-client.js";

const taskParamsSchema = z.object({ taskId: z.string().min(1) });
const sessionParamsSchema = z.object({ agentSessionId: z.string().min(1) });
const eventParamsSchema = z.object({
  agentSessionId: z.string().min(1),
  eventId: z.string().min(1),
});

export function buildGateway(restateIngressUrl: string): FastifyInstance {
  const app = Fastify({ logger: true });
  const restate = new RestateIngressClient(restateIngressUrl);

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/v1/agent/tools/start-heating", async (request, reply) => {
    const input = startHeatingSchema.parse(request.body);
    const result = await restate.invoke<typeof input, StartHeatingResult>("startHeating", input);
    return reply.code(result.accepted ? 202 : 409).send(result);
  });

  app.get("/v1/agent/tools/heating-status/:taskId", async (request) => {
    const input = getHeatingStatusSchema.parse(taskParamsSchema.parse(request.params));
    return await restate.invoke<typeof input, HeatingTask | null>("getHeatingStatus", input);
  });

  app.post("/v1/agent/tools/cancel-heating/:taskId", async (request) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const body = z
      .object({ requestedBy: z.string().min(1), reason: z.string().min(1).optional() })
      .parse(request.body);
    const input = cancelHeatingSchema.parse({ taskId, ...body });
    return await restate.invoke<typeof input, { accepted: boolean; status: string }>(
      "cancelHeating",
      input,
    );
  });

  app.get("/v1/agent/sessions/:agentSessionId/events", async (request) => {
    const input = sessionIdSchema.parse(sessionParamsSchema.parse(request.params));
    return await restate.invoke<typeof input, CompletionEvent[]>("getSessionEvents", input);
  });

  app.post(
    "/v1/agent/sessions/:agentSessionId/events/:eventId/acknowledge",
    async (request) => {
      const input = acknowledgeAnnouncementSchema.parse(eventParamsSchema.parse(request.params));
      return await restate.invoke<
        typeof input,
        { acknowledged: boolean; event: CompletionEvent | null }
      >("acknowledgeAnnouncement", input);
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        issues: error.issues,
      });
    }
    if (error instanceof RestateIngressError) {
      return reply.code(502).send({
        error: "WORKFLOW_RUNTIME_UNAVAILABLE",
        upstreamStatus: error.statusCode,
      });
    }

    app.log.error(error);
    return reply.code(500).send({ error: "INTERNAL_ERROR" });
  });

  return app;
}
