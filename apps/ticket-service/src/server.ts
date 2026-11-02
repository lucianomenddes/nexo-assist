import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { ZodError, z } from "zod";
import { loadEnvironment } from "@nexo-assist/config";
import {
  checkDatabaseConnection,
  closeDatabaseConnection,
  IdempotencyConflictError,
} from "@nexo-assist/database";
import {
  getAuthenticatedEmployee,
  getAuthenticatedServiceEmployee,
  registerAuthentication,
  AuthenticationError,
  AuthorizationError,
} from "./auth.js";
import {
  createTicketSchema,
  listTicketsQuerySchema,
  patchTicketSchema,
  searchTicketsQuerySchema,
  ticketParamsSchema,
} from "./domain.js";
import {
  EmployeeNotFoundError,
  InvalidTicketStateError,
  ReopenWindowExpiredError,
  TicketConflictError,
  TicketNotFoundError,
} from "./errors.js";
import { TicketService } from "./ticket-service.js";

type ReadinessCheck = () => Promise<void>;
type TestableOptions = {
  ticketService?: TicketService;
  auth?: {
    secret?: string;
    issuer?: string;
    audience?: string;
  };
};

const objectResponseSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const secured = [{ bearerAuth: [] }];

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export async function buildServer(
  checkDatabase: ReadinessCheck = checkDatabaseConnection,
  options: TestableOptions = {},
) {
  const environment = loadEnvironment();
  const server = Fastify({ logger: true });
  const ticketService = options.ticketService ?? new TicketService();
  const auth = {
    secret: options.auth?.secret ?? environment.AUTH_JWT_SECRET,
    issuer: options.auth?.issuer ?? environment.AUTH_JWT_ISSUER,
    audience: options.auth?.audience ?? environment.AUTH_JWT_AUDIENCE,
  };

  await server.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Nexo Assist Ticket Service",
        description:
          "Authenticated API for employee-owned IT service desk tickets.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  await server.register(swaggerUi, { routePrefix: "/docs" });
  await registerAuthentication(server, auth);

  server.setErrorHandler(
    (error: import("fastify").FastifyError | Error, request, reply): void => {
      if (error instanceof AuthenticationError) {
        void reply
          .code(401)
          .send({ error: "UNAUTHORIZED", message: error.message });
        return;
      }
      if (error instanceof AuthorizationError) {
        void reply
          .code(403)
          .send({ error: "FORBIDDEN", message: error.message });
        return;
      }

      if (
        "code" in error &&
        error.code === "FST_ERR_VALIDATION" &&
        "statusCode" in error &&
        error.statusCode === 400
      ) {
        void reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "Request validation failed.",
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

      if (error instanceof EmployeeNotFoundError) {
        void reply
          .code(404)
          .send({ error: "EMPLOYEE_NOT_FOUND", message: error.message });
        return;
      }
      if (error instanceof TicketNotFoundError) {
        void reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: error.message });
        return;
      }
      if (error instanceof IdempotencyConflictError) {
        void reply
          .code(409)
          .send({ error: "IDEMPOTENCY_CONFLICT", message: error.message });
        return;
      }
      if (error instanceof TicketConflictError) {
        void reply
          .code(409)
          .send({ error: "VERSION_CONFLICT", message: error.message });
        return;
      }
      if (error instanceof ReopenWindowExpiredError) {
        void reply
          .code(409)
          .send({ error: "REOPEN_WINDOW_EXPIRED", message: error.message });
        return;
      }
      if (error instanceof InvalidTicketStateError) {
        void reply
          .code(409)
          .send({ error: "INVALID_TICKET_STATE", message: error.message });
        return;
      }

      request.log.error({ err: error }, "Ticket service request failed");
      void reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      });
    },
  );

  server.get(
    "/health",
    {
      config: { public: true },
      schema: {
        tags: ["Health"],
        summary: "Check service health",
        response: { 200: objectResponseSchema },
      },
    },
    async () => ({ status: "ok", service: "ticket-service" }),
  );
  server.get(
    "/health/live",
    { config: { public: true }, schema: { hide: true } },
    async () => ({ status: "ok", service: "ticket-service" }),
  );
  server.get(
    "/health/ready",
    {
      config: { public: true },
      schema: {
        tags: ["Health"],
        summary: "Check service and database readiness",
        response: { 200: objectResponseSchema, 503: objectResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        await checkDatabase();
        return {
          status: "ok",
          service: "ticket-service",
          dependencies: { database: "ok" },
        };
      } catch (error) {
        request.log.error(
          { err: error },
          "Ticket service readiness check failed",
        );
        return reply.code(503).send({
          status: "error",
          service: "ticket-service",
          dependencies: { database: "unavailable" },
        });
      }
    },
  );

  server.get(
    "/employees/me",
    {
      schema: {
        tags: ["Employees"],
        summary: "Get the authenticated employee profile",
        security: secured,
      },
    },
    async (request) =>
      ticketService.getEmployee(getAuthenticatedEmployee(request)),
  );

  server.get(
    "/tickets/search",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Search the authenticated employee's tickets",
        security: secured,
        querystring: {
          type: "object",
          required: ["q"],
          properties: {
            q: { type: "string", minLength: 2, maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      const query = searchTicketsQuerySchema.parse(request.query);
      return ticketService.searchTickets(
        getAuthenticatedEmployee(request),
        query.q,
        query.limit,
      );
    },
  );

  server.get(
    "/tickets",
    {
      schema: {
        tags: ["Tickets"],
        summary: "List the authenticated employee's tickets",
        security: secured,
        querystring: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["open", "awaiting_analyst", "resolved", "closed"],
            },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request) => {
      const query = listTicketsQuerySchema.parse(request.query);
      return ticketService.listTickets(
        getAuthenticatedEmployee(request),
        query,
      );
    },
  );

  server.post(
    "/tickets",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Create or update a duplicate ticket",
        security: secured,
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: { "idempotency-key": { type: "string", minLength: 8 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title", "description", "type", "category", "priority"],
          properties: {
            title: { type: "string", minLength: 5, maxLength: 160 },
            description: { type: "string", minLength: 10, maxLength: 10000 },
            type: { type: "string", enum: ["INC", "REQ"] },
            category: {
              type: "string",
              enum: [
                "Acesso",
                "Rede e VPN",
                "Hardware",
                "Software",
                "E-mail",
                "Outros",
              ],
            },
            priority: {
              type: "string",
              enum: ["Crítica", "Alta", "Média", "Baixa"],
            },
            affectedEmployeeId: { type: "string", format: "uuid" },
          },
        },
        response: { 201: objectResponseSchema, 200: objectResponseSchema },
      },
    },
    async (request, reply) => {
      const input = createTicketSchema.parse(request.body);
      const idempotencyKey = z
        .string()
        .min(8)
        .max(128)
        .parse(request.headers["idempotency-key"]);
      const result = await ticketService.createTicket(
        getAuthenticatedServiceEmployee(request),
        input,
        idempotencyKey,
      );
      const duplicateUpdated =
        "duplicateUpdated" in result && result.duplicateUpdated === true;
      return reply.code(duplicateUpdated ? 200 : 201).send(result);
    },
  );

  server.get(
    "/tickets/:id",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Get an owned ticket and its history",
        security: secured,
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request) => {
      const { id } = ticketParamsSchema.parse(request.params);
      return ticketService.getTicket(getAuthenticatedEmployee(request), id);
    },
  );

  server.patch(
    "/tickets/:id",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Update an owned ticket using optimistic concurrency",
        security: secured,
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: { "idempotency-key": { type: "string", minLength: 8 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedVersion"],
          properties: {
            expectedVersion: { type: "integer", minimum: 1 },
            title: { type: "string", minLength: 5, maxLength: 160 },
            description: { type: "string", minLength: 10, maxLength: 10000 },
            type: { type: "string", enum: ["INC", "REQ"] },
            category: {
              type: "string",
              enum: [
                "Acesso",
                "Rede e VPN",
                "Hardware",
                "Software",
                "E-mail",
                "Outros",
              ],
            },
            priority: {
              type: "string",
              enum: ["Crítica", "Alta", "Média", "Baixa"],
            },
            status: {
              type: "string",
              enum: ["open", "awaiting_analyst", "resolved", "closed"],
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = ticketParamsSchema.parse(request.params);
      const input = patchTicketSchema.parse(request.body);
      const idempotencyKey = z
        .string()
        .min(8)
        .max(128)
        .parse(request.headers["idempotency-key"]);
      return ticketService.patchTicket(
        getAuthenticatedServiceEmployee(request),
        id,
        input,
        idempotencyKey,
      );
    },
  );

  server.post(
    "/tickets/:id/reopen",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Reopen a recently resolved owned ticket",
        security: secured,
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: { "idempotency-key": { type: "string", minLength: 8 } },
        },
      },
    },
    async (request) => {
      const { id } = ticketParamsSchema.parse(request.params);
      const idempotencyKey = z
        .string()
        .min(8)
        .max(128)
        .parse(request.headers["idempotency-key"]);
      return ticketService.reopenTicket(
        getAuthenticatedServiceEmployee(request),
        id,
        idempotencyKey,
      );
    },
  );

  server.addHook("onClose", closeDatabaseConnection);
  return server;
}

async function main(): Promise<void> {
  const environment = loadEnvironment();
  const server = await buildServer();
  await server.listen({
    port: environment.TICKET_SERVICE_PORT,
    host: "0.0.0.0",
  });
}

main().catch((error: unknown) => {
  console.error("Could not start ticket-service", error);
  process.exitCode = 1;
});
