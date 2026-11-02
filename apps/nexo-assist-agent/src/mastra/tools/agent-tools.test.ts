import { describe, expect, it } from "vitest";
import {
  prepareTicketDraftInputSchema,
  prepareTicketDraftOutputSchema,
  requestHumanHandoffInputSchema,
  requestHumanHandoffOutputSchema,
  searchKnowledgeBaseInputSchema,
  searchMyTicketsInputSchema,
} from "./agent-tools.js";

describe("Mastra tool contracts", () => {
  it("validates bounded knowledge queries and platform filters", () => {
    expect(
      searchKnowledgeBaseInputSchema.safeParse({
        query: "VPN error 809",
        filters: { platform: "Windows 11", version: 2 },
      }).success,
    ).toBe(true);
    expect(
      searchKnowledgeBaseInputSchema.safeParse({ query: "x" }).success,
    ).toBe(false);
    expect(
      searchKnowledgeBaseInputSchema.safeParse({
        query: "VPN error 809",
        filters: { version: 0 },
      }).success,
    ).toBe(false);
  });

  it("requires a trusted employee identifier for ticket queries", () => {
    expect(
      searchMyTicketsInputSchema.safeParse({
        employeeId: "00000000-0000-4000-8000-000000000001",
        query: "INC-20311",
      }).success,
    ).toBe(true);
    expect(
      searchMyTicketsInputSchema.safeParse({
        employeeId: "../../other-employee",
      }).success,
    ).toBe(false);
  });

  it("makes ticket writes a confirmation-required draft, never a create tool", () => {
    const operation = {
      operation: "create",
      fields: {
        title: "VPN indisponível",
        description:
          "A VPN corporativa parou de conectar após a atualização do cliente.",
        type: "INC",
        category: "Rede e VPN",
        priority: "Alta",
      },
    };
    expect(prepareTicketDraftInputSchema.safeParse(operation).success).toBe(
      true,
    );
    expect(
      prepareTicketDraftOutputSchema.safeParse({
        ...operation,
        confirmationRequired: true,
      }).success,
    ).toBe(true);
    expect(
      prepareTicketDraftInputSchema.safeParse({
        ...operation,
        fields: { ...operation.fields, category: "RH" },
      }).success,
    ).toBe(false);
  });

  it("requires a factual summary and explicit confirmation for handoff", () => {
    const request = {
      reason: "Funcionário solicitou analista.",
      summary: "Falha de VPN desde esta manhã.",
    };
    expect(requestHumanHandoffInputSchema.safeParse(request).success).toBe(
      true,
    );
    expect(
      requestHumanHandoffOutputSchema.safeParse({
        ...request,
        confirmationRequired: true,
      }).success,
    ).toBe(true);
    expect(
      requestHumanHandoffInputSchema.safeParse({
        reason: "Solicitação.",
        summary: "",
      }).success,
    ).toBe(false);
  });
});
