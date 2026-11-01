import { embedMany } from "ai";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";
import { PgVector } from "@mastra/pg";
import { prisma } from "@nexo-assist/database";
import { loadEnvironment } from "@nexo-assist/config";
import { z } from "zod";
import {
  knowledgeSourceSchema,
  type KnowledgeSource,
} from "../mastra/domain.js";

const environment = loadEnvironment();
const indexName = "nexo_knowledge_chunks";
const embeddingDimension = 1536;
const candidateCount = 40;
const rankConstant = 60;

function canonicalPlatform(platform: string): string {
  return platform.trim().toLocaleLowerCase("pt-BR");
}

const knowledgeSearchFiltersSchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  platform: z.string().trim().min(1).max(80).optional(),
  version: z.number().int().positive().optional(),
});

export type KnowledgeSearchFilters = z.input<
  typeof knowledgeSearchFiltersSchema
>;
export type ParsedKnowledgeSearchFilters = z.output<
  typeof knowledgeSearchFiltersSchema
>;
export type KnowledgeVectorMetadata = {
  source: string;
  title: string;
  category: string | null;
  tags: string[];
  platforms: string[];
  platform: string;
  version: number;
  status: "draft" | "published" | "archived";
  updatedAt: string;
};

type RankedChunk = {
  id: string;
  score: number;
  rank: number;
};

let vectorStore: PgVector | undefined;
let indexPromise: Promise<void> | undefined;

function getVectorStore(): PgVector {
  vectorStore ??= new PgVector({
    id: "nexo-assist-knowledge-vectors",
    connectionString: environment.DATABASE_URL,
    schemaName: "mastra_storage",
  });
  return vectorStore;
}

export async function initializeKnowledgeVectorIndex(): Promise<void> {
  indexPromise ??= getVectorStore()
    .createIndex({
      indexName,
      dimension: embeddingDimension,
      metric: "cosine",
      indexConfig: {
        type: "hnsw",
        hnsw: { m: 16, efConstruction: 64 },
      },
      metadataIndexes: [
        "documentId",
        "status",
        "category",
        "source",
        "version",
        "platform",
      ],
    })
    .catch((error: unknown) => {
      indexPromise = undefined;
      throw error;
    });
  await indexPromise;
}

export async function closeKnowledgeVectorStore(): Promise<void> {
  if (!vectorStore) return;
  await vectorStore.pool.end();
  vectorStore = undefined;
  indexPromise = undefined;
}

export function parseKnowledgeSearchFilters(
  filters: KnowledgeSearchFilters = {},
): ParsedKnowledgeSearchFilters {
  return knowledgeSearchFiltersSchema.parse(filters);
}

export async function createKnowledgeEmbeddings(
  texts: string[],
): Promise<number[][]> {
  if (!environment.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for knowledge embeddings.");
  }
  if (texts.length === 0) return [];

  const { embeddings } = await embedMany({
    model: new ModelRouterEmbeddingModel("openai/text-embedding-3-small"),
    values: texts,
    maxRetries: 1,
  });
  if (embeddings.some((embedding) => embedding.length !== embeddingDimension)) {
    throw new Error(
      `The embedding provider must return ${embeddingDimension} dimensions.`,
    );
  }
  return embeddings;
}

export async function upsertKnowledgeVectors(input: {
  documentId: string;
  source: string;
  title: string;
  category: string | null;
  tags: string[];
  platforms: string[];
  version: number;
  status: "draft" | "published" | "archived";
  updatedAt: Date;
  chunks: Array<{ id: string; text: string }>;
  embeddings: number[][];
}): Promise<void> {
  await initializeKnowledgeVectorIndex();
  const metadata = input.chunks.map(({ text }) => ({
    documentId: input.documentId,
    title: input.title,
    category: input.category,
    tags: input.tags,
    platforms: input.platforms,
    platform:
      input.platforms.length === 1
        ? canonicalPlatform(input.platforms[0]!)
        : "*",
    version: input.version,
    status: input.status,
    source: input.source,
    updatedAt: input.updatedAt.toISOString(),
    text,
  }));
  await getVectorStore().upsert({
    indexName,
    ids: input.chunks.map(({ id }) => id),
    vectors: input.embeddings,
    metadata,
    deleteFilter: { documentId: input.documentId },
  });
}

export async function updateKnowledgeVectorMetadata(
  documentId: string,
  metadata: Partial<KnowledgeVectorMetadata>,
): Promise<void> {
  await initializeKnowledgeVectorIndex();
  const document = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    include: { chunks: { select: { id: true, content: true } } },
  });
  if (!document) throw new Error(`Knowledge document ${documentId} not found.`);
  const nextStatus = metadata.status ?? document.status;
  for (const chunk of document.chunks) {
    const category =
      "category" in metadata ? metadata.category : document.category;
    await getVectorStore().updateVector({
      indexName,
      id: chunk.id,
      update: {
        metadata: {
          documentId,
          title: metadata.title ?? document.title,
          category,
          tags: metadata.tags ?? document.tags,
          platforms: metadata.platforms ?? document.platforms,
          platform:
            metadata.platform ??
            (document.platforms.length === 1
              ? canonicalPlatform(document.platforms[0]!)
              : "*"),
          version: metadata.version ?? document.version,
          status: nextStatus,
          source: metadata.source ?? document.source,
          updatedAt: metadata.updatedAt ?? document.updatedAt.toISOString(),
          text: chunk.content,
        },
      },
    });
  }
}

async function vectorSearch(
  embedding: number[],
  filters: ParsedKnowledgeSearchFilters,
  platform: string,
): Promise<RankedChunk[]> {
  const filter = {
    status: "published",
    platform: platform === "*" ? "*" : canonicalPlatform(platform),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.tags.length ? { tags: { $in: filters.tags } } : {}),
    ...(filters.version !== undefined ? { version: filters.version } : {}),
  };

  const results = await getVectorStore().query({
    indexName,
    queryVector: embedding,
    topK: candidateCount,
    filter,
  });
  return results.map((result, index) => ({
    id: result.id,
    score: result.score,
    rank: index + 1,
  }));
}

async function lexicalSearch(
  query: string,
  filters: ParsedKnowledgeSearchFilters,
): Promise<RankedChunk[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; score: number }>>`
    SELECT chunk.id, ts_rank_cd(
      to_tsvector(
        'simple',
        document.title || ' ' || coalesce(document.category, '') || ' ' || chunk.content
      ),
      plainto_tsquery('simple', ${query})
    ) AS score
    FROM "KnowledgeChunk" chunk
    JOIN "KnowledgeDocument" document ON document.id = chunk."documentId"
    WHERE document.status = 'published'::"KnowledgeDocumentStatus"
      AND (
        ${filters.platform ?? null}::text IS NULL
          AND cardinality(document.platforms) = 0
        OR ${filters.platform ?? null}::text IS NOT NULL
          AND (
            cardinality(document.platforms) = 0
            OR EXISTS (
              SELECT 1
              FROM unnest(document.platforms) AS supported(platform)
              WHERE lower(btrim(supported.platform)) = lower(btrim(${filters.platform ?? null}::text))
            )
          )
      )
      AND (${filters.category ?? null}::text IS NULL OR document.category = ${filters.category ?? null})
      AND (${filters.version ?? null}::integer IS NULL OR document.version = ${filters.version ?? null})
      AND (
        cardinality(${filters.tags}::text[]) = 0
        OR document.tags && ${filters.tags}::text[]
      )
      AND to_tsvector(
        'simple',
        document.title || ' ' || coalesce(document.category, '') || ' ' || chunk.content
      ) @@ plainto_tsquery('simple', ${query})
    ORDER BY score DESC
    LIMIT ${candidateCount}
  `;
  return rows.map((row, index) => ({
    id: row.id,
    score: Number(row.score),
    rank: index + 1,
  }));
}

export async function searchKnowledgeBase(
  query: string,
  requestedFilters: KnowledgeSearchFilters = {},
  limit = 5,
): Promise<KnowledgeSource[]> {
  const normalizedQuery = z.string().trim().min(2).max(2000).parse(query);
  const filters = parseKnowledgeSearchFilters(requestedFilters);
  const topK = z.number().int().min(1).max(20).parse(limit);
  const embeddings = await createKnowledgeEmbeddings([normalizedQuery]);
  await initializeKnowledgeVectorIndex();

  const semanticResults = filters.platform
    ? await Promise.all([
        vectorSearch(embeddings[0]!, filters, filters.platform),
        vectorSearch(embeddings[0]!, filters, "*"),
      ])
    : [await vectorSearch(embeddings[0]!, filters, "*")];
  const semanticRows = semanticResults.flat();
  const lexicalRows = await lexicalSearch(normalizedQuery, filters);

  const ranked = new Map<string, number>();
  for (const result of semanticRows) {
    ranked.set(
      result.id,
      (ranked.get(result.id) ?? 0) + 1 / (rankConstant + result.rank),
    );
  }
  for (const result of lexicalRows) {
    ranked.set(
      result.id,
      (ranked.get(result.id) ?? 0) + 1 / (rankConstant + result.rank),
    );
  }

  const candidateIds = [...ranked.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, candidateCount)
    .map(([id]) => id);
  if (!candidateIds.length) return [];

  const chunks = await prisma.knowledgeChunk.findMany({
    where: {
      id: { in: candidateIds },
      document: {
        status: "published",
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.version !== undefined ? { version: filters.version } : {}),
        ...(filters.tags.length ? { tags: { hasSome: filters.tags } } : {}),
      },
    },
    select: {
      id: true,
      documentId: true,
      content: true,
      document: {
        select: {
          title: true,
          source: true,
          category: true,
          tags: true,
          platforms: true,
          version: true,
          status: true,
          updatedAt: true,
        },
      },
    },
  });
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return candidateIds
    .flatMap((chunkId) => {
      const chunk = byId.get(chunkId);
      if (
        !chunk ||
        !isPlatformAllowed(chunk.document.platforms, filters.platform)
      )
        return [];
      return [
        knowledgeSourceSchema.parse({
          documentId: chunk.documentId,
          chunkId: chunk.id,
          title: chunk.document.title,
          source: chunk.document.source,
          content: chunk.content,
          category: chunk.document.category,
          tags: chunk.document.tags,
          platform:
            filters.platform && chunk.document.platforms.length
              ? filters.platform
              : null,
          version: chunk.document.version,
          status: "published",
          updatedAt: chunk.document.updatedAt.toISOString(),
          score: ranked.get(chunkId) ?? 0,
        }),
      ];
    })
    .slice(0, topK);
}

export function isPlatformAllowed(
  platforms: string[],
  platform?: string,
): boolean {
  if (platforms.length === 0) return true;
  return (
    platform !== undefined &&
    platforms.some(
      (supported) =>
        canonicalPlatform(supported) === canonicalPlatform(platform),
    )
  );
}
