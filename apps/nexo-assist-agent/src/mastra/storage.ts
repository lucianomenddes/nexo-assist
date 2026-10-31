import { PostgresStore } from "@mastra/pg";
import { loadEnvironment } from "@nexo-assist/config";

const environment = loadEnvironment();

export const mastraStorage = new PostgresStore({
  id: "nexo-assist-mastra-storage",
  connectionString: environment.DATABASE_URL,
  schemaName: "mastra_storage",
});
