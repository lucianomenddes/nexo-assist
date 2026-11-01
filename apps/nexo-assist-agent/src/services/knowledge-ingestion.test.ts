import { describe, expect, it } from "vitest";
import {
  extractAndChunkKnowledgeText,
  extractKnowledgeText,
  knowledgeDocumentInputSchema,
  normalizeKnowledgeText,
  UnsupportedKnowledgeDocumentError,
} from "./knowledge-ingestion.js";

describe("knowledge document preparation", () => {
  it("normalizes line endings, Unicode, null bytes, and whitespace", () => {
    expect(
      normalizeKnowledgeText(" Cafe\u0301  \r\n\r\n\r\n texto\u0000  "),
    ).toBe("Café\n\ntexto");
  });

  it("extracts and chunks Markdown while retaining heading metadata", async () => {
    const chunks = await extractAndChunkKnowledgeText(
      "# VPN\n\nUse the approved VPN client.",
      "article.md",
      { title: "VPN guide" },
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("Use the approved VPN client.");
    expect(chunks[0]?.metadata).toMatchObject({ title: "VPN guide" });
  });

  it("extracts HTML text into chunks rather than indexing markup", async () => {
    const chunks = await extractAndChunkKnowledgeText(
      "<html><body><h1>Access</h1><p>Use the approved portal.</p></body></html>",
      "article.html",
      { title: "Access guide" },
    );

    expect(chunks.map(({ text }) => text).join(" ")).toContain(
      "Use the approved portal.",
    );
    expect(chunks.map(({ text }) => text).join(" ")).not.toContain("<p>");
  });

  it("rejects unsupported formats and invalid metadata explicitly", async () => {
    await expect(
      extractKnowledgeText(new TextEncoder().encode("data"), ".docx"),
    ).rejects.toBeInstanceOf(UnsupportedKnowledgeDocumentError);
    expect(
      knowledgeDocumentInputSchema.safeParse({
        source: "nexo://test",
        title: "Test",
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      knowledgeDocumentInputSchema.safeParse({
        recordType: "knowledge_article",
        source: "nexo://test",
        title: "Test",
        version: 1,
      }).success,
    ).toBe(true);
  });
});
