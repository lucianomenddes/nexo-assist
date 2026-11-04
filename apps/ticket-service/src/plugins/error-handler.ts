import { ZodError } from "zod";
import { IdempotencyConflictError } from "@nexo-assist/database";
import {
  AuthenticationError,
  AuthorizationError,
} from "../shared/errors/authentication-errors.js";
import {
  EmployeeNotFoundError,
  InvalidTicketStateError,
  ReopenWindowExpiredError,
  TicketConflictError,
  TicketNotFoundError,
} from "../shared/errors/ticket-errors.js";

export function registerErrorHandler(
  server: import("fastify").FastifyInstance,
): void {
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
}
