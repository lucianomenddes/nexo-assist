import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { closeDatabaseConnection } from "@nexo-assist/database";
import {
  ingestKnowledgeFile,
  knowledgeDocumentInputSchema,
} from "../services/knowledge-ingestion.js";
import { closeKnowledgeVectorStore } from "../services/knowledge-rag.js";

const manifestSchema = z.object({
  file: z.string().min(1),
  metadata: knowledgeDocumentInputSchema,
  reindex: z.boolean().default(false),
});

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error(
      "Usage: pnpm rag:ingest -- <manifest.json> (manifest paths are relative to the agent app directory).",
    );
  }
  const resolvedManifestPath = resolve(process.cwd(), manifestPath);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(resolvedManifestPath, "utf8")),
  );
  const knowledgeBaseRoot = resolve(process.cwd(), "knowledge-base");
  const articlePath = resolve(knowledgeBaseRoot, manifest.file);
  const articleRelativePath = relative(knowledgeBaseRoot, articlePath);
  if (
    isAbsolute(manifest.file) ||
    articleRelativePath === "" ||
    articleRelativePath === ".." ||
    articleRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(articleRelativePath)
  ) {
    throw new Error(
      "Article file must be inside the knowledge-base directory.",
    );
  }
  const result = await ingestKnowledgeFile({
    metadata: manifest.metadata,
    filePath: articlePath,
    reindex: manifest.reindex,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Knowledge ingestion failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeKnowledgeVectorStore();
    await closeDatabaseConnection();
  });
