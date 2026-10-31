import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { loadEnvironment } from "@nexo-assist/config";
import { nexoAssistant } from "./agents/agent.js";

const environment = loadEnvironment();

export const mastraStorage = new PostgresStore({
  id: "nexo-assist-mastra-storage",
  connectionString: environment.DATABASE_URL,
  schemaName: "mastra_storage",
});

export const mastra = new Mastra({
  agents: { nexoAssistant },
  storage: mastraStorage,
});
