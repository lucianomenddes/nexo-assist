import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeDatabaseConnection } from "@nexo-assist/database";
import { closeKnowledgeVectorStore } from "../services/knowledge-rag.js";
import {
  evaluateKnowledgeDataset,
  knowledgeEvaluationDatasetSchema,
} from "../services/knowledge-evaluation.js";

async function main(): Promise<void> {
  const datasetPath = resolve(
    process.cwd(),
    process.argv[2] ?? "evals/rag-evaluation.json",
  );
  const dataset = knowledgeEvaluationDatasetSchema.parse(
    JSON.parse(await readFile(datasetPath, "utf8")),
  );
  const result = await evaluateKnowledgeDataset(dataset);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Knowledge evaluation failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeKnowledgeVectorStore();
    await closeDatabaseConnection();
  });
