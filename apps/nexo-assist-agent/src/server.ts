import Fastify from "fastify";
import { loadEnvironment } from "@nexo-assist/config";
import {
  checkDatabaseConnection,
  closeDatabaseConnection,
} from "@nexo-assist/database";
import { mastra, mastraStorage } from "./mastra/index.js";

type ReadinessCheck = () => Promise<void>;

export function buildServer(
  checkDatabase: ReadinessCheck = checkDatabaseConnection,
) {
  const server = Fastify({ logger: true });

  server.get("/health/live", async () => ({
    status: "ok",
    service: "nexo-assist-agent",
  }));

  server.get("/health/ready", async (request, reply) => {
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
  });

  server.addHook("onClose", async () => {
    await mastraStorage.close();
    await closeDatabaseConnection();
  });

  return server;
}

async function main(): Promise<void> {
  const environment = loadEnvironment();
  void mastra;
  await mastraStorage.init();
  const server = buildServer();
  await server.listen({ port: environment.AGENT_PORT, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error("Could not start nexo-assist-agent", error);
  process.exitCode = 1;
});
