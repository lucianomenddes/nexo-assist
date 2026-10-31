import Fastify from "fastify";
import { loadEnvironment } from "@nexo-assist/config";
import {
  checkDatabaseConnection,
  closeDatabaseConnection,
} from "@nexo-assist/database";

type ReadinessCheck = () => Promise<void>;

export function buildServer(
  checkDatabase: ReadinessCheck = checkDatabaseConnection,
) {
  const server = Fastify({ logger: true });

  server.get("/health/live", async () => ({
    status: "ok",
    service: "ticket-service",
  }));

  server.get("/health/ready", async (request, reply) => {
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
  });

  server.addHook("onClose", closeDatabaseConnection);

  return server;
}

async function main(): Promise<void> {
  const environment = loadEnvironment();
  const server = buildServer();
  await server.listen({
    port: environment.TICKET_SERVICE_PORT,
    host: "0.0.0.0",
  });
}

main().catch((error: unknown) => {
  console.error("Could not start ticket-service", error);
  process.exitCode = 1;
});
