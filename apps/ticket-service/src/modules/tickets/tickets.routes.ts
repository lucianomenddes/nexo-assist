import { TicketsController } from "./tickets.controller.js";
import { TicketService } from "./tickets.service.js";

type TicketRoutesOptions = { ticketService: TicketService };
const secured = [{ bearerAuth: [] }];
const objectResponseSchema = {
  type: "object",
  additionalProperties: true,
} as const;

export const ticketRoutes: import("fastify").FastifyPluginAsync<
  TicketRoutesOptions
> = async (server, { ticketService }) => {
  const controller = new TicketsController(ticketService);

  server.get(
    "/employees/me",
    {
      schema: {
        tags: ["Employees"],
        summary: "Get the authenticated employee profile",
        security: secured,
      },
    },
    (request) => controller.getEmployee(request),
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
    (request) => controller.searchTickets(request),
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
    (request) => controller.listTickets(request),
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
    (request, reply) => controller.createTicket(request, reply),
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
    (request) => controller.getTicket(request),
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
    (request) => controller.patchTicket(request),
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
    (request) => controller.reopenTicket(request),
  );
};
