import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import {
  checkDatabaseConnection,
  closeDatabaseConnection,
} from "./lib/database.js";
import { loadEnvironment } from "./config/env.js";
import { registerAuthentication } from "./plugins/authentication.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { healthRoutes } from "./plugins/health.routes.js";
import { ticketRoutes } from "./modules/tickets/tickets.routes.js";
import { TicketService } from "./modules/tickets/tickets.service.js";

type ReadinessCheck = () => Promise<void>;
type TestableOptions = {
  ticketService?: TicketService;
  auth?: { secret?: string; issuer?: string; audience?: string };
};

export async function buildServer(
  checkDatabase: ReadinessCheck = checkDatabaseConnection,
  options: TestableOptions = {},
): Promise<import("fastify").FastifyInstance> {
  const environment = loadEnvironment();
  const server = Fastify({ logger: true });
  const ticketService = options.ticketService ?? new TicketService();

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
  await registerAuthentication(server, {
    secret: options.auth?.secret ?? environment.AUTH_JWT_SECRET,
    issuer: options.auth?.issuer ?? environment.AUTH_JWT_ISSUER,
    audience: options.auth?.audience ?? environment.AUTH_JWT_AUDIENCE,
  });
  registerErrorHandler(server);
  await server.register(healthRoutes, { checkDatabase });
  await server.register(ticketRoutes, { ticketService });

  server.addHook("onClose", closeDatabaseConnection);
  return server;
}

export const app = await buildServer();
