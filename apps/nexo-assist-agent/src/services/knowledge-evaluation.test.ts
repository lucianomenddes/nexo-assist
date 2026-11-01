import { describe, expect, it } from "vitest";
import {
  calculateRecallAtK,
  calculateReciprocalRank,
  knowledgeEvaluationDatasetSchema,
} from "./knowledge-evaluation.js";
import { isPlatformAllowed } from "./knowledge-rag.js";

describe("knowledge RAG evaluation metrics", () => {
  it("calculates Recall@K over distinct expected sources", () => {
    expect(
      calculateRecallAtK(
        ["vpn", "hours"],
        ["vpn", "unrelated", "hours", "extra"],
        3,
      ),
    ).toBe(1);
    expect(calculateRecallAtK(["vpn", "hours"], ["vpn"], 5)).toBe(0.5);
  });

  it("calculates reciprocal rank and treats expected abstentions as correct", () => {
    expect(calculateReciprocalRank(["hours", "vpn"], ["other", "vpn"])).toBe(
      0.5,
    );
    expect(calculateReciprocalRank(["vpn"], ["other"])).toBe(0);
    expect(calculateRecallAtK([], [], 5)).toBeNull();
    expect(calculateReciprocalRank([], [])).toBeNull();
  });

  it("validates the evaluation cases and required answer-quality labels", () => {
    const dataset = knowledgeEvaluationDatasetSchema.parse({
      version: "fixture-v1",
      cases: [
        {
          id: "sample",
          query: "Where is the VPN article?",
          expectedSources: ["nexo://kb/vpn"],
          expectedFacts: ["The article applies to Windows 10."],
          referenceAnswer: "The retrieved article applies to Windows 10.",
        },
      ],
    });
    expect(dataset.cases).toHaveLength(1);
  });

  it("allows only global or platform-compatible knowledge sources", () => {
    expect(isPlatformAllowed([], undefined)).toBe(true);
    expect(isPlatformAllowed(["Windows 10"], undefined)).toBe(false);
    expect(isPlatformAllowed(["Windows 10"], "windows 10")).toBe(true);
    expect(isPlatformAllowed(["Windows 10"], "Windows 11")).toBe(false);
  });
});
