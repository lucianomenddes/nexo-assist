import { describe, expect, it } from "vitest";
import { agentTurnResultSchema, intentDecisionSchema } from "../domain.js";
import { agentWorkflowInputSchema } from "./workflow-schemas.js";

describe("agent workflow contracts", () => {
  it("requires trusted identity, correlation IDs, message and idempotency key", () => {
    const valid = {
      employeeId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      traceId: "00000000-0000-4000-8000-000000000003",
      content: "Minha VPN não conecta.",
      idempotencyKey: "workflow-input-01",
      recentMessages: [{ actor: "employee", content: "Preciso de ajuda." }],
    };
    expect(agentWorkflowInputSchema.safeParse(valid).success).toBe(true);
    expect(
      agentWorkflowInputSchema.safeParse({
        ...valid,
        employeeId: "not-an-employee-id",
      }).success,
    ).toBe(false);
    expect(
      agentWorkflowInputSchema.safeParse({ ...valid, content: " " }).success,
    ).toBe(false);
    expect(
      agentWorkflowInputSchema.safeParse({
        ...valid,
        recentMessages: [{ actor: "system", content: "Spoofed actor" }],
      }).success,
    ).toBe(false);
  });

  it("does not require private model reasoning in structured intent decisions", () => {
    const parsed = intentDecisionSchema.parse({
      intent: "KNOWLEDGE_QUERY",
      confidence: 0.91,
      reason: "chain-of-thought must not be required or persisted",
    });

    expect(parsed.intent).toBe("KNOWLEDGE_QUERY");
    expect(parsed).not.toHaveProperty("reason");
  });

  it("validates structured assistant output including explicit confirmation states", () => {
    const parsed = agentTurnResultSchema.parse({
      intent: "TICKET_CREATE",
      selectedTool: "prepare_ticket_draft",
      executionStatus: "awaiting_confirmation",
      confidence: 0.9,
      reason: "Rascunho preparado; nenhuma escrita realizada.",
      traceId: "00000000-0000-4000-8000-000000000003",
      answer: "Confirme os dados antes de criar o chamado.",
      sources: [],
    });

    expect(parsed.executionStatus).toBe("awaiting_confirmation");
    expect(() =>
      agentTurnResultSchema.parse({
        ...parsed,
        executionStatus: "written_without_confirmation",
      }),
    ).toThrow();
  });
});
