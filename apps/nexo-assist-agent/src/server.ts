import Fastify, { type FastifyError } from "fastify";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ZodError, z } from "zod";
import { loadEnvironment } from "@nexo-assist/config";
import {
  checkDatabaseConnection,
  closeDatabaseConnection,
} from "@nexo-assist/database";
import {
  agentAuthConfig,
  AuthenticationError,
  getAnalystId,
  getEmployeeId,
  registerEmployeeAuthentication,
} from "./auth.js";
import {
  AgentRequestConflictError,
  AgentUpstreamError,
  ConfirmationRequiredError,
  ConversationNotActiveError,
  ConversationNotFoundError,
  ConversationService,
  MessageLimitReachedError,
} from "./services/conversation-service.js";
import {
  HandoffAccessError,
  HandoffNotFoundError,
  HandoffService,
  InvalidHandoffTransitionError,
} from "./services/handoff-service.js";
import { mastra, mastraStorage } from "./mastra/index.js";
import {
  closeKnowledgeVectorStore,
  initializeKnowledgeVectorIndex,
} from "./services/knowledge-rag.js";

type ReadinessCheck = () => Promise<void>;
type ServerOptions = {
  conversationService?: ConversationService;
  auth?: { secret: string; issuer: string; audience: string };
  closeDependencies?: boolean;
};

const routeParamsSchema = z.object({
  conversationId: z.string().uuid(),
});
const draftParamsSchema = routeParamsSchema.extend({
  draftId: z.string().uuid(),
});
const messageBodySchema = z.object({
  content: z.string().trim().min(1).max(10_000),
});
const idempotencyKeySchema = z.string().trim().min(8).max(128);
const confirmationBodySchema = z.object({
  confirmation: z.literal("confirm"),
});
const handoffParamsSchema = z.object({
  handoffId: z.string().uuid(),
});
const handoffReasonSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
const analystMessageSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
});
const errorSchema = {
  type: "object",
  additionalProperties: true,
} as const;

export function buildServer(
  checkDatabase: ReadinessCheck = checkDatabaseConnection,
  options: ServerOptions = {},
) {
  const server = Fastify({ logger: true });
  const conversationService =
    options.conversationService ?? new ConversationService();
  const handoffService = new HandoffService();
  const allowedWebOrigin = loadEnvironment().WEB_ORIGIN;
  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin === allowedWebOrigin) {
      reply
        .header("access-control-allow-origin", allowedWebOrigin)
        .header("access-control-allow-credentials", "true")
        .header("vary", "Origin");
    }
  });
  server.options(
    "/api/v1/*",
    { config: { public: true } },
    async (_request, reply) =>
      reply
        .header("access-control-allow-methods", "GET,POST,OPTIONS")
        .header(
          "access-control-allow-headers",
          "authorization,content-type,idempotency-key",
        )
        .code(204)
        .send(),
  );
  registerEmployeeAuthentication(server, options.auth ?? agentAuthConfig());

  server.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof AuthenticationError) {
      void reply
        .code(401)
        .send({ error: "UNAUTHORIZED", message: error.message });
      return;
    }
    if (error instanceof HandoffNotFoundError) {
      void reply.code(404).send({
        error: "HANDOFF_NOT_FOUND",
        message: error.message,
      });
      return;
    }
    if (
      error instanceof HandoffAccessError ||
      error instanceof InvalidHandoffTransitionError
    ) {
      void reply.code(409).send({
        error:
          error instanceof HandoffAccessError
            ? "HANDOFF_NOT_ASSIGNED"
            : "INVALID_HANDOFF_TRANSITION",
        message: error.message,
      });
      return;
    }
    if (error instanceof ZodError) {
      void reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "Request validation failed.",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    if (error instanceof ConversationNotFoundError) {
      void reply.code(404).send({
        error: "CONVERSATION_NOT_FOUND",
        message: error.message,
      });
      return;
    }
    if (
      error instanceof ConversationNotActiveError ||
      error instanceof MessageLimitReachedError ||
      error instanceof AgentRequestConflictError ||
      error instanceof ConfirmationRequiredError
    ) {
      void reply.code(409).send({
        error:
          error instanceof MessageLimitReachedError
            ? "MESSAGE_LIMIT_REACHED"
            : error instanceof ConfirmationRequiredError
              ? "CONFIRMATION_REQUIRED"
              : error instanceof ConversationNotActiveError
                ? "CONVERSATION_NOT_ACTIVE"
                : "IDEMPOTENCY_CONFLICT",
        message: error.message,
      });
      return;
    }
    if (error instanceof AgentUpstreamError) {
      request.log.error({ err: error }, "Agent dependency failed");
      void reply.code(502).send({
        error: "AGENT_DEPENDENCY_FAILED",
        message: "Não foi possível concluir a solicitação. Tente novamente.",
      });
      return;
    }

    request.log.error({ err: error }, "Agent request failed");
    void reply.code(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível concluir a solicitação.",
    });
  });

  server.get(
    "/health",
    { config: { public: true }, schema: { response: { 200: errorSchema } } },
    async () => ({ status: "ok", service: "nexo-assist-agent" }),
  );
  server.get("/health/live", { config: { public: true } }, async () => ({
    status: "ok",
    service: "nexo-assist-agent",
  }));
  server.get(
    "/health/ready",
    {
      config: { public: true },
      schema: { response: { 200: errorSchema, 503: errorSchema } },
    },
    async (request, reply) => {
      try {
        await checkDatabase();
        return {
          status: "ok",
          service: "nexo-assist-agent",
          dependencies: { database: "ok" },
        };
      } catch (error) {
        request.log.error({ err: error }, "Agent readiness check failed");
        return reply.code(503).send({
          status: "error",
          service: "nexo-assist-agent",
          dependencies: { database: "unavailable" },
        });
      }
    },
  );

  server.get(
    "/api/v1/analyst/handoffs",
    {
      config: { analystOnly: true },
      schema: {
        tags: ["Analyst Console"],
        summary: "List waiting and assigned analyst handoffs",
        response: { 200: errorSchema },
      },
    },
    async (request) => handoffService.listQueue(getAnalystId(request)),
  );

  server.get(
    "/api/v1/analyst/handoffs/:handoffId",
    {
      config: { analystOnly: true },
      schema: {
        tags: ["Analyst Console"],
        summary: "Get handoff summary, history, and conversation messages",
        params: {
          type: "object",
          required: ["handoffId"],
          properties: { handoffId: { type: "string", format: "uuid" } },
        },
        response: { 200: errorSchema },
      },
    },
    async (request) =>
      handoffService.getHandoff(
        getAnalystId(request),
        handoffParamsSchema.parse(request.params).handoffId,
      ),
  );

  server.post(
    "/api/v1/analyst/handoffs/:handoffId/assign",
    {
      config: { analystOnly: true },
      schema: {
        tags: ["Analyst Console"],
        summary: "Atomically assign a waiting handoff to this analyst",
        params: {
          type: "object",
          required: ["handoffId"],
          properties: { handoffId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: {
            reason: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      await handoffService.assign(
        getAnalystId(request),
        handoffParamsSchema.parse(request.params).handoffId,
        handoffReasonSchema.parse(request.body).reason,
      );
      return reply.code(204).send();
    },
  );

  server.post(
    "/api/v1/analyst/handoffs/:handoffId/messages",
    {
      config: { analystOnly: true },
      schema: {
        tags: ["Analyst Console"],
        summary: "Send an analyst-authored message in an assigned conversation",
        params: {
          type: "object",
          required: ["handoffId"],
          properties: { handoffId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 10_000 },
          },
        },
        response: { 201: errorSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await handoffService.sendMessage(
            getAnalystId(request),
            handoffParamsSchema.parse(request.params).handoffId,
            analystMessageSchema.parse(request.body).content,
          ),
        ),
  );

  for (const [action, status] of [
    ["resume", "agent_resumed"],
    ["resolve", "resolved"],
    ["close", "closed"],
  ] as const) {
    server.post(
      `/api/v1/analyst/handoffs/:handoffId/${action}`,
      {
        config: { analystOnly: true },
        schema: {
          tags: ["Analyst Console"],
          summary: `${action} an assigned analyst handoff`,
          params: {
            type: "object",
            required: ["handoffId"],
            properties: { handoffId: { type: "string", format: "uuid" } },
          },
          body: {
            type: "object",
            additionalProperties: false,
            required: ["reason"],
            properties: {
              reason: { type: "string", minLength: 1, maxLength: 500 },
            },
          },
        },
      },
      async (request, reply) => {
        await handoffService.transition(
          getAnalystId(request),
          handoffParamsSchema.parse(request.params).handoffId,
          status,
          handoffReasonSchema.parse(request.body).reason,
        );
        return reply.code(204).send();
      },
    );
  }

  server.post(
    "/api/v1/conversations",
    {
      schema: {
        tags: ["Conversations"],
        summary: "Create a conversation for the authenticated employee",
        response: { 201: errorSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await conversationService.createConversation(getEmployeeId(request)),
        ),
  );

  server.get(
    "/api/v1/conversations",
    {
      schema: {
        tags: ["Conversations"],
        summary: "List the authenticated employee's conversations",
        response: { 200: errorSchema },
      },
    },
    async (request) =>
      conversationService.listConversations(getEmployeeId(request)),
  );

  server.get(
    "/api/v1/conversations/:conversationId/messages",
    {
      schema: {
        tags: ["Conversations"],
        summary: "List messages from an owned conversation",
        params: {
          type: "object",
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", format: "uuid" },
          },
        },
        response: { 200: errorSchema },
      },
    },
    async (request) => {
      const { conversationId } = routeParamsSchema.parse(request.params);
      return conversationService.listMessages(
        getEmployeeId(request),
        conversationId,
      );
    },
  );

  server.post(
    "/api/v1/conversations/:conversationId/messages",
    {
      schema: {
        tags: ["Conversations"],
        summary: "Send a message and run the deterministic agent workflow",
        params: {
          type: "object",
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", format: "uuid" },
          },
        },
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: {
            "idempotency-key": { type: "string", minLength: 8, maxLength: 128 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 10_000 },
          },
        },
        response: { 200: errorSchema },
      },
    },
    async (request) => {
      const { conversationId } = routeParamsSchema.parse(request.params);
      const { content } = messageBodySchema.parse(request.body);
      const idempotencyKey = idempotencyKeySchema.parse(
        request.headers["idempotency-key"],
      );
      return conversationService.sendMessage(
        getEmployeeId(request),
        conversationId,
        content,
        idempotencyKey,
      );
    },
  );

  server.post(
    "/api/v1/conversations/:conversationId/drafts/:draftId/confirm",
    {
      schema: {
        tags: ["Conversations"],
        summary: "Confirm an existing pending operation",
        params: {
          type: "object",
          required: ["conversationId", "draftId"],
          properties: {
            conversationId: { type: "string", format: "uuid" },
            draftId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["confirmation"],
          properties: { confirmation: { type: "string", enum: ["confirm"] } },
        },
        response: { 200: errorSchema },
      },
    },
    async (request) => {
      const { conversationId, draftId } = draftParamsSchema.parse(
        request.params,
      );
      confirmationBodySchema.parse(request.body);
      return conversationService.confirmDraft(
        getEmployeeId(request),
        conversationId,
        draftId,
      );
    },
  );

  if (options.closeDependencies !== false) {
    server.addHook("onClose", async () => {
      await mastraStorage.close();
      await closeKnowledgeVectorStore();
      await closeDatabaseConnection();
    });
  }

  return server;
}

async function main(): Promise<void> {
  const environment = loadEnvironment();
  void mastra;
  await mastraStorage.init();
  await initializeKnowledgeVectorIndex();
  const server = buildServer();
  await server.listen({ port: environment.AGENT_PORT, host: "0.0.0.0" });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error("Could not start nexo-assist-agent", error);
    process.exitCode = 1;
  });
}
