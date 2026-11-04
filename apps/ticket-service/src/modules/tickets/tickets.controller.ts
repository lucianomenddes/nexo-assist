import { z } from "zod";
import {
  getAuthenticatedEmployee,
  getAuthenticatedServiceEmployee,
} from "../../plugins/authentication.js";
import {
  createTicketSchema,
  listTicketsQuerySchema,
  patchTicketSchema,
  searchTicketsQuerySchema,
  ticketParamsSchema,
} from "./tickets.schema.js";

export class TicketsController {
  private readonly ticketService: import("./tickets.service.js").TicketService;

  constructor(ticketService: import("./tickets.service.js").TicketService) {
    this.ticketService = ticketService;
  }

  getEmployee(request: import("fastify").FastifyRequest) {
    return this.ticketService.getEmployee(getAuthenticatedEmployee(request));
  }

  searchTickets(request: import("fastify").FastifyRequest) {
    const query = searchTicketsQuerySchema.parse(request.query);
    return this.ticketService.searchTickets(
      getAuthenticatedEmployee(request),
      query.q,
      query.limit,
    );
  }

  listTickets(request: import("fastify").FastifyRequest) {
    const query = listTicketsQuerySchema.parse(request.query);
    return this.ticketService.listTickets(
      getAuthenticatedEmployee(request),
      query,
    );
  }

  async createTicket(
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) {
    const input = createTicketSchema.parse(request.body);
    const idempotencyKey = z
      .string()
      .min(8)
      .max(128)
      .parse(request.headers["idempotency-key"]);
    const result = await this.ticketService.createTicket(
      getAuthenticatedServiceEmployee(request),
      input,
      idempotencyKey,
    );
    const duplicateUpdated =
      "duplicateUpdated" in result && result.duplicateUpdated === true;
    return reply.code(duplicateUpdated ? 200 : 201).send(result);
  }

  getTicket(request: import("fastify").FastifyRequest) {
    const { id } = ticketParamsSchema.parse(request.params);
    return this.ticketService.getTicket(getAuthenticatedEmployee(request), id);
  }

  patchTicket(request: import("fastify").FastifyRequest) {
    const { id } = ticketParamsSchema.parse(request.params);
    const input = patchTicketSchema.parse(request.body);
    const idempotencyKey = z
      .string()
      .min(8)
      .max(128)
      .parse(request.headers["idempotency-key"]);
    return this.ticketService.patchTicket(
      getAuthenticatedServiceEmployee(request),
      id,
      input,
      idempotencyKey,
    );
  }

  reopenTicket(request: import("fastify").FastifyRequest) {
    const { id } = ticketParamsSchema.parse(request.params);
    const idempotencyKey = z
      .string()
      .min(8)
      .max(128)
      .parse(request.headers["idempotency-key"]);
    return this.ticketService.reopenTicket(
      getAuthenticatedServiceEmployee(request),
      id,
      idempotencyKey,
    );
  }
}
