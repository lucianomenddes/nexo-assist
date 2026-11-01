import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { MDocument } from "@mastra/rag";
import { PDFParse } from "pdf-parse";
import { prisma } from "@nexo-assist/database";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  createKnowledgeEmbeddings,
  initializeKnowledgeVectorIndex,
  updateKnowledgeVectorMetadata,
  upsertKnowledgeVectors,
  type KnowledgeVectorMetadata,
} from "./knowledge-rag.js";

const maximumDocumentBytes = 30 * 1024 * 1024;
const chunkOptions = {
  strategy: "recursive" as const,
  maxSize: 1200,
  overlap: 120,
  addStartIndex: true,
};

export const knowledgeDocumentInputSchema = z.object({
  recordType: z.literal("knowledge_article"),
  source: z.string().trim().min(1).max(2048),
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(100).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  platforms: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
});

export type KnowledgeDocumentInput = z.input<
  typeof knowledgeDocumentInputSchema
>;
export type ParsedKnowledgeDocumentInput = z.output<
  typeof knowledgeDocumentInputSchema
>;

export class KnowledgeVersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeVersionConflictError";
  }
}

export class UnsupportedKnowledgeDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedKnowledgeDocumentError";
  }
}

export type KnowledgeIngestionResult = {
  documentId: string;
  source: string;
  version: number;
  status: "draft" | "published" | "archived";
  chunks: number;
  outcome: "indexed" | "unchanged" | "metadata-updated" | "duplicate";
  duplicateOf?: string;
};

export function normalizeKnowledgeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split(String.fromCharCode(0))
    .join("")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractKnowledgeText(
  bytes: Uint8Array,
  extension: string,
): Promise<string> {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumDocumentBytes) {
    throw new UnsupportedKnowledgeDocumentError(
      "Document size must be between 1 byte and 30 MB.",
    );
  }
  switch (extension.toLowerCase()) {
    case ".txt":
    case ".md":
    case ".markdown":
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    case ".html":
    case ".htm":
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    case ".pdf": {
      const parser = new PDFParse({ data: bytes });
      try {
        return (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    }
    default:
      throw new UnsupportedKnowledgeDocumentError(
        `Unsupported document format "${extension || "unknown"}". Use TXT, Markdown, HTML, or PDF.`,
      );
  }
}

export async function extractAndChunkKnowledgeText(
  normalized: string,
  fileName: string,
  metadata: Record<string, unknown>,
): Promise<Array<{ text: string; metadata: Record<string, unknown> }>> {
  const extension = extname(fileName).toLowerCase();
  if (!normalized) {
    throw new UnsupportedKnowledgeDocumentError(
      "The document contains no extractable text.",
    );
  }

  const document =
    extension === ".html" || extension === ".htm"
      ? MDocument.fromHTML(normalized, metadata)
      : extension === ".md" || extension === ".markdown"
        ? MDocument.fromMarkdown(normalized, metadata)
        : MDocument.fromText(normalized, metadata);
  const chunks = await document.chunk(
    extension === ".md" || extension === ".markdown"
      ? {
          strategy: "markdown",
          maxSize: chunkOptions.maxSize,
          overlap: chunkOptions.overlap,
          addStartIndex: true,
          headers: [
            ["#", "heading"],
            ["##", "section"],
            ["###", "subsection"],
          ],
        }
      : extension === ".html" || extension === ".htm"
        ? {
            strategy: "html",
            maxSize: chunkOptions.maxSize,
            overlap: 0,
            headers: [
              ["h1", "heading"],
              ["h2", "section"],
              ["h3", "subsection"],
            ],
          }
        : chunkOptions,
  );
  const nonEmptyChunks = chunks
    .map((chunk) => ({
      text: normalizeKnowledgeText(chunk.text),
      metadata: chunk.metadata as Record<string, unknown>,
    }))
    .filter(({ text }) => text.length > 0);
  if (nonEmptyChunks.length === 0) {
    throw new UnsupportedKnowledgeDocumentError(
      "Document extraction produced no indexable chunks.",
    );
  }
  return nonEmptyChunks;
}

function documentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function vectorMetadata(input: {
  source: string;
  title: string;
  category: string | null;
  tags: string[];
  platforms: string[];
  version: number;
  status: "draft" | "published" | "archived";
  updatedAt: Date;
}): KnowledgeVectorMetadata {
  return {
    source: input.source,
    title: input.title,
    category: input.category,
    tags: input.tags,
    platforms: input.platforms,
    platform:
      input.platforms.length === 1
        ? input.platforms[0]!.trim().toLocaleLowerCase("pt-BR")
        : "*",
    version: input.version,
    status: input.status,
    updatedAt: input.updatedAt.toISOString(),
  };
}

export async function ingestKnowledgeDocument(input: {
  metadata: KnowledgeDocumentInput;
  fileName: string;
  bytes: Uint8Array;
  reindex?: boolean;
}): Promise<KnowledgeIngestionResult> {
  const metadata = knowledgeDocumentInputSchema.parse(input.metadata);
  const extracted = normalizeKnowledgeText(
    await extractKnowledgeText(
      input.bytes,
      extname(input.fileName).toLowerCase(),
    ),
  );
  if (!extracted) {
    throw new UnsupportedKnowledgeDocumentError(
      "The document contains no extractable text.",
    );
  }
  const contentHash = documentHash(extracted);

  const sameVersion = await prisma.knowledgeDocument.findUnique({
    where: {
      source_version: {
        source: metadata.source,
        version: metadata.version,
      },
    },
    include: { chunks: { orderBy: { ordinal: "asc" } } },
  });
  if (sameVersion && sameVersion.contentHash !== contentHash) {
    throw new KnowledgeVersionConflictError(
      `Source "${metadata.source}" version ${metadata.version} already exists with different content. Publish a new version instead.`,
    );
  }

  const identicalDocument = await prisma.knowledgeDocument.findUnique({
    where: { contentHash },
    select: { id: true, source: true, version: true, status: true },
  });
  if (
    identicalDocument &&
    (!sameVersion || identicalDocument.id !== sameVersion.id)
  ) {
    return {
      documentId: identicalDocument.id,
      source: identicalDocument.source,
      version: identicalDocument.version,
      status: identicalDocument.status,
      chunks: 0,
      outcome: "duplicate",
      duplicateOf: identicalDocument.source,
    };
  }

  const latest = await prisma.knowledgeDocument.findFirst({
    where: { source: metadata.source },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  if (!sameVersion && latest && metadata.version <= latest.version) {
    throw new KnowledgeVersionConflictError(
      `New versions for source "${metadata.source}" must be greater than ${latest.version}.`,
    );
  }

  if (
    sameVersion &&
    latest &&
    latest.version > metadata.version &&
    metadata.status === "published"
  ) {
    throw new KnowledgeVersionConflictError(
      `Source "${metadata.source}" has a newer version (${latest.version}); an older version cannot be published.`,
    );
  }

  if (sameVersion && sameVersion.chunks.length > 0 && !input.reindex) {
    const metadataChanged =
      sameVersion.status !== metadata.status ||
      sameVersion.title !== metadata.title ||
      sameVersion.category !== metadata.category ||
      !sameStrings(sameVersion.tags, metadata.tags) ||
      !sameStrings(sameVersion.platforms, metadata.platforms);
    if (metadataChanged) {
      const updatedAt = new Date();
      await prisma.knowledgeDocument.update({
        where: { id: sameVersion.id },
        data: {
          title: metadata.title,
          category: metadata.category,
          tags: metadata.tags,
          platforms: metadata.platforms,
          ...(metadata.status === "published"
            ? {}
            : { status: metadata.status }),
          updatedAt,
        },
      });
      await updateKnowledgeVectorMetadata(
        sameVersion.id,
        vectorMetadata({
          source: metadata.source,
          title: metadata.title,
          category: metadata.category,
          tags: metadata.tags,
          platforms: metadata.platforms,
          version: metadata.version,
          status: metadata.status,
          updatedAt,
        }),
      );
      if (metadata.status === "published") {
        await archiveOlderPublishedVersions(metadata.source, metadata.version);
        await prisma.knowledgeDocument.update({
          where: { id: sameVersion.id },
          data: { status: metadata.status },
        });
      }
    }
    return {
      documentId: sameVersion.id,
      source: metadata.source,
      version: metadata.version,
      status: metadata.status,
      chunks: sameVersion.chunks.length,
      outcome: metadataChanged ? "metadata-updated" : "unchanged",
    };
  }

  const documentId = sameVersion?.id ?? randomUUID();
  const chunks = await extractAndChunkKnowledgeText(extracted, input.fileName, {
    documentId,
    title: metadata.title,
    category: metadata.category,
    tags: metadata.tags,
    platforms: metadata.platforms,
    version: metadata.version,
    status: metadata.status,
    source: metadata.source,
  });
  const indexedChunks = chunks.map((chunk, ordinal) => ({
    ...chunk,
    id: sameVersion?.chunks[ordinal]?.id ?? randomUUID(),
  }));
  const embeddings = await createKnowledgeEmbeddings(
    indexedChunks.map(({ text }) => text),
  );
  const now = new Date();
  if (!sameVersion) {
    await prisma.knowledgeDocument.create({
      data: {
        id: documentId,
        source: metadata.source,
        title: metadata.title,
        category: metadata.category,
        tags: metadata.tags,
        platforms: metadata.platforms,
        version: metadata.version,
        status: "draft",
        contentHash,
        updatedAt: now,
      },
    });
  } else if (
    metadata.status !== "published" &&
    sameVersion.status !== metadata.status
  ) {
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: metadata.status },
    });
  }

  await initializeKnowledgeVectorIndex();
  await upsertKnowledgeVectors({
    documentId,
    source: metadata.source,
    title: metadata.title,
    category: metadata.category,
    tags: metadata.tags,
    platforms: metadata.platforms,
    version: metadata.version,
    status: metadata.status,
    updatedAt: now,
    chunks: indexedChunks.map(({ id, text }) => ({ id, text })),
    embeddings,
  });

  const persisted = await prisma.$transaction(async (transaction) => {
    const document = await transaction.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        title: metadata.title,
        category: metadata.category,
        tags: metadata.tags,
        platforms: metadata.platforms,
        updatedAt: now,
      },
      select: { id: true },
    });
    await transaction.knowledgeChunk.deleteMany({
      where: { documentId: document.id },
    });
    await transaction.knowledgeChunk.createMany({
      data: indexedChunks.map((chunk, ordinal) => ({
        id: chunk.id,
        documentId: document.id,
        ordinal,
        content: chunk.text,
        tokenCount: Math.ceil(chunk.text.length / 4),
        metadata: JSON.parse(
          JSON.stringify(chunk.metadata),
        ) as Prisma.InputJsonValue,
      })),
    });
    const storedChunks = await transaction.knowledgeChunk.findMany({
      where: { documentId: document.id },
      orderBy: { ordinal: "asc" },
      select: { id: true, content: true },
    });
    return { document, chunks: storedChunks };
  });

  if (metadata.status === "published") {
    await archiveOlderPublishedVersions(metadata.source, metadata.version);
  }
  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: metadata.status },
  });

  return {
    documentId,
    source: metadata.source,
    version: metadata.version,
    status: metadata.status,
    chunks: persisted.chunks.length,
    outcome: "indexed",
  };

  async function archiveOlderPublishedVersions(
    source: string,
    version: number,
  ): Promise<void> {
    const previousPublished = await prisma.knowledgeDocument.findMany({
      where: { source, version: { lt: version }, status: "published" },
      select: { id: true },
    });
    await Promise.all(
      previousPublished.map(({ id }) =>
        updateKnowledgeVectorMetadata(id, { status: "archived" }),
      ),
    );
    await prisma.knowledgeDocument.updateMany({
      where: { source, version: { lt: version }, status: "published" },
      data: { status: "archived" },
    });
  }
}

export async function ingestKnowledgeFile(input: {
  metadata: KnowledgeDocumentInput;
  filePath: string;
  reindex?: boolean;
}): Promise<KnowledgeIngestionResult> {
  const bytes = await readFile(input.filePath);
  return ingestKnowledgeDocument({
    metadata: input.metadata,
    fileName: input.filePath,
    bytes,
    reindex: input.reindex,
  });
}
