import { embed } from "ai";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";
import { prisma } from "@nexo-assist/database";
import { loadEnvironment } from "@nexo-assist/config";
import type { KnowledgeSource } from "../mastra/domain.js";

const environment = loadEnvironment();
const topK = 5;

type KnowledgeRow = {
  documentId: string;
  chunkId: string;
  title: string;
  source: string;
  content: string;
  score: number;
};

export async function searchKnowledgeBase(
  query: string,
): Promise<KnowledgeSource[]> {
  const [hasVectors] = await prisma.$queryRaw<Array<{ available: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "KnowledgeChunk" chunk
      JOIN "KnowledgeDocument" document ON document.id = chunk."documentId"
      WHERE document.status = 'published'::"KnowledgeDocumentStatus"
        AND chunk.embedding IS NOT NULL
    ) AS available
  `;

  const vectorRows: KnowledgeRow[] = [];
  if (hasVectors?.available) {
    if (!environment.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY is required for semantic knowledge retrieval.",
      );
    }

    const { embedding } = await embed({
      model: new ModelRouterEmbeddingModel("openai/text-embedding-3-small"),
      value: query,
      maxRetries: 1,
    });
    const vector = `[${embedding.join(",")}]`;
    vectorRows.push(
      ...(await prisma.$queryRaw<KnowledgeRow[]>`
        SELECT
          document.id AS "documentId",
          chunk.id AS "chunkId",
          document.title AS title,
          document.source AS source,
          chunk.content AS content,
          1 - (chunk.embedding <=> ${vector}::vector) AS score
        FROM "KnowledgeChunk" chunk
        JOIN "KnowledgeDocument" document ON document.id = chunk."documentId"
        WHERE document.status = 'published'::"KnowledgeDocumentStatus"
          AND chunk.embedding IS NOT NULL
        ORDER BY chunk.embedding <=> ${vector}::vector
        LIMIT ${topK}
      `),
    );
  }

  const lexicalRows = await prisma.$queryRaw<KnowledgeRow[]>`
    SELECT
      document.id AS "documentId",
      chunk.id AS "chunkId",
      document.title AS title,
      document.source AS source,
      chunk.content AS content,
      ts_rank_cd(
        to_tsvector('simple', document.title || ' ' || coalesce(document.category, '') || ' ' || chunk.content),
        plainto_tsquery('simple', ${query})
      ) AS score
    FROM "KnowledgeChunk" chunk
    JOIN "KnowledgeDocument" document ON document.id = chunk."documentId"
    WHERE document.status = 'published'::"KnowledgeDocumentStatus"
      AND to_tsvector(
        'simple',
        document.title || ' ' || coalesce(document.category, '') || ' ' || chunk.content
      ) @@ plainto_tsquery('simple', ${query})
    ORDER BY score DESC
    LIMIT ${topK}
  `;

  const combined = new Map<string, KnowledgeRow & { rankScore: number }>();
  for (const [index, row] of vectorRows.entries()) {
    combined.set(row.chunkId, {
      ...row,
      rankScore: 1 / (60 + index + 1),
    });
  }
  for (const [index, row] of lexicalRows.entries()) {
    const prior = combined.get(row.chunkId);
    combined.set(row.chunkId, {
      ...row,
      rankScore: (prior?.rankScore ?? 0) + 1 / (60 + index + 1),
    });
  }

  return [...combined.values()]
    .sort((left, right) => right.rankScore - left.rankScore)
    .slice(0, topK)
    .map(({ rankScore, ...source }) => ({
      ...source,
      score: rankScore,
    }));
}
