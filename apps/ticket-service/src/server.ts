import { app } from "./app.js";
import { loadEnvironment } from "./config/env.js";

async function main(): Promise<void> {
  const environment = loadEnvironment();
  await app.listen({
    port: environment.TICKET_SERVICE_PORT,
    host: "0.0.0.0",
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "Shutting down ticket-service");

  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error, signal }, "Could not shut down ticket-service");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error: unknown) => {
  console.error("Could not start ticket-service", error);
  process.exitCode = 1;
});
