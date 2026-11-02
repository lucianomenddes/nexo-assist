import { describe, expect, it } from "vitest";
import {
  observabilitySummary,
  observabilityJson,
  readTokenUsage,
  redactObservabilityText,
} from "./agent-observability.js";

describe("agent observability redaction", () => {
  it("redacts common PII and credentials from text", () => {
    const result = redactObservabilityText(
      "contato ana@example.com, CPF 123.456.789-09, token=abc123 Bearer eyJhbGciOi.test",
    );

    expect(result).not.toContain("ana@example.com");
    expect(result).not.toContain("123.456.789-09");
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("eyJhbGciOi.test");
    expect(result).toContain("[EMAIL REDIGIDO]");
    expect(result).toContain("[CPF REDIGIDO]");
  });

  it("omits private reasoning and redacts sensitive object properties", () => {
    const result = observabilitySummary({
      intent: "KNOWLEDGE_QUERY",
      email: "ana@example.com",
      analysis: "private model reasoning",
      output: "Fonte oficial consultada.",
    });

    expect(result).toContain("KNOWLEDGE_QUERY");
    expect(result).toContain("[REDACTED]");
    expect(result).toContain("Fonte oficial consultada.");
    expect(result).not.toContain("ana@example.com");
    expect(result).not.toContain("private model reasoning");
  });

  it("redacts private fields from previously serialized audit summaries", () => {
    const result = observabilitySummary(
      '{"tool":"search","chain_of_thought":"private reasoning","email":"ana@example.com"}',
    );

    expect(result).toContain('"tool":"search"');
    expect(result).not.toContain("chain_of_thought");
    expect(result).not.toContain("private reasoning");
    expect(result).not.toContain("ana@example.com");
  });

  it("preserves token usage metrics while redacting credential tokens", () => {
    expect(
      observabilityJson({
        inputTokens: 12,
        outputTokens: 8,
        accessToken: "secret-access-token",
      }),
    ).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      accessToken: "[REDACTED]",
    });
  });
});

describe("readTokenUsage", () => {
  it("normalizes provider token aliases and derives total usage", () => {
    expect(readTokenUsage({ promptTokens: 12, completionTokens: 8 })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    });
  });

  it("does not invent token counts when usage is absent", () => {
    expect(readTokenUsage({})).toBeNull();
    expect(readTokenUsage(null)).toBeNull();
  });
});
